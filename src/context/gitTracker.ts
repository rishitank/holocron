import { simpleGit, type SimpleGit } from 'simple-git';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export interface ChangedFiles {
  added: string[];
  modified: string[];
  deleted: string[];
}

/**
 * Lazy git-aware indexing guard.
 *
 * On every search(), call ensureFresh() to check if the git HEAD SHA
 * has changed since the last full/incremental index. If nothing changed
 * return immediately (<1ms). If files changed, return only the diff.
 *
 * Falls back gracefully when:
 *  - cwd is not a git repository  → always returns "full index needed"
 *  - git binary is unavailable    → always returns "full index needed"
 */
export class GitTracker {
  private readonly shaFile: string;

  constructor(private readonly persistPath: string) {
    this.shaFile = join(persistPath, '.darth-last-sha');
  }

  /** True if the directory is inside a git repository. */
  async isGitRepo(repoPath: string): Promise<boolean> {
    try {
      const git = this.makeGit(repoPath);
      await git.revparse(['--show-toplevel']);
      return true;
    } catch {
      return false;
    }
  }

  /** Read the SHA of HEAD, or null on failure. */
  async getCurrentSha(repoPath: string): Promise<string | null> {
    try {
      const git = this.makeGit(repoPath);
      const sha = await git.revparse(['HEAD']);
      return sha.trim();
    } catch {
      return null;
    }
  }

  /** Read the last indexed SHA from the persist file. */
  async getLastIndexedSha(): Promise<string | null> {
    try {
      const content = await readFile(this.shaFile, 'utf8');
      return content.trim() || null;
    } catch {
      return null;
    }
  }

  /** Persist the current indexed SHA. */
  async saveLastIndexedSha(sha: string): Promise<void> {
    await writeFile(this.shaFile, sha, 'utf8');
  }

  /** Clear the stored SHA, forcing a full re-index on next call. */
  async clearLastIndexedSha(): Promise<void> {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(this.shaFile, { force: true });
    } catch {
      // ignore
    }
  }

  /**
   * Compute the files changed between lastSha and currentSha.
   * Returns paths relative to repoPath converted to absolute paths.
   */
  async getChangedFiles(repoPath: string, lastSha: string, currentSha: string): Promise<ChangedFiles> {
    const git = this.makeGit(repoPath);
    const diffSummary = await git.diffSummary([lastSha, currentSha]);

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const file of diffSummary.files) {
      const absPath = join(repoPath, file.file);
      if ('insertions' in file) {
        // DiffResultTextFile — check if it was deleted via git status
        const changes = await git
          .diff(['--name-status', lastSha, currentSha, '--', file.file])
          .catch(() => '');
        const status = changes.trim().split('\t')[0];
        if (status === 'D') {
          deleted.push(absPath);
        } else if (status === 'A') {
          added.push(absPath);
        } else {
          modified.push(absPath);
        }
      }
    }

    return { added, modified, deleted };
  }

  /**
   * Determine what indexing work is needed.
   *
   * Returns:
   *  - `{ action: 'none' }` — nothing changed since last index
   *  - `{ action: 'full', currentSha }` — first run or SHA unavailable
   *  - `{ action: 'incremental', currentSha, changes }` — git diff available
   */
  async checkFreshness(
    repoPath: string,
  ): Promise<
    | { action: 'none' }
    | { action: 'full'; currentSha: string | null }
    | { action: 'incremental'; currentSha: string; changes: ChangedFiles }
  > {
    const isGit = await this.isGitRepo(repoPath);
    if (!isGit) {
      // Non-git directory: always do a full index if never indexed
      const lastSha = await this.getLastIndexedSha();
      if (lastSha === 'non-git-indexed') return { action: 'none' };
      return { action: 'full', currentSha: null };
    }

    const currentSha = await this.getCurrentSha(repoPath);
    if (!currentSha) return { action: 'full', currentSha: null };

    const lastSha = await this.getLastIndexedSha();
    if (!lastSha) return { action: 'full', currentSha };

    if (currentSha === lastSha) return { action: 'none' };

    try {
      const changes = await this.getChangedFiles(repoPath, lastSha, currentSha);
      return { action: 'incremental', currentSha, changes };
    } catch {
      // git diff failed (e.g. shallow clone, corrupt object) — safe fallback is full re-index
      return { action: 'full', currentSha };
    }
  }

  private makeGit(cwd: string): SimpleGit {
    return simpleGit(cwd);
  }
}
