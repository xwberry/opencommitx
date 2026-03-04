import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';

import {
  hashDiff,
  getCachedCommitMessage,
  getCacheFilePath,
  setCachedCommitMessage,
  clearCommitCache,
  formatCacheAge
} from '../../src/utils/commitCache';

describe('commitCache', () => {
  beforeEach(() => {
    process.env.OCO_CACHE_ENABLED = 'true';
    process.env.OCO_CACHE_TTL_SECONDS = '3600';
    const cacheFile = getCacheFilePath();
    if (existsSync(cacheFile)) rmSync(cacheFile);
  });

  afterEach(() => {
    delete process.env.OCO_CACHE_ENABLED;
    delete process.env.OCO_CACHE_TTL_SECONDS;
  });

  afterAll(() => {
    const cacheFile = getCacheFilePath();
    if (existsSync(cacheFile)) rmSync(cacheFile);
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

    it('returns the same hash for diffs that differ only in whitespace (formatter tolerance)', () => {
      const before =
        'diff --git a/x.py b/x.py\n' +
        '+x=1+2\n' +
        '+y  =  "hello"\n';
      const afterRuff =
        'diff --git a/x.py b/x.py\n' +
        '+x = 1 + 2\n' +       // ruff added spaces around =
        '+y = "hello"\n';      // ruff normalised spacing
      expect(hashDiff(before)).toBe(hashDiff(afterRuff));
    });

    it('returns different hashes when content (not just whitespace) changes', () => {
      const a = 'diff --git a/x.py b/x.py\n+x = 1\n';
      const b = 'diff --git a/x.py b/x.py\n+x = 2\n';  // different value
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
      const diff = 'some diff';
      const message = 'fix: something';
      setCachedCommitMessage(diff, message);

      const cacheFile = getCacheFilePath();
      const store = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      const key = hashDiff(diff);
      store[key].timestamp = Date.now() - 4000 * 1000;
      writeFileSync(cacheFile, JSON.stringify(store));

      expect(getCachedCommitMessage(diff)).toBeNull();
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
