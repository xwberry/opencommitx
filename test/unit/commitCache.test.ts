import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

import {
  archiveCacheEntry,
  clearCommitCache,
  formatCacheAge,
  getCachedCommitMessage,
  getCacheFilePath,
  getRepoCacheDir,
  hashDiff,
  setCachedCommitMessage
} from '../../src/utils/commitCache';

// Helpers to nuke the test repo's cache dir between runs.
function wipeCacheDir() {
  try {
    const dir = getRepoCacheDir();
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
}

describe('commitCache', () => {
  beforeEach(() => {
    process.env.OCO_CACHE_ENABLED = 'true';
    process.env.OCO_CACHE_TTL_SECONDS = '3600';
    wipeCacheDir();
  });

  afterEach(() => {
    delete process.env.OCO_CACHE_ENABLED;
    delete process.env.OCO_CACHE_TTL_SECONDS;
  });

  afterAll(() => {
    wipeCacheDir();
  });

  describe('hashDiff', () => {
    it('returns a 16-char hex string', () => {
      const hash = hashDiff('some diff content');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('returns the same hash for the same input', () => {
      const diff = 'diff --git a/foo.ts b/foo.ts\n+const x = 1;';
      expect(hashDiff(diff)).toBe(hashDiff(diff));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashDiff('diff A')).not.toBe(hashDiff('diff B'));
    });

    it('preserves internal whitespace so whitespace-significant edits do not collide', () => {
      const before =
        'diff --git a/x.py b/x.py\n' +
        '+x  =  1\n' + // multiple spaces around =
        '+y     =  "hello"\n'; // multiple spaces
      const afterRuff =
        'diff --git a/x.py b/x.py\n' +
        '+x = 1\n' + // single spaces (ruff normalized)
        '+y = "hello"\n';
      expect(hashDiff(before)).not.toBe(hashDiff(afterRuff));
    });

    it('ignores trailing whitespace on added or removed lines', () => {
      const before = 'diff --git a/x.py b/x.py\n+x = 1   \n-y = 2\t\n';
      const after = 'diff --git a/x.py b/x.py\n+x = 1\n-y = 2\n';
      expect(hashDiff(before)).toBe(hashDiff(after));
    });

    it('returns different hashes when content (not just whitespace) changes', () => {
      const a = 'diff --git a/x.py b/x.py\n+x = 1\n';
      const b = 'diff --git a/x.py b/x.py\n+x = 2\n';
      expect(hashDiff(a)).not.toBe(hashDiff(b));
    });
  });

  describe('setCachedCommitMessage / getCachedCommitMessage', () => {
    it('returns null when no cache exists', () => {
      const result = getCachedCommitMessage('new diff');
      expect(result).toBeNull();
    });

    it('stores and retrieves a commit message with explicit files', () => {
      const diff = 'diff --git a/foo.ts b/foo.ts\n+const x = 1;';
      const message = 'fix(foo): add constant x';
      setCachedCommitMessage(diff, message, ['foo.ts']);

      const cached = getCachedCommitMessage(diff);
      expect(cached).not.toBeNull();
      expect(cached!.message).toBe(message);
      expect(cached!.files).toEqual(['foo.ts']);
    });

    it('stores the model name when provided', () => {
      const diff = 'diff --git a/bar.ts b/bar.ts\n+const y = 2;';
      setCachedCommitMessage(
        diff,
        'feat: add y',
        ['bar.ts'],
        'claude-3-5-haiku-20241022'
      );

      const cached = getCachedCommitMessage(diff);
      expect(cached).not.toBeNull();
      expect(cached!.model).toBe('claude-3-5-haiku-20241022');
    });

    it('infers files from diff when files arg is omitted', () => {
      const diff =
        'diff --git a/src/utils.ts b/src/utils.ts\n' +
        'index abc..def 100644\n' +
        '--- a/src/utils.ts\n' +
        '+++ b/src/utils.ts\n' +
        '+const y = 2;';
      setCachedCommitMessage(diff, 'feat: add y');

      const cached = getCachedCommitMessage(diff);
      expect(cached).not.toBeNull();
      expect(cached!.files).toEqual(['src/utils.ts']);
    });

    it('returns null for a different diff', () => {
      const diff1 = 'diff A';
      const diff2 = 'diff B';
      setCachedCommitMessage(diff1, 'message for A');
      expect(getCachedCommitMessage(diff2)).toBeNull();
    });

    it('returns null when entry is expired', () => {
      const diff = 'some diff for expiry test';
      setCachedCommitMessage(diff, 'fix: something');

      // Overwrite the cache file with a stale timestamp.
      const filePath = getCacheFilePath(hashDiff(diff));
      const entry = JSON.parse(readFileSync(filePath, 'utf-8'));
      entry.timestamp = Date.now() - 4000 * 1000;
      writeFileSync(filePath, JSON.stringify(entry));

      expect(getCachedCommitMessage(diff)).toBeNull();
    });

    it('each diff gets its own JSON file', () => {
      const diff1 = 'diff group 1 content';
      const diff2 = 'diff group 2 content';
      setCachedCommitMessage(diff1, 'msg 1');
      setCachedCommitMessage(diff2, 'msg 2');

      const file1 = getCacheFilePath(hashDiff(diff1));
      const file2 = getCacheFilePath(hashDiff(diff2));
      expect(file1).not.toBe(file2);
      expect(existsSync(file1)).toBe(true);
      expect(existsSync(file2)).toBe(true);
    });
  });

  describe('archiveCacheEntry', () => {
    it('moves the cache file to the archived/ subdirectory', () => {
      const diff = 'diff to archive';
      setCachedCommitMessage(diff, 'feat: archived');
      const liveFile = getCacheFilePath(hashDiff(diff));
      expect(existsSync(liveFile)).toBe(true);

      archiveCacheEntry(diff);
      expect(existsSync(liveFile)).toBe(false);
    });

    it('is a no-op for diffs that were never cached', () => {
      expect(() => archiveCacheEntry('never cached diff')).not.toThrow();
    });
  });

  describe('clearCommitCache', () => {
    it('removes all cached entries', () => {
      setCachedCommitMessage('diff1', 'message 1');
      setCachedCommitMessage('diff2', 'message 2');
      clearCommitCache();
      expect(getCachedCommitMessage('diff1')).toBeNull();
      expect(getCachedCommitMessage('diff2')).toBeNull();
    });
  });

  describe('formatCacheAge', () => {
    it('formats seconds correctly', () => {
      const ts = Date.now() - 30_000;
      expect(formatCacheAge(ts)).toMatch(/\d+ second/);
    });

    it('formats minutes correctly', () => {
      const ts = Date.now() - 5 * 60_000;
      expect(formatCacheAge(ts)).toMatch(/5 minute/);
    });

    it('formats hours correctly', () => {
      const ts = Date.now() - 2 * 3600_000;
      expect(formatCacheAge(ts)).toMatch(/2 hour/);
    });
  });
});
