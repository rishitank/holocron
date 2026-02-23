import type {
  HybridStore,
  BM25Hit,
  VectorHit,
  BatchEntry,
  ChunkLink,
  ChunkMeta,
  IndexEvent,
  MemoryType,
} from './hybridStore.js';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { extractCodeTokens, normalizeQuery } from './tokenizer.js';
import { ContextError } from '../errors/context.js';
import { mkdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

/**
 * Current schema version. Increment when FTS5 or chunk_meta columns change.
 * On startup, init() detects version drift and drops+recreates virtual tables.
 *
 * v2: added code_tokens FTS5 column
 * v3: added ingested_at, memory_type to chunk_meta; chunk_links; index_events
 */
const SCHEMA_VERSION = 3;

/**
 * Extract searchable tokens from a file path.
 * "src/context/gitTracker.ts" → "git tracker"
 * Splits camelCase, PascalCase, hyphens, and underscores.
 */
function filePathTokens(filePath: string): string {
  const name = basename(filePath).replace(/\.[^.]+$/, '');
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * SqliteHybridStore — merges BM25 (SQLite FTS5) and ANN (sqlite-vec) into
 * a single database file. Replaces the former OramaIndex + SqliteVectorStore
 * dual-store design.
 *
 * Schema v3 (Engram + Context Graph research):
 * - chunk_meta: added ingested_at (epoch ms) + memory_type ('semantic'|'procedural')
 * - chunk_links: post-hoc similarity edges for graph-hop expansion at search time
 * - index_events: audit log of indexing operations (reified decisions)
 */
export class SqliteHybridStore implements HybridStore {
  private db: DatabaseSync | null = null;
  private dimensions = 0;
  private readonly readyPromise: Promise<void>;

  // Prepared statements (initialised after ready)
  private stmtInsertMeta!: StatementSync;
  private stmtInsertFts!: StatementSync;
  private stmtDeleteFtsByRowid!: StatementSync;
  private stmtDeleteMetaById!: StatementSync;
  private stmtGetRowidById!: StatementSync;
  private stmtGetChunksByFile!: StatementSync;
  private stmtCount!: StatementSync;
  private stmtSearchFts!: StatementSync;
  private stmtGetChunkById!: StatementSync;
  private stmtInsertLink!: StatementSync;
  private stmtGetLinks!: StatementSync;
  private stmtInsertIndexEvent!: StatementSync;
  private stmtInsertVec: StatementSync | null = null;
  private stmtSearchVec: StatementSync | null = null;

  constructor(private readonly dbPath = ':memory:') {
    this.readyPromise = this.init();
  }

  // ── public lifecycle ────────────────────────────────────────────────────

  async ensureReady(): Promise<void> {
    return this.readyPromise;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private get database(): DatabaseSync {
    if (!this.db) throw new ContextError('Database accessed before init');
    return this.db;
  }

  // ── public writes ───────────────────────────────────────────────────────

  async addBatch(entries: BatchEntry[]): Promise<void> {
    await this.readyPromise;
    if (entries.length === 0) return;

    const now = Date.now();
    const db = this.database;
    db.exec('BEGIN DEFERRED');
    try {
      for (const { chunk, vector, memoryType } of entries) {
        // Upsert: remove stale entry if present
        const existing = this.stmtGetRowidById.get(chunk.id) as
          | { rowid: number | bigint }
          | undefined;
        if (existing) {
          const existingRowid = BigInt(existing.rowid);
          if (this.stmtInsertVec) {
            db.prepare('DELETE FROM vecs WHERE rowid = ?').run(existingRowid);
          }
          this.stmtDeleteFtsByRowid.run(existingRowid);
          this.stmtDeleteMetaById.run(chunk.id);
        }

        // Insert chunk metadata
        const row = this.stmtInsertMeta.get(
          chunk.id,
          chunk.content,
          chunk.filePath,
          chunk.startLine,
          chunk.endLine,
          chunk.language,
          chunk.symbolName ?? null,
          now,
          memoryType ?? 'semantic',
        ) as { rowid: number | bigint };
        const rowid = BigInt(row.rowid);

        // Extract camelCase code tokens for FTS5 code_tokens column
        const codeTokens = extractCodeTokens(chunk.content);

        // Insert into FTS5 (rowid must match chunk_meta.rowid)
        this.stmtInsertFts.run(
          rowid,
          chunk.content,
          chunk.symbolName ?? '',
          filePathTokens(chunk.filePath),
          codeTokens,
        );

        // Insert into vec0 (only if embedder produced a non-empty vector)
        if (vector.length > 0) {
          this.ensureDimensions(vector.length);
          // stmtInsertVec is set by ensureDimensions() called just above
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this.stmtInsertVec!.run(
            rowid,
            Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
          );
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // If rollback fails, the transaction is already closed
      }
      throw err;
    }
  }

  async removeByFilePath(filePath: string): Promise<void> {
    await this.readyPromise;
    const rows = this.stmtGetChunksByFile.all(filePath) as {
      rowid: number | bigint;
      id: string;
    }[];
    if (rows.length === 0) return;

    const db = this.database;
    db.exec('BEGIN DEFERRED');
    try {
      for (const row of rows) {
        const rowid = BigInt(row.rowid);
        if (this.stmtInsertVec) {
          db.prepare('DELETE FROM vecs WHERE rowid = ?').run(rowid);
        }
        this.stmtDeleteFtsByRowid.run(rowid);
        this.stmtDeleteMetaById.run(row.id);
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // rollback failed — connection may be closed
      }
      throw err;
    }
  }

  async clearAll(): Promise<void> {
    await this.readyPromise;
    const db = this.database;
    db.exec('BEGIN DEFERRED');
    try {
      db.exec('DELETE FROM chunk_meta');
      db.exec('DELETE FROM chunks_fts');
      db.exec('DELETE FROM chunk_links');
      if (this.dimensions > 0) {
        db.exec('DROP TABLE IF EXISTS vecs');
        db.prepare('DELETE FROM _meta WHERE key = ?').run('dimensions');
        this.dimensions = 0;
        this.stmtInsertVec = null;
        this.stmtSearchVec = null;
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // rollback failed
      }
      throw err;
    }
  }

  async addLinks(links: ChunkLink[]): Promise<void> {
    await this.readyPromise;
    if (links.length === 0) return;

    const db = this.database;
    db.exec('BEGIN DEFERRED');
    try {
      for (const link of links) {
        this.stmtInsertLink.run(link.srcId, link.dstId, link.similarity, Date.now());
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async getLinks(srcId: string, limit = 5): Promise<ChunkLink[]> {
    await this.readyPromise;
    if (!this.db) return [];
    const rows = this.stmtGetLinks.all(srcId, limit) as {
      dst_id: string;
      similarity: number;
    }[];
    return rows.map((r) => ({ srcId, dstId: r.dst_id, similarity: r.similarity }));
  }

  async getChunkById(id: string): Promise<ChunkMeta | null> {
    await this.readyPromise;
    if (!this.db) return null;
    const row = this.stmtGetChunkById.get(id) as
      | {
          id: string;
          content: string;
          file_path: string;
          start_line: number;
          end_line: number;
          language: string;
          symbol_name: string | null;
          ingested_at: number;
          memory_type: string;
        }
      | undefined;
    if (!row) return null;
    return {
      chunk: {
        id: row.id,
        content: row.content,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        language: row.language,
        ...(row.symbol_name ? { symbolName: row.symbol_name } : {}),
      },
      ingestedAt: row.ingested_at,
      memoryType: row.memory_type as MemoryType,
    };
  }

  async logIndexEvent(event: IndexEvent): Promise<void> {
    await this.readyPromise;
    if (!this.db) return;
    this.stmtInsertIndexEvent.run(
      event.eventType,
      event.filesChanged,
      event.chunksAdded,
      event.chunksRemoved,
      event.commitSha ?? null,
      Date.now(),
    );
  }

  // ── public reads ────────────────────────────────────────────────────────

  async searchBM25(query: string, topK: number): Promise<BM25Hit[]> {
    await this.readyPromise;
    if (!this.db) return [];

    const normalised = normalizeQuery(query);
    if (!normalised) return [];

    try {
      const rows = this.stmtSearchFts.all(normalised, topK) as {
        id: string;
        content: string;
        file_path: string;
        start_line: number;
        end_line: number;
        language: string;
        symbol_name: string | null;
        ingested_at: number;
        memory_type: string;
        score: number;
      }[];

      return rows.map((r) => ({
        id: r.id,
        score: r.score,
        chunk: {
          id: r.id,
          content: r.content,
          filePath: r.file_path,
          startLine: r.start_line,
          endLine: r.end_line,
          language: r.language,
          ...(r.symbol_name ? { symbolName: r.symbol_name } : {}),
        },
        ingestedAt: r.ingested_at,
        memoryType: r.memory_type as MemoryType,
      }));
    } catch {
      // FTS5 MATCH can throw on invalid query strings (e.g. bare "*")
      return [];
    }
  }

  async searchVector(queryVec: Float32Array, topK: number): Promise<VectorHit[]> {
    await this.readyPromise;
    if (!this.db || this.dimensions === 0 || queryVec.length === 0 || !this.stmtSearchVec) {
      return [];
    }

    const rows = this.stmtSearchVec.all(
      Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength),
      topK,
    ) as {
      id: string;
      content: string;
      file_path: string;
      start_line: number;
      end_line: number;
      language: string;
      symbol_name: string | null;
      ingested_at: number;
      memory_type: string;
      distance: number;
    }[];

    return rows.map((r) => ({
      id: r.id,
      score: 1 / (1 + r.distance),
      chunk: {
        id: r.id,
        content: r.content,
        filePath: r.file_path,
        startLine: r.start_line,
        endLine: r.end_line,
        language: r.language,
        ...(r.symbol_name ? { symbolName: r.symbol_name } : {}),
      },
      ingestedAt: r.ingested_at,
      memoryType: r.memory_type as MemoryType,
    }));
  }

  get size(): number {
    if (!this.db) return 0;
    const row = this.stmtCount.get() as { n: number };
    return row.n;
  }

  get hasVectors(): boolean {
    return this.dimensions > 0 && this.stmtInsertVec !== null;
  }

  // ── private ─────────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    if (this.dbPath !== ':memory:') {
      await mkdir(dirname(this.dbPath), { recursive: true });
    }

    const { DatabaseSync } = (await import('node:sqlite')) as {
      DatabaseSync: new (path: string, opts?: { allowExtension?: boolean }) => DatabaseSync;
    };
    const { load } = (await import('sqlite-vec')) as { load: (db: DatabaseSync) => void };

    this.db = new DatabaseSync(this.dbPath, { allowExtension: true });
    load(this.db);

    // Metadata key-value store — created first so we can check schema version
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // ── Schema migration ────────────────────────────────────────────────────
    const versionRow = this.db
      .prepare("SELECT value FROM _meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    const storedVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

    if (storedVersion < SCHEMA_VERSION) {
      if (storedVersion > 0) {
        process.stderr.write(
          `[holocron] Schema migrated to v${SCHEMA_VERSION} — reindex required\n`,
        );
      }
      // Drop all tables that change between versions.
      // Virtual tables (FTS5, vec0) cannot be altered in-place.
      // chunk_meta gains new columns in v3 (ingested_at, memory_type) — must be dropped
      // so the CREATE TABLE below recreates it with the full v3 schema.
      // Dropping data is safe: the "reindex required" notice informs the user, and
      // GitTracker's SHA mismatch triggers automatic full re-index on next search().
      this.db.exec('DROP TABLE IF EXISTS chunks_fts');
      this.db.exec('DROP TABLE IF EXISTS vecs');
      this.db.exec('DROP TABLE IF EXISTS chunk_meta');
      this.db.prepare("DELETE FROM _meta WHERE key = 'dimensions'").run();
      this.dimensions = 0;
      this.db
        .prepare("INSERT OR REPLACE INTO _meta(key, value) VALUES ('schema_version', ?)")
        .run(String(SCHEMA_VERSION));
    }
    // ── End migration ───────────────────────────────────────────────────────

    // Main chunk metadata table (source of truth)
    // v3 adds: ingested_at (epoch ms), memory_type ('semantic'|'procedural')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_meta (
        rowid       INTEGER PRIMARY KEY,
        id          TEXT UNIQUE NOT NULL,
        content     TEXT NOT NULL DEFAULT '',
        file_path   TEXT NOT NULL DEFAULT '',
        start_line  INTEGER NOT NULL DEFAULT 0,
        end_line    INTEGER NOT NULL DEFAULT 0,
        language    TEXT NOT NULL DEFAULT 'text',
        symbol_name TEXT,
        ingested_at INTEGER NOT NULL DEFAULT 0,
        memory_type TEXT NOT NULL DEFAULT 'semantic'
      )
    `);

    // FTS5 BM25 search — v2 schema: content, symbol_name, file_tokens, code_tokens
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        symbol_name,
        file_tokens,
        code_tokens,
        tokenize='porter unicode61'
      )
    `);

    // Post-hoc similarity edges (Engram A-MEM bidirectional linking)
    // Built by LocalContextAdapter.buildChunkLinks(); used for graph-hop expansion
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_links (
        src_id     TEXT NOT NULL,
        dst_id     TEXT NOT NULL,
        similarity REAL NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (src_id, dst_id)
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunk_links_src ON chunk_links(src_id)');

    // Reified indexing decision audit log (Context Graph provenance)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS index_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type      TEXT NOT NULL,
        files_changed   INTEGER NOT NULL DEFAULT 0,
        chunks_added    INTEGER NOT NULL DEFAULT 0,
        chunks_removed  INTEGER NOT NULL DEFAULT 0,
        commit_sha      TEXT,
        created_at      INTEGER NOT NULL
      )
    `);

    // Prepare all dimension-independent statements
    this.stmtInsertMeta = this.db.prepare(
      `INSERT INTO chunk_meta(id, content, file_path, start_line, end_line, language, symbol_name, ingested_at, memory_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid`,
    );
    this.stmtInsertFts = this.db.prepare(
      'INSERT INTO chunks_fts(rowid, content, symbol_name, file_tokens, code_tokens) VALUES (?, ?, ?, ?, ?)',
    );
    this.stmtDeleteFtsByRowid = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
    this.stmtDeleteMetaById = this.db.prepare('DELETE FROM chunk_meta WHERE id = ?');
    this.stmtGetRowidById = this.db.prepare('SELECT rowid FROM chunk_meta WHERE id = ?');
    this.stmtGetChunksByFile = this.db.prepare(
      'SELECT rowid, id FROM chunk_meta WHERE file_path = ?',
    );
    this.stmtCount = this.db.prepare('SELECT COUNT(*) as n FROM chunk_meta');

    // content weight=10, symbol_name weight=1, file_tokens weight=5, code_tokens weight=3
    // Also returns ingested_at and memory_type for recency decay + type weighting
    this.stmtSearchFts = this.db.prepare(`
      SELECT m.id, m.content, m.file_path, m.start_line, m.end_line, m.language, m.symbol_name,
             m.ingested_at, m.memory_type,
             -bm25(chunks_fts, 10.0, 1.0, 5.0, 3.0) as score
      FROM chunks_fts
      JOIN chunk_meta m ON chunks_fts.rowid = m.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts, 10.0, 1.0, 5.0, 3.0)
      LIMIT ?
    `);

    this.stmtGetChunkById = this.db.prepare(
      `SELECT id, content, file_path, start_line, end_line, language, symbol_name,
              ingested_at, memory_type
       FROM chunk_meta WHERE id = ?`,
    );

    this.stmtInsertLink = this.db.prepare(
      `INSERT OR REPLACE INTO chunk_links(src_id, dst_id, similarity, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.stmtGetLinks = this.db.prepare(
      `SELECT dst_id, similarity FROM chunk_links
       WHERE src_id = ? ORDER BY similarity DESC LIMIT ?`,
    );
    this.stmtInsertIndexEvent = this.db.prepare(
      `INSERT INTO index_events(event_type, files_changed, chunks_added, chunks_removed, commit_sha, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    // Restore vector table if dimensions were previously set
    const dimRow = this.db
      .prepare('SELECT value FROM _meta WHERE key = ?')
      .get('dimensions') as { value: string } | undefined;
    if (dimRow) {
      this.dimensions = parseInt(dimRow.value, 10);
      this.initVecTable();
    }
  }

  private initVecTable(): void {
    if (!this.db) throw new ContextError('Database not initialized');
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS vecs USING vec0(embedding float[${this.dimensions}])`,
    );
    this.stmtInsertVec = this.db.prepare(
      'INSERT INTO vecs(rowid, embedding) VALUES (?, ?)',
    );
    this.stmtSearchVec = this.db.prepare(`
      SELECT m.id, m.content, m.file_path, m.start_line, m.end_line, m.language, m.symbol_name,
             m.ingested_at, m.memory_type, v.distance
      FROM (
        SELECT rowid, distance FROM vecs
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      ) v
      JOIN chunk_meta m ON m.rowid = v.rowid
    `);
  }

  private ensureDimensions(dims: number): void {
    if (this.dimensions === 0) {
      this.dimensions = dims;
      this.database.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run(
        'dimensions',
        String(dims),
      );
      this.initVecTable();
    } else if (this.dimensions !== dims) {
      throw new ContextError(
        `Vector dimension mismatch: expected ${this.dimensions}, got ${dims}`,
      );
    }
  }
}
