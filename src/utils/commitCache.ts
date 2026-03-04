import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join as pathJoin } from 'path';
import { getConfig } from '../commands/config';

// Separate from ~/.opencommitx which is the config FILE.
const CACHE_DIR = pathJoin(homedir(), '.opencommitx-data');

interface CacheEntry {
  message: string;
  timestamp: number;
  files: string[];
}

interface CacheStore {
  [diffHash: string]: CacheEntry;
}

/** Extract staged file paths from a unified diff string. */
function filesFromDiff(diff: string): string[] {
  const matches = diff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm);
  return [...matches].map((m) => m[1]);
}

/** Get the git repo root synchronously (returns null outside a git repo). */
function getRepoRootSync(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Return the cache file path for the current repo.
 * Files live in ~/.opencommitx-data/ — one JSON file per repository.
 * Falls back to a global cache.json when not inside a git repo.
 * Exported so tests can locate and clean up the file.
 */
export function getCacheFilePath(): string {
  mkdirSync(CACHE_DIR, { recursive: true });

  const repoRoot = getRepoRootSync();
  if (!repoRoot) return pathJoin(CACHE_DIR, 'cache.json');

  const repoName = basename(repoRoot);
  const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);
  return pathJoin(CACHE_DIR, `cache-${repoName}-${repoHash}.json`);
}

/**
 * Normalise diff content lines before hashing so that whitespace-only changes
 * (e.g. ruff/black formatting) produce the same hash as the original.
 * Structural diff lines (@@, diff, index, ---/+++) are kept verbatim.
 */
function normalizeForHashing(diff: string): string {
  return diff
    .split('\n')
    .map((line) => {
      if (
        (line.startsWith('+') && !line.startsWith('+++')) ||
        (line.startsWith('-') && !line.startsWith('---'))
      ) {
        // Collapse internal runs of whitespace and strip trailing whitespace.
        return line[0] + line.slice(1).replace(/[ \t]+/g, ' ').trimEnd();
      }
      return line;
    })
    .join('\n');
}

export function hashDiff(diff: string): string {
  return createHash('sha256').update(normalizeForHashing(diff)).digest('hex').slice(0, 16);
}

function readCache(): CacheStore {
  const file = getCacheFilePath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(store: CacheStore): void {
  try {
    writeFileSync(getCacheFilePath(), JSON.stringify(store, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
  } catch {
    // Cache is best-effort; ignore write failures.
  }
}

export function getCachedCommitMessage(diff: string): CacheEntry | null {
  const config = getConfig();
  if (!config.OCO_CACHE_ENABLED) return null;

  const ttlSeconds = config.OCO_CACHE_TTL_SECONDS ?? 3600;
  const key = hashDiff(diff);
  const store = readCache();
  const entry = store[key];

  if (!entry) return null;

  const ageSeconds = (Date.now() - entry.timestamp) / 1000;
  if (ageSeconds > ttlSeconds) {
    delete store[key];
    writeCache(store);
    return null;
  }

  return entry;
}

/**
 * Write a commit message to the cache.
 * @param diff    The full diff text (used as the cache key).
 * @param message The generated commit message.
 * @param files   Staged file paths. Inferred from the diff when not supplied.
 */
export function setCachedCommitMessage(
  diff: string,
  message: string,
  files?: string[]
): void {
  const config = getConfig();
  if (!config.OCO_CACHE_ENABLED) return;

  const resolvedFiles = files ?? filesFromDiff(diff);
  const key = hashDiff(diff);
  const store = readCache();

  store[key] = {
    message,
    timestamp: Date.now(),
    files: resolvedFiles
  };

  writeCache(store);
}

export function clearCommitCache(): void {
  writeCache({});
}

export function formatCacheAge(timestamp: number): string {
  const ageMs = Date.now() - timestamp;
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return `${seconds} second${seconds === 1 ? '' : 's'} ago`;
}
