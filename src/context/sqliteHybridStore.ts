import type { HybridStore, BM25Hit, VectorHit, BatchEntry } from './hybridStore.js';
import { ContextError } from '../errors/context.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Dynamically imported to avoid top-level issues with experimental node:sqlite API
type DatabaseSync = import('node:sqlite').DatabaseSync;
type StatementSync = import('node:sqlite').StatementSync;

/**
 * SqliteHybridStore — merges BM25 (SQLite FTS5) and ANN (sqlite-vec) into
 * a single database file. Replaces the former OramaIndex + SqliteVectorStore
 * dual-store design.
 *
 * Design decisions:
 * - FTS5 with porter+unicode61 tokenizer for language-aware BM25
 * - vec0 virtual table for ANN with L2/cosine distance
 * - All inserts wrapped in explicit transactions (addBatch, removeByFilePath, clearAll)
 * - No in-memory chunk map → eliminates the double-RAM overhead of OramaIndex
 * - No cold-start loadAllChunks() → FTS5 index persists to disk automatically
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
  private stmtInsertVec: StatementSync | null = null;
  private stmtSearchVec: StatementSync | null = null;

  constructor(private readonly dbPath: string = ':memory:') {
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

  // ── public writes ───────────────────────────────────────────────────────

  async addBatch(entries: BatchEntry[]): Promise<void> {
    await this.readyPromise;
    if (entries.length === 0) return;

    const db = this.db!;
    db.exec('BEGIN DEFERRED');
    try {
      for (const { chunk, vector } of entries) {
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
        ) as { rowid: number | bigint };
        const rowid = BigInt(row.rowid);

        // Insert into FTS5 (rowid must match chunk_meta.rowid)
        this.stmtInsertFts.run(rowid, chunk.content, chunk.symbolName ?? '');

        // Insert into vec0 (only if embedder produced a non-empty vector)
        if (vector.length > 0) {
          this.ensureDimensions(vector.length);
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
    const rows = this.stmtGetChunksByFile.all(filePath) as Array<{
      rowid: number | bigint;
      id: string;
    }>;
    if (rows.length === 0) return;

    const db = this.db!;
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
    const db = this.db!;
    db.exec('BEGIN DEFERRED');
    try {
      db.exec('DELETE FROM chunk_meta');
      db.exec('DELETE FROM chunks_fts');
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

  // ── public reads ────────────────────────────────────────────────────────

  async searchBM25(query: string, topK: number): Promise<BM25Hit[]> {
    await this.readyPromise;
    if (!this.db) return [];

    try {
      const rows = this.stmtSearchFts.all(query, topK) as Array<{
        id: string;
        content: string;
        file_path: string;
        start_line: number;
        end_line: number;
        language: string;
        symbol_name: string | null;
        score: number;
      }>;

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
    ) as Array<{
      id: string;
      content: string;
      file_path: string;
      start_line: number;
      end_line: number;
      language: string;
      symbol_name: string | null;
      distance: number;
    }>;

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

    // Main chunk metadata table (source of truth)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_meta (
        rowid       INTEGER PRIMARY KEY,
        id          TEXT UNIQUE NOT NULL,
        content     TEXT NOT NULL DEFAULT '',
        file_path   TEXT NOT NULL DEFAULT '',
        start_line  INTEGER NOT NULL DEFAULT 0,
        end_line    INTEGER NOT NULL DEFAULT 0,
        language    TEXT NOT NULL DEFAULT 'text',
        symbol_name TEXT
      )
    `);

    // FTS5 BM25 search — content + symbol_name, porter stemming
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        symbol_name,
        tokenize='porter unicode61'
      )
    `);

    // Metadata key-value store (e.g. vector dimensions)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Prepare all dimension-independent statements
    this.stmtInsertMeta = this.db.prepare(
      `INSERT INTO chunk_meta(id, content, file_path, start_line, end_line, language, symbol_name)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING rowid`,
    );
    this.stmtInsertFts = this.db.prepare(
      'INSERT INTO chunks_fts(rowid, content, symbol_name) VALUES (?, ?, ?)',
    );
    this.stmtDeleteFtsByRowid = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?');
    this.stmtDeleteMetaById = this.db.prepare('DELETE FROM chunk_meta WHERE id = ?');
    this.stmtGetRowidById = this.db.prepare('SELECT rowid FROM chunk_meta WHERE id = ?');
    this.stmtGetChunksByFile = this.db.prepare(
      'SELECT rowid, id FROM chunk_meta WHERE file_path = ?',
    );
    this.stmtCount = this.db.prepare('SELECT COUNT(*) as n FROM chunk_meta');

    // content weight=10, symbol_name weight=1 — code content matters more than symbol names
    this.stmtSearchFts = this.db.prepare(`
      SELECT m.id, m.content, m.file_path, m.start_line, m.end_line, m.language, m.symbol_name,
             -bm25(chunks_fts, 10.0, 1.0) as score
      FROM chunks_fts
      JOIN chunk_meta m ON chunks_fts.rowid = m.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts, 10.0, 1.0)
      LIMIT ?
    `);

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
             v.distance
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
      this.db!.prepare('INSERT OR REPLACE INTO _meta(key, value) VALUES (?, ?)').run(
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
