import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteHybridStore } from '../../../src/context/sqliteHybridStore.js';
import type { Chunk } from '../../../src/types/context.types.js';

function makeChunk(
  id: string,
  content: string,
  filePath = 'file.ts',
  symbolName?: string,
): Chunk {
  return { id, content, filePath, startLine: 1, endLine: 10, language: 'typescript', symbolName };
}

function makeVec(...vals: number[]): Float32Array {
  return new Float32Array(vals);
}

describe('SqliteHybridStore', () => {
  let store: SqliteHybridStore;

  beforeEach(async () => {
    store = new SqliteHybridStore(':memory:');
    await store.ensureReady();
  });

  afterEach(() => {
    store.close();
  });

  // ── addBatch + searchBM25 ─────────────────────────────────────────────────

  it('addBatch() stores chunks searchable via BM25', async () => {
    const chunk = makeChunk('c1', 'function authenticate(user: string): boolean');
    await store.addBatch([{ chunk, vector: new Float32Array(0) }]);

    const results = await store.searchBM25('authenticate', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('c1');
    expect(results[0]!.chunk.content).toContain('authenticate');
  });

  it('searchBM25() ranks by relevance', async () => {
    // FTS5 tokenizes on word boundaries (not camelCase). Use space-separated content.
    await store.addBatch([
      { chunk: makeChunk('c1', 'function process payment amount number'), vector: new Float32Array(0) },
      { chunk: makeChunk('c2', 'Payment Processor class handles payment processing logic'), vector: new Float32Array(0) },
      { chunk: makeChunk('c3', 'const config timeout value server'), vector: new Float32Array(0) },
    ]);

    const results = await store.searchBM25('payment processor', 3);
    // c2 contains both "payment" and "processor" — highest relevance
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.score).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('c2');
  });

  it('searchBM25() returns empty array on invalid FTS5 query (no crash)', async () => {
    await store.addBatch([{ chunk: makeChunk('c1', 'some content'), vector: new Float32Array(0) }]);
    // bare '*' is invalid in FTS5 MATCH
    const results = await store.searchBM25('*', 5);
    expect(Array.isArray(results)).toBe(true);
  });

  it('searchBM25() returns empty when store is empty', async () => {
    const results = await store.searchBM25('anything', 5);
    expect(results).toHaveLength(0);
  });

  it('searchBM25() finds chunks by file path tokens (camelCase split)', async () => {
    // File path "src/context/gitTracker.ts" should yield tokens "git", "tracker"
    const chunk = makeChunk('gt1', 'export class GitTracker {}', 'src/context/gitTracker.ts');
    await store.addBatch([{ chunk, vector: new Float32Array(0) }]);

    const results = await store.searchBM25('git', 5);
    expect(results.map((r) => r.id)).toContain('gt1');
  });

  // ── addBatch + searchVector ───────────────────────────────────────────────

  it('addBatch() stores vectors and they are searchable', async () => {
    await store.addBatch([
      { chunk: makeChunk('v1', 'vector one'), vector: makeVec(1, 0, 0) },
      { chunk: makeChunk('v2', 'vector two'), vector: makeVec(0, 1, 0) },
    ]);

    const results = await store.searchVector(makeVec(1, 0, 0), 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('v1');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('searchVector() returns empty when no vectors stored', async () => {
    // Add chunk without vector (noop embedder)
    await store.addBatch([{ chunk: makeChunk('c1', 'content'), vector: new Float32Array(0) }]);
    const results = await store.searchVector(makeVec(1, 0, 0), 5);
    expect(results).toHaveLength(0);
  });

  it('searchVector() returns empty for zero-length query', async () => {
    await store.addBatch([{ chunk: makeChunk('v1', 'content'), vector: makeVec(1, 0, 0) }]);
    const results = await store.searchVector(new Float32Array(0), 5);
    expect(results).toHaveLength(0);
  });

  it('hasVectors is false when no vectors stored', async () => {
    await store.addBatch([{ chunk: makeChunk('c1', 'content'), vector: new Float32Array(0) }]);
    expect(store.hasVectors).toBe(false);
  });

  it('hasVectors is true after adding a chunk with a vector', async () => {
    await store.addBatch([{ chunk: makeChunk('v1', 'content'), vector: makeVec(1, 0, 0) }]);
    expect(store.hasVectors).toBe(true);
  });

  it('throws on vector dimension mismatch across batches', async () => {
    await store.addBatch([{ chunk: makeChunk('v1', 'c1'), vector: makeVec(1, 0, 0) }]);
    await expect(
      store.addBatch([{ chunk: makeChunk('v2', 'c2'), vector: makeVec(1, 0) }]),
    ).rejects.toThrow('dimension mismatch');
  });

  // ── upsert behaviour ──────────────────────────────────────────────────────

  it('addBatch() replaces existing chunk with same id', async () => {
    const chunk1 = makeChunk('dup', 'original content');
    const chunk2 = makeChunk('dup', 'updated content');

    await store.addBatch([{ chunk: chunk1, vector: new Float32Array(0) }]);
    await store.addBatch([{ chunk: chunk2, vector: new Float32Array(0) }]);

    expect(store.size).toBe(1);
    const results = await store.searchBM25('updated', 5);
    expect(results[0]!.chunk.content).toBe('updated content');
  });

  // ── removeByFilePath ──────────────────────────────────────────────────────

  it('removeByFilePath() removes all chunks for the given file', async () => {
    await store.addBatch([
      { chunk: makeChunk('a1', 'content a', 'a.ts'), vector: new Float32Array(0) },
      { chunk: makeChunk('a2', 'more content a', 'a.ts'), vector: new Float32Array(0) },
      { chunk: makeChunk('b1', 'content b', 'b.ts'), vector: new Float32Array(0) },
    ]);

    expect(store.size).toBe(3);
    await store.removeByFilePath('a.ts');
    expect(store.size).toBe(1);

    const results = await store.searchBM25('content', 10);
    expect(results.map((r) => r.id)).not.toContain('a1');
    expect(results.map((r) => r.id)).not.toContain('a2');
    expect(results.map((r) => r.id)).toContain('b1');
  });

  it('removeByFilePath() is idempotent for unknown paths', async () => {
    await expect(store.removeByFilePath('nonexistent.ts')).resolves.not.toThrow();
  });

  // ── clearAll ──────────────────────────────────────────────────────────────

  it('clearAll() removes all chunks and resets vector dimensions', async () => {
    await store.addBatch([
      { chunk: makeChunk('c1', 'content'), vector: makeVec(1, 0, 0) },
    ]);
    expect(store.size).toBe(1);

    await store.clearAll();
    expect(store.size).toBe(0);
    expect(store.hasVectors).toBe(false);

    const bm25 = await store.searchBM25('content', 5);
    const vec = await store.searchVector(makeVec(1, 0, 0), 5);
    expect(bm25).toHaveLength(0);
    expect(vec).toHaveLength(0);
  });

  it('clearAll() allows re-adding with different vector dimensions', async () => {
    await store.addBatch([{ chunk: makeChunk('c1', 'x'), vector: makeVec(1, 0, 0) }]);
    await store.clearAll();
    // Different dimension (2-d) — should not throw
    await expect(
      store.addBatch([{ chunk: makeChunk('c2', 'y'), vector: makeVec(1, 0) }]),
    ).resolves.not.toThrow();
    expect(store.hasVectors).toBe(true);
  });

  // ── size ─────────────────────────────────────────────────────────────────

  it('size reflects current chunk count', async () => {
    expect(store.size).toBe(0);
    await store.addBatch([
      { chunk: makeChunk('a', 'a'), vector: new Float32Array(0) },
      { chunk: makeChunk('b', 'b'), vector: new Float32Array(0) },
    ]);
    expect(store.size).toBe(2);
  });

  // ── atomicity ─────────────────────────────────────────────────────────────

  it('addBatch() is atomic: dimension error rolls back entire batch', async () => {
    // First establish 3-d vectors
    await store.addBatch([{ chunk: makeChunk('v1', 'first'), vector: makeVec(1, 0, 0) }]);
    expect(store.size).toBe(1);

    // Batch with correct dims (c2) then mismatched (c3) — whole batch rolls back
    await expect(
      store.addBatch([
        { chunk: makeChunk('c2', 'second'), vector: makeVec(1, 0, 0) },
        { chunk: makeChunk('c3', 'third'), vector: makeVec(1, 0) }, // wrong dims
      ]),
    ).rejects.toThrow('dimension mismatch');

    // Only v1 should exist (c2 rolled back)
    expect(store.size).toBe(1);
  });

  it('addBatch() handles empty batch without error', async () => {
    await expect(store.addBatch([])).resolves.not.toThrow();
    expect(store.size).toBe(0);
  });

  // ── persistence ──────────────────────────────────────────────────────────

  it('persists data and vector dimensions across reopen', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { rm } = await import('node:fs/promises');

    const dbPath = join(tmpdir(), `test-hybrid-${Date.now()}.db`);
    const s1 = new SqliteHybridStore(dbPath);
    await s1.ensureReady();

    await s1.addBatch([
      { chunk: makeChunk('p1', 'persist this', 'persist.ts'), vector: makeVec(1, 0, 0) },
    ]);
    s1.close();

    const s2 = new SqliteHybridStore(dbPath);
    await s2.ensureReady();

    const bm25 = await s2.searchBM25('persist', 5);
    const vec = await s2.searchVector(makeVec(1, 0, 0), 5);
    s2.close();

    await rm(dbPath, { force: true }).catch(() => {});

    expect(bm25).toHaveLength(1);
    expect(bm25[0]!.id).toBe('p1');
    expect(vec).toHaveLength(1);
    expect(vec[0]!.id).toBe('p1');
  });

  // ── v3: ingested_at + memory_type ────────────────────────────────────────

  it('addBatch() stores ingested_at and memory_type; searchBM25() returns them', async () => {
    const chunk = makeChunk('v3-1', 'function boot() {}', 'src/app.ts');
    await store.addBatch([{ chunk, vector: new Float32Array(0), memoryType: 'semantic' }]);

    const results = await store.searchBM25('boot', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.memoryType).toBe('semantic');
    expect(results[0]!.ingestedAt).toBeGreaterThan(0);
    expect(results[0]!.ingestedAt).toBeLessThanOrEqual(Date.now());
  });

  it('addBatch() stores procedural memory type correctly', async () => {
    const chunk = makeChunk('proc-1', '{"name":"holocron"}', 'package.json');
    await store.addBatch([{ chunk, vector: new Float32Array(0), memoryType: 'procedural' }]);

    const results = await store.searchBM25('holocron', 5);
    expect(results[0]!.memoryType).toBe('procedural');
  });

  it('getChunkById() returns chunk with temporal metadata', async () => {
    const chunk = makeChunk('gb1', 'const x = 1;', 'src/x.ts');
    await store.addBatch([{ chunk, vector: new Float32Array(0), memoryType: 'semantic' }]);

    const meta = await store.getChunkById('gb1');
    expect(meta).not.toBeNull();
    expect(meta!.chunk.id).toBe('gb1');
    expect(meta!.memoryType).toBe('semantic');
    expect(meta!.ingestedAt).toBeGreaterThan(0);
  });

  it('getChunkById() returns null for unknown id', async () => {
    const result = await store.getChunkById('nonexistent');
    expect(result).toBeNull();
  });

  // ── v3: chunk_links ───────────────────────────────────────────────────────

  it('addLinks() stores similarity edges; getLinks() retrieves them', async () => {
    await store.addBatch([
      { chunk: makeChunk('a', 'content a'), vector: new Float32Array(0) },
      { chunk: makeChunk('b', 'content b'), vector: new Float32Array(0) },
    ]);

    await store.addLinks([{ srcId: 'a', dstId: 'b', similarity: 0.92 }]);

    const links = await store.getLinks('a', 5);
    expect(links).toHaveLength(1);
    expect(links[0]!.dstId).toBe('b');
    expect(links[0]!.similarity).toBeCloseTo(0.92);
  });

  it('getLinks() returns empty for chunk with no links', async () => {
    await store.addBatch([{ chunk: makeChunk('lone', 'lonely'), vector: new Float32Array(0) }]);
    const links = await store.getLinks('lone', 5);
    expect(links).toHaveLength(0);
  });

  it('addLinks() upserts on duplicate (src, dst) pair', async () => {
    await store.addBatch([
      { chunk: makeChunk('x', 'x'), vector: new Float32Array(0) },
      { chunk: makeChunk('y', 'y'), vector: new Float32Array(0) },
    ]);

    await store.addLinks([{ srcId: 'x', dstId: 'y', similarity: 0.8 }]);
    await store.addLinks([{ srcId: 'x', dstId: 'y', similarity: 0.95 }]); // update

    const links = await store.getLinks('x', 5);
    expect(links).toHaveLength(1);
    expect(links[0]!.similarity).toBeCloseTo(0.95);
  });

  // ── v3: index_events ─────────────────────────────────────────────────────

  it('logIndexEvent() writes to index_events and can be read back', async () => {
    await store.logIndexEvent({
      eventType: 'full',
      filesChanged: 42,
      chunksAdded: 100,
      chunksRemoved: 0,
      commitSha: 'abc123',
    });

    // Access internal DB to verify
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (store as any).db;
    const row = db
      .prepare("SELECT * FROM index_events WHERE event_type = 'full'")
      .get() as {
        event_type: string;
        files_changed: number;
        chunks_added: number;
        commit_sha: string | null;
        created_at: number;
      };

    expect(row).toBeDefined();
    expect(row.event_type).toBe('full');
    expect(row.files_changed).toBe(42);
    expect(row.chunks_added).toBe(100);
    expect(row.commit_sha).toBe('abc123');
    expect(row.created_at).toBeGreaterThan(0);
  });

  // ── schema migration ──────────────────────────────────────────────────────

  it('schema_version is written to _meta after init', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { rm } = await import('node:fs/promises');

    const dbPath = join(tmpdir(), `test-schema-${Date.now()}.db`);
    const s = new SqliteHybridStore(dbPath);
    await s.ensureReady();

    // Access the internal db to verify _meta
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (s as any).db;
    const row = db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;

    s.close();
    await rm(dbPath, { force: true }).catch(() => {});

    expect(row).toBeDefined();
    expect(parseInt(row!.value, 10)).toBeGreaterThanOrEqual(2);
  });

  it('old schema (v1: chunks_fts without code_tokens) triggers migration on open', async () => {
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { rm } = await import('node:fs/promises');
    const { DatabaseSync } = (await import('node:sqlite')) as {
      DatabaseSync: new (path: string) => import('node:sqlite').DatabaseSync;
    };

    const dbPath = join(tmpdir(), `test-migrate-${Date.now()}.db`);

    // Manually create a v1-style DB: FTS5 without code_tokens column
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS chunk_meta (
        rowid INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        start_line INTEGER NOT NULL DEFAULT 0,
        end_line INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'text',
        symbol_name TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content, symbol_name, file_tokens,
        tokenize='porter unicode61'
      );
      INSERT OR REPLACE INTO _meta(key, value) VALUES ('schema_version', '1');
    `);
    // Insert a chunk into the old schema
    rawDb.exec(`
      INSERT INTO chunk_meta(id, content, file_path, start_line, end_line, language)
      VALUES ('old1', 'old content', 'old.ts', 1, 5, 'typescript');
      INSERT INTO chunks_fts(rowid, content, symbol_name, file_tokens)
      VALUES (1, 'old content', '', 'old');
    `);
    rawDb.close();

    // Opening with SqliteHybridStore should trigger migration (schema v1 → v2)
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = (chunk: string) => {
      stderrChunks.push(chunk);
      return true;
    };

    const s = new SqliteHybridStore(dbPath);
    await s.ensureReady();

    // Restore stderr
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = origWrite;

    // Migration message should have been emitted (version number may advance)
    expect(stderrChunks.join('')).toContain('[holocron] Schema migrated to v');

    // Store should be functional after migration
    await s.addBatch([{
      chunk: makeChunk('new1', 'new content after migration'),
      vector: new Float32Array(0),
    }]);
    const results = await s.searchBM25('new content', 5);
    expect(results.map((r) => r.id)).toContain('new1');

    s.close();
    await rm(dbPath, { force: true }).catch(() => {});
  });
});
