import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

export interface DebugLogEntry {
  timestamp: string;
  event: string;
  provider?: string;
  model?: string;
  messages?: unknown;
  response?: unknown;
  error?: string;
  meta?: Record<string, unknown>;
}

/**
 * Write a debug log entry to ~/.opencommitx-data/debug/ as a timestamped JSON file.
 *
 * Callers are responsible for checking whether debug mode is enabled before
 * calling this function (check `getConfig().OCO_DEBUG`). This avoids circular
 * imports and dynamic-require issues in the esbuild bundle.
 *
 * On failure the error is printed to stderr so the user can diagnose path/
 * permission issues without crashing the main flow.
 */
export function writeDebugLog(entry: Omit<DebugLogEntry, 'timestamp'>): void {
  // ~/.opencommitx is the config FILE; data lives under ~/.opencommitx-data/
  const debugDir = pathJoin(homedir(), '.opencommitx-data', 'debug');
  try {
    mkdirSync(debugDir, { recursive: true });
    const ts = new Date().toISOString();
    const slug = ts.replace(/[:.]/g, '-');
    const safeEvent = entry.event.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filepath = pathJoin(debugDir, `${slug}-${safeEvent}.json`);
    const payload: DebugLogEntry = { timestamp: ts, ...entry };
    writeFileSync(filepath, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8'
    });
  } catch (err) {
    process.stderr.write(
      `[ocox debug] Failed to write debug log to ${debugDir}: ${err}\n`
    );
  }
}
