import { existsSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

const CACHE_FILE = pathJoin(homedir(), '.opencommit-cache.json');

// Mock getConfig to control OCO_CACHE_ENABLED and OCO_CACHE_TTL_SECONDS
jest.mock('../../src/commands/config', () => ({
  getConfig: jest.fn().mockReturnValue({
    OCO_CACHE_ENABLED: true,
    OCO_CACHE_TTL_SECONDS: 3600
  })
}));

import {
  hashDiff,
  getCachedCommitMessage,
  setCachedCommitMessage,
  clearCommitCache,
  formatCacheAge
} from '../../src/utils/commitCache';

describe('commitCache', () => {
  beforeEach(() => {
    if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
  });

  afterAll(() => {
    if (existsSync(CACHE_FILE)) rmSync(CACHE_FILE);
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
  });

  describe('setCachedCommitMessage / getCachedCommitMessage', () => {
    it('returns null when no cache exists', () => {
      const result = getCachedCommitMessage('new diff');
      expect(result).toBeNull();
    });

    it('stores and retrieves a commit message', () => {
      const diff = 'diff --git a/foo.ts b/foo.ts\n+const x = 1;';
      const message = 'fix(foo): add constant x';
      setCachedCommitMessage(diff, message, ['foo.ts']);

      const cached = getCachedCommitMessage(diff);
      expect(cached).not.toBeNull();
      expect(cached!.message).toBe(message);
      expect(cached!.files).toEqual(['foo.ts']);
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

      // Manually set the timestamp to be older than TTL
      const store = JSON.parse(require('fs').readFileSync(CACHE_FILE, 'utf-8'));
      const key = hashDiff(diff);
      store[key].timestamp = Date.now() - 4000 * 1000; // 4000 seconds ago
      writeFileSync(CACHE_FILE, JSON.stringify(store));

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
