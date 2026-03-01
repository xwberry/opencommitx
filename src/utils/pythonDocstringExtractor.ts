import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join as pathJoin } from 'path';
import { getConfig } from '../commands/config';

const SCRIPT_NAME = 'extract_docstrings.py';

function findScriptPath(): string | null {
  // process.cwd() works in both dev and installed contexts (dev: project root)
  const candidates: string[] = [
    pathJoin(process.cwd(), 'scripts', SCRIPT_NAME)
  ];

  // __dirname is available in the compiled CJS bundle (esbuild out/) but NOT in ESM
  // contexts such as ts-jest. typeof check avoids a ReferenceError in ESM.
  // eslint-disable-next-line no-undef
  if (typeof __dirname !== 'undefined') {
    candidates.push(pathJoin(__dirname, '..', 'scripts', SCRIPT_NAME));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function isPythonAvailable(): boolean {
  const result = spawnSync('python', ['--version'], { encoding: 'utf-8' });
  if (result.status === 0) return true;
  const result3 = spawnSync('python3', ['--version'], { encoding: 'utf-8' });
  return result3.status === 0;
}

function getPythonCommand(): string {
  const result = spawnSync('python', ['--version'], { encoding: 'utf-8' });
  return result.status === 0 ? 'python' : 'python3';
}

/**
 * Extracts docstrings from a Python file using the bundled AST helper script.
 * Returns a formatted docstring summary, or null if extraction is unavailable.
 */
export function extractPythonDocstrings(filepath: string): string | null {
  const scriptPath = findScriptPath();
  if (!scriptPath) return null;
  if (!isPythonAvailable()) return null;

  const pythonCmd = getPythonCommand();
  const result = spawnSync(pythonCmd, [scriptPath, filepath], {
    encoding: 'utf-8',
    timeout: 10_000
  });

  if (result.status === 0 || result.status === 2) {
    return result.stdout?.trim() || null;
  }

  return null;
}

/**
 * Determines whether to use docstring-only mode for a Python file based on config
 * and the number of changed lines.
 *
 * In auto mode the check has two gates:
 *  1. changedLines must exceed OCO_PYTHON_DOCSTRING_THRESHOLD (line count guard).
 *  2. The diff must cover at least OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO of the
 *     actual file (whole-file guard).  This prevents docstring extraction on
 *     partial refactors where the real diff is more informative.
 */
export function shouldUseDocstringMode(
  filepath: string,
  changedLines: number
): boolean {
  if (!filepath.endsWith('.py')) return false;

  const config = getConfig();
  const mode = config.OCO_PYTHON_DOCSTRING_MODE || 'auto';
  const threshold = config.OCO_PYTHON_DOCSTRING_THRESHOLD ?? 500;
  const wholeFileRatio = config.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO ?? 0.9;

  if (mode === 'never') return false;
  if (mode === 'always') return true;

  if (changedLines <= threshold) return false;

  // Whole-file check: diff must cover >= wholeFileRatio of the file.
  // changedLines = added + deleted from numstat; for a new file that equals
  // the file length; for a rewrite it can exceed it (old lines + new lines).
  try {
    const fileLines = readFileSync(filepath, 'utf-8').split('\n').length;
    return changedLines / fileLines >= wholeFileRatio;
  } catch {
    // File not readable (e.g. already deleted/moved) — skip ratio check.
    return true;
  }
}
