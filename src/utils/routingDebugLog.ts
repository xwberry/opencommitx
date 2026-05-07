import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

const debugDir = () => pathJoin(homedir(), '.opencommitx-data', 'debug');
const ndjsonPath = () => pathJoin(debugDir(), 'routing-debug.ndjson');
const seqPath = () => pathJoin(debugDir(), 'routing-debug.seq');

/** Strip U+FEFF when a UTF-8 BOM was decoded as the first code unit (e.g. IDE-saved files). */
function stripLeadingUtf8Bom(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Rewrite file without a leading BOM so NDJSON tools (e.g. fx) keep parsing. */
function stripLeadingUtf8BomFromFileIfPresent(filepath: string): void {
  if (!existsSync(filepath)) return;
  const raw = readFileSync(filepath, 'utf-8');
  if (raw.length === 0) return;
  const stripped = stripLeadingUtf8Bom(raw);
  if (stripped === raw) return;
  writeFileSync(filepath, stripped, { encoding: 'utf-8', mode: 0o600 });
}

function ensurePrivateFile(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, '', { encoding: 'utf-8', mode: 0o600 });
  }
}

/**
 * Monotonic run id for routing soak logs (best-effort; fine for local CLI).
 */
export function nextRoutingRunId(): number {
  try {
    mkdirSync(debugDir(), { recursive: true });
    const sp = seqPath();
    let n = 0;
    if (existsSync(sp)) {
      const raw = stripLeadingUtf8Bom(readFileSync(sp, 'utf-8')).trim();
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) n = parsed;
    } else {
      writeFileSync(sp, '', { encoding: 'utf-8', mode: 0o600 });
    }
    n += 1;
    writeFileSync(sp, String(n), { encoding: 'utf-8', mode: 0o600 });
    return n;
  } catch {
    return 0;
  }
}

/**
 * Append one NDJSON record (no getConfig — avoids import cycles).
 */
export function appendRoutingDebugRecord(
  record: Record<string, unknown>
): void {
  try {
    mkdirSync(debugDir(), { recursive: true });
    const np = ndjsonPath();
    ensurePrivateFile(np);
    stripLeadingUtf8BomFromFileIfPresent(np);
    appendFileSync(np, JSON.stringify(record) + '\n', { encoding: 'utf-8' });
  } catch (err) {
    process.stderr.write(
      `[ocox routing debug] Failed to write ${ndjsonPath()}: ${err}\n`
    );
  }
}
