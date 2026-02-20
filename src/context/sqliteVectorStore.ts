import type { VectorStore, VectorSearchResult } from './vectorStore.js';
import { ContextError } from '../errors/context.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Dynamically imported to avoid top-level import issues with experimental API
type DatabaseSync = import('node:sqlite').DatabaseSync;
type StatementSync = import('node:sqlite').StatementSync;

export interface StoredChunk {
  id: string;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
  symbolName?: string;
}

export class SqliteVectorStore implements VectorStore {
  private db: DatabaseSync | null = null;
  private dimensions = 0;
  private insertMeta!: StatementSync;
  private insertVec!: StatementSync;
  private searchStmt!: StatementSync;
  private deleteStmt!: StatementSync;
  private countStmt!: StatementSync;
  private rowidById!: StatementSync;
  private readonly ready: Promise<void>;

  constructor(private readonly dbPath: string = ':memory:') {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    if (this.dbPath !== ':memory:') {
      await mkdir(dirname(this.dbPath), { recursive: true });
    }

    const { DatabaseSync } = await import('node:sqlite') as {
      DatabaseSync: new (path: string, opts?: { allowExtension?: boolean }) => DatabaseSync;
    };
    const { load } = await import('sqlite-vec') as { load: (db: DatabaseSync) => void };

    this.db = new DatabaseSync(this.dbPath, { allowExtension: true });
    load(this.db);

    // chunk_meta stores all indexed chunks (always persisted, even without vectors)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunk_meta (
        rowid    INTEGER PRIMARY KEY,
        id       TEXT UNIQUE NOT NULL,
        content  TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    // Migrate: add content column to existing DBs created before this schema version
    try {
      this.db.exec(`ALTER TABLE chunk_meta ADD COLUMN content TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists — ignore
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // These statements are dimension-independent — prepare them always
    this.insertMeta = this.db.prepare(
      'INSERT INTO chunk_meta(id, content, metadata) VALUES (?, ?, ?) RETURNING rowid',
    );
    this.deleteStmt = this.db.prepare('DELETE FROM chunk_meta WHERE id = ?');
    this.countStmt = this.db.prepare('SELECT COUNT(*) as n FROM chunk_meta');
    this.rowidById = this.db.prepare('SELECT rowid FROM chunk_meta WHERE id = ?');

    const dimRow = this.db.prepare('SELECT value FROM _meta WHERE key = ?').get('dimensions') as
      | { value: string }
      | undefined;
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
    this.insertVec = this.db.prepare('INSERT INTO vecs(rowid, embedding) VALUES (?, ?)');
    this.searchStmt = this.db.prepare(`
      SELECT m.id, m.metadata, v.distance
      FROM (
        SELECT rowid, distance FROM vecs
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      ) v
      JOIN chunk_meta m ON m.rowid = v.rowid
    `);
  }

  private async ensureDimensions(dims: number): Promise<void> {
    await this.ready;
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

  async add(id: string, vector: Float32Array, metadata: Record<string, string>): Promise<void> {
    await this.ready;

    // Separate content from the JSON blob — stored in its own column for loadAllChunks()
    const content = metadata['content'] ?? '';
    const { content: _c, ...rest } = metadata;

    // Remove old entry if exists (full replace: delete then re-insert keeps rowid stable)
    const existing = this.rowidById.get(id) as { rowid: number } | undefined;
    if (existing) {
      if (this.insertVec) {
        // Remove old vector row if vecs table exists
        this.db!.prepare('DELETE FROM vecs WHERE rowid = ?').run(existing.rowid);
      }
      this.db!.prepare('DELETE FROM chunk_meta WHERE id = ?').run(id);
    }

    // Always persist chunk content (even when embedder is noop / vector is empty)
    const row = this.insertMeta.get(id, content, JSON.stringify(rest)) as {
      rowid: number | bigint;
    };

    if (vector.length === 0) return; // noop embedder — skip vector storage

    await this.ensureDimensions(vector.length);
    // vec0 requires BigInt for explicit rowid; Number is rejected with "Only integers are allowed"
    this.insertVec.run(
      BigInt(row.rowid),
      Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
    );
  }

  async search(query: Float32Array, topK: number): Promise<VectorSearchResult[]> {
    await this.ready;
    if (this.dimensions === 0 || query.length === 0) return [];

    const rows = this.searchStmt.all(
      Buffer.from(query.buffer, query.byteOffset, query.byteLength),
      topK,
    ) as Array<{ id: string; metadata: string; distance: number }>;

    return rows.map((row) => ({
      id: row.id,
      // Convert L2 distance to a 0-1 score (higher = more similar)
      score: 1 / (1 + row.distance),
      metadata: JSON.parse(row.metadata) as Record<string, string>,
    }));
  }

  async remove(id: string): Promise<void> {
    await this.ready;
    const row = this.rowidById.get(id) as { rowid: number } | undefined;
    if (row && this.insertVec) {
      this.db!.prepare('DELETE FROM vecs WHERE rowid = ?').run(row.rowid);
    }
    this.deleteStmt.run(id);
  }

  /**
   * Load all persisted chunks from SQLite — used to restore the in-memory BM25 index
   * (OramaIndex) after a cold start without re-reading every source file from disk.
   */
  async loadAllChunks(): Promise<StoredChunk[]> {
    await this.ready;
    const rows = this.db!.prepare('SELECT id, content, metadata FROM chunk_meta').all() as Array<{
      id: string;
      content: string;
      metadata: string;
    }>;
    return rows.map((row) => {
      const meta = JSON.parse(row.metadata) as Record<string, string>;
      return {
        id: row.id,
        content: row.content,
        filePath: meta['filePath'] ?? '',
        startLine: Number(meta['startLine'] ?? 0),
        endLine: Number(meta['endLine'] ?? 0),
        language: meta['language'] ?? 'text',
        ...(meta['symbolName'] ? { symbolName: meta['symbolName'] } : {}),
      };
    });
  }

  get size(): Promise<number> {
    return this.ready.then(() => {
      const row = this.countStmt.get() as { n: number };
      return row.n;
    });
  }

  async clear(): Promise<void> {
    await this.ready;
    this.db!.exec('DELETE FROM chunk_meta');
    if (this.dimensions > 0) {
      // Drop the vecs virtual table so it can be recreated with a different dimension
      // on the next add() call. This is the recovery path for embedder switches.
      this.db!.exec('DROP TABLE IF EXISTS vecs');
      this.db!.prepare('DELETE FROM _meta WHERE key = ?').run('dimensions');
      this.dimensions = 0;
      // Nullify stale prepared statements — re-initialized by initVecTable() on next add()
      this.insertVec = null as unknown as StatementSync;
      this.searchStmt = null as unknown as StatementSync;
    }
  }

  async close(): Promise<void> {
    await this.ready;
    this.db?.close();
    this.db = null;
  }
}
