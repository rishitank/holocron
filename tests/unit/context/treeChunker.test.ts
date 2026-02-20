import { describe, it, expect } from 'vitest';
import { TreeChunker, TextChunker, getChunker } from '../../../src/context/treeChunker.js';

const TS_CONTENT = `
import { foo } from './foo.js';

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body;
  const user = await findUser(username);
  if (!user) throw new Error('Not found');
  res.json(user);
}

export class AuthService {
  constructor(private readonly db: Database) {}

  async validateToken(token: string): Promise<boolean> {
    return this.db.tokens.includes(token);
  }
}

const arrowFn = async (x: number) => {
  return x * 2;
};
`.trim();

describe('TreeChunker', () => {
  const chunker = new TreeChunker();

  it('chunks TypeScript at function and class boundaries', () => {
    const chunks = chunker.chunk({
      path: 'src/auth.ts',
      contents: TS_CONTENT,
      language: 'typescript',
    });
    expect(chunks.length).toBeGreaterThan(0);
    // Should capture handleLogin and AuthService as separate chunks
    const symbols = chunks.map((c) => c.symbolName).filter(Boolean);
    expect(symbols).toContain('handleLogin');
  });

  it('each chunk has required fields', () => {
    const chunks = chunker.chunk({
      path: 'src/auth.ts',
      contents: TS_CONTENT,
      language: 'typescript',
    });
    for (const chunk of chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.filePath).toBe('src/auth.ts');
      expect(chunk.language).toBe('typescript');
      expect(chunk.startLine).toBeGreaterThanOrEqual(0);
      expect(chunk.endLine).toBeGreaterThan(chunk.startLine);
      expect(chunk.content).toBeTruthy();
    }
  });

  it('splits large functions into overlapping sub-chunks', () => {
    const manyLines = Array.from({ length: 200 }, (_, i) => `  const x${i} = ${i};`).join('\n');
    const bigFn = `export function bigFunction() {\n${manyLines}\n}`;
    const chunks = chunker.chunk({
      path: 'big.ts',
      contents: bigFn,
      language: 'typescript',
    });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('falls back to TextChunker for unsupported language', () => {
    const chunks = chunker.chunk({
      path: 'foo.brainfuck',
      contents: '++++++++',
      language: 'brainfuck',
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]?.language).toBe('brainfuck');
  });

  it('handles empty file', () => {
    const chunks = chunker.chunk({ path: 'empty.ts', contents: '', language: 'typescript' });
    // Empty file produces at most 1 chunk (or 0)
    expect(chunks.length).toBeLessThanOrEqual(1);
  });
});

describe('TextChunker', () => {
  const chunker = new TextChunker(10, 2);

  it('chunks content into sliding windows', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunker.chunk({ path: 'foo.md', contents: lines, language: 'markdown' });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.filePath).toBe('foo.md');
    }
  });

  it('single small file produces one chunk', () => {
    const chunks = chunker.chunk({ path: 'small.md', contents: 'hello world', language: 'markdown' });
    expect(chunks.length).toBe(1);
  });
});

describe('getChunker', () => {
  it('returns TreeChunker for typescript', () => {
    expect(getChunker('typescript')).toBeInstanceOf(TreeChunker);
  });

  it('returns TextChunker for unknown language', () => {
    expect(getChunker('brainfuck')).toBeInstanceOf(TextChunker);
  });

  it('returns TreeChunker for python', () => {
    expect(getChunker('python')).toBeInstanceOf(TreeChunker);
  });
});
