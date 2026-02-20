import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

// vi.hoisted ensures mockGit is available inside the vi.mock factory (ESM hoisting)
const mockGit = vi.hoisted(() => ({
  revparse: vi.fn(),
  diffSummary: vi.fn(),
  diff: vi.fn(),
}));

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

import { GitTracker } from '../../../src/context/gitTracker.js';

describe('GitTracker', () => {
  let tmpDir: string;
  let tracker: GitTracker;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `gt-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    tracker = new GitTracker(tmpDir);
    mockGit.revparse.mockReset();
    mockGit.diffSummary.mockReset();
    mockGit.diff.mockReset();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('returns true when revparse succeeds', async () => {
      mockGit.revparse.mockResolvedValue('/repo');
      expect(await tracker.isGitRepo('/repo')).toBe(true);
    });

    it('returns false when revparse throws', async () => {
      mockGit.revparse.mockRejectedValue(new Error('not a git repo'));
      expect(await tracker.isGitRepo('/not-a-repo')).toBe(false);
    });
  });

  describe('getCurrentSha', () => {
    it('returns trimmed SHA string', async () => {
      mockGit.revparse.mockResolvedValue('abc123def\n');
      expect(await tracker.getCurrentSha('/repo')).toBe('abc123def');
    });

    it('returns null on error', async () => {
      mockGit.revparse.mockRejectedValue(new Error('fatal'));
      expect(await tracker.getCurrentSha('/bad')).toBeNull();
    });
  });

  describe('getLastIndexedSha / saveLastIndexedSha', () => {
    it('returns null when no SHA file exists', async () => {
      expect(await tracker.getLastIndexedSha()).toBeNull();
    });

    it('round-trips SHA through save and read', async () => {
      await tracker.saveLastIndexedSha('deadbeef');
      expect(await tracker.getLastIndexedSha()).toBe('deadbeef');
    });

    it('clearLastIndexedSha removes the stored SHA', async () => {
      await tracker.saveLastIndexedSha('deadbeef');
      await tracker.clearLastIndexedSha();
      expect(await tracker.getLastIndexedSha()).toBeNull();
    });
  });

  describe('checkFreshness', () => {
    it('returns action=none when SHA unchanged', async () => {
      mockGit.revparse
        .mockResolvedValueOnce('/repo') // isGitRepo check
        .mockResolvedValueOnce('sha1\n'); // getCurrentSha
      await tracker.saveLastIndexedSha('sha1');

      const result = await tracker.checkFreshness('/repo');
      expect(result.action).toBe('none');
    });

    it('returns action=full on first run (no stored SHA)', async () => {
      mockGit.revparse
        .mockResolvedValueOnce('/repo') // isGitRepo
        .mockResolvedValueOnce('sha1\n'); // getCurrentSha

      const result = await tracker.checkFreshness('/repo');
      expect(result.action).toBe('full');
      if (result.action === 'full') {
        expect(result.currentSha).toBe('sha1');
      }
    });

    it('returns action=incremental when SHA changed', async () => {
      mockGit.revparse
        .mockResolvedValueOnce('/repo') // isGitRepo
        .mockResolvedValueOnce('sha2\n'); // getCurrentSha
      mockGit.diffSummary.mockResolvedValue({
        files: [{ file: 'src/changed.ts', insertions: 5, deletions: 2 }],
        insertions: 5,
        deletions: 2,
        changed: 1,
      });
      mockGit.diff.mockResolvedValue('M\tsrc/changed.ts');

      await tracker.saveLastIndexedSha('sha1');

      const result = await tracker.checkFreshness('/repo');
      expect(result.action).toBe('incremental');
      if (result.action === 'incremental') {
        expect(result.currentSha).toBe('sha2');
      }
    });

    it('returns action=full for non-git directory on first run', async () => {
      mockGit.revparse.mockRejectedValue(new Error('not a git repo'));

      const result = await tracker.checkFreshness('/not-git');
      expect(result.action).toBe('full');
    });

    it('returns action=none for non-git directory after indexing', async () => {
      mockGit.revparse.mockRejectedValue(new Error('not a git repo'));
      await tracker.saveLastIndexedSha('non-git-indexed');

      const result = await tracker.checkFreshness('/not-git');
      expect(result.action).toBe('none');
    });
  });
});
