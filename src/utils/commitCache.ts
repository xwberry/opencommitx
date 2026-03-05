import { createHash } from 'crypto';
import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs';
import { homedir } from 'os';
import { basename, join as pathJoin } from 'path';
import { getConfig } from '../commands/config';

const CACHE_BASE_DIR = pathJoin(homedir(), '.opencommitx-data');

interface CacheEntry {
  message: string;
  timestamp: number;
  files: string[];
  model?: string;
  committed?: boolean;
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
 * Return the per-repo cache directory, creating it if needed.
 * Per-repo dir: ~/.opencommitx-data/<repoName>-<repoHash>/
 * Falls back to a global 'global' subdir outside a repo.
 */
export function getRepoCacheDir(): string {
  mkdirSync(CACHE_BASE_DIR, { recursive: true });

  const repoRoot = getRepoRootSync();
  if (!repoRoot) {
    const dir = pathJoin(CACHE_BASE_DIR, 'global');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  const repoName = basename(repoRoot);
  const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 8);
  const dir = pathJoin(CACHE_BASE_DIR, `${repoName}-${repoHash}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Archive sub-directory for committed entries awaiting TTL cleanup. */
function getArchiveDir(): string {
  const dir = pathJoin(getRepoCacheDir(), 'archived');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Return the cache file path for a specific diff hash.
 * Exported so tests can locate and clean up individual files.
 */
export function getCacheFilePath(diffHash: string): string {
  return pathJoin(getRepoCacheDir(), `${diffHash}.json`);
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
        return line[0] + line.slice(1).replace(/[ \t]+/g, ' ').trimEnd();
      }
      return line;
    })
    .join('\n');
}

export function hashDiff(diff: string): string {
  return createHash('sha256').update(normalizeForHashing(diff)).digest('hex').slice(0, 16);
}

function readEntry(diffHash: string): CacheEntry | null {
  const file = getCacheFilePath(diffHash);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeEntry(diffHash: string, entry: CacheEntry): void {
  try {
    writeFileSync(getCacheFilePath(diffHash), JSON.stringify(entry, null, 2), {
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
  const entry = readEntry(key);

  if (!entry) return null;

  const ageSeconds = (Date.now() - entry.timestamp) / 1000;
  if (ageSeconds > ttlSeconds) {
    try {
      const file = getCacheFilePath(key);
      if (existsSync(file)) {
        const archiveFile = pathJoin(getArchiveDir(), `${key}.json`);
        renameSync(file, archiveFile);
      }
    } catch { /* non-fatal */ }
    return null;
  }

  return entry;
}

/**
 * Write a commit message to the cache.
 * @param diff    The diff text for this group (used as the cache key).
 * @param message The generated commit message.
 * @param files   Staged file paths. Inferred from the diff when not supplied.
 * @param model   The model that produced this message. Defaults to OCO_MODEL from config.
 *                Pass explicitly when a fallback model was used so the cache records the
 *                model that actually generated the response.
 */
export function setCachedCommitMessage(
  diff: string,
  message: string,
  files?: string[],
  model?: string
): void {
  const config = getConfig();
  if (!config.OCO_CACHE_ENABLED) return;

  const resolvedFiles = files ?? filesFromDiff(diff);
  const key = hashDiff(diff);

  writeEntry(key, {
    message,
    timestamp: Date.now(),
    files: resolvedFiles,
    model: model ?? config.OCO_MODEL ?? undefined
  });
}

/**
 * Mark a cache entry as committed and move it to the archive directory.
 * Called after a successful `git commit` for the corresponding diff.
 */
export function archiveCacheEntry(diff: string): void {
  const key = hashDiff(diff);
  try {
    const file = getCacheFilePath(key);
    if (!existsSync(file)) return;
    const archiveFile = pathJoin(getArchiveDir(), `${key}.json`);
    renameSync(file, archiveFile);
  } catch { /* non-fatal */ }
}

/**
 * Delete archived cache entries older than retentionDays.
 * Called opportunistically at startup.
 */
export function pruneArchivedCache(retentionDays: number = 7): void {
  try {
    const archiveDir = getArchiveDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const file of readdirSync(archiveDir)) {
      if (!file.endsWith('.json')) continue;
      const filePath = pathJoin(archiveDir, file);
      try {
        const entry: CacheEntry = JSON.parse(readFileSync(filePath, 'utf-8'));
        if (entry.timestamp < cutoff) {
          // Use unlinkSync via dynamic import to avoid direct fs import
          unlinkSync(filePath);
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* non-fatal */ }
}

export function clearCommitCache(): void {
  try {
    const cacheDir = getRepoCacheDir();
    for (const file of readdirSync(cacheDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        unlinkSync(pathJoin(cacheDir, file));
      } catch { /* skip */ }
    }

    const archiveDir = pathJoin(cacheDir, 'archived');
    if (existsSync(archiveDir)) {
      for (const file of readdirSync(archiveDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          unlinkSync(pathJoin(archiveDir, file));
        } catch { /* skip */ }
      }
    }
  } catch { /* non-fatal */ }
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
