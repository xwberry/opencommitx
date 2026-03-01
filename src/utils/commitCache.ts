import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';
import { getConfig } from '../commands/config';

const CACHE_FILE = pathJoin(homedir(), '.opencommitx-cache.json');

interface CacheEntry {
  message: string;
  timestamp: number;
  files: string[];
}

interface CacheStore {
  [diffHash: string]: CacheEntry;
}

export function hashDiff(diff: string): string {
  return createHash('sha256').update(diff).digest('hex').slice(0, 16);
}

function readCache(): CacheStore {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCache(store: CacheStore): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
  } catch {
    // Cache is best-effort; ignore write failures.
  }
}

export function getCachedCommitMessage(
  diff: string
): CacheEntry | null {
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

export function setCachedCommitMessage(
  diff: string,
  message: string,
  files: string[] = []
): void {
  const config = getConfig();
  if (!config.OCO_CACHE_ENABLED) return;

  const key = hashDiff(diff);
  const store = readCache();

  store[key] = {
    message,
    timestamp: Date.now(),
    files
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
