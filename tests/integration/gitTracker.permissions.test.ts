import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { GitTracker } from '../../src/context/gitTracker.js';

// Real-filesystem checks for the SHA file's permissions. File modes are a
// property of the OS, so a mocked fs can't prove them; the unit suite in
// tests/unit/context/gitTracker.test.ts covers the logic.
describe.skipIf(process.platform === 'win32')('GitTracker SHA file permissions', () => {
  let dir: string;
  let tracker: GitTracker;
  const shaFile = (): string => join(dir, '.holocron-last-sha');

  beforeEach(async () => {
    // mkdtemp: unique, unpredictable name created 0700 in the shared tmp dir.
    dir = await mkdtemp(join(tmpdir(), 'holocron-gt-perm-'));
    tracker = new GitTracker(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the SHA file owner-only (0600)', async () => {
    await tracker.saveLastIndexedSha('deadbeef');
    expect((await stat(shaFile())).mode & 0o777).toBe(0o600);
  });

  it('tightens an existing, looser SHA file to 0600', async () => {
    await writeFile(shaFile(), 'old', { mode: 0o644 });
    await tracker.saveLastIndexedSha('deadbeef');
    expect((await stat(shaFile())).mode & 0o777).toBe(0o600);
    expect(await tracker.getLastIndexedSha()).toBe('deadbeef');
  });
});
