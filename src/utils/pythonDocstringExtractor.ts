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
 * Parse function/class names that appear in git unified-diff `@@` hunk headers.
 * Git often appends the enclosing symbol after the line numbers, e.g.:
 *   "@@ -12,7 +12,9 @@ def my_function"
 * Only captures plain identifiers that look like Python def/class names.
 */
export function changedNamesFromDiff(diff: string): string[] {
  const names = new Set<string>();
  // Match: @@ ... @@ <optional whitespace> <keyword> <name>
  for (const m of diff.matchAll(/^@@[^@]*@@\s*(?:(?:async\s+)?def|class)\s+(\w+)/gm)) {
    names.add(m[1]);
  }
  return [...names];
}

/**
 * Extracts docstrings from a Python file using the bundled AST helper script.
 *
 * @param filepath   Path to the .py file on disk.
 * @param changedNames  Optional list of function/class names to filter to
 *                   (from git diff @@ hunk headers). When provided the module
 *                   docstring is always included plus any listed symbol.
 *                   When omitted all docstrings are returned (whole-file mode).
 * @returns Formatted docstring summary string, or null if unavailable.
 */
export function extractPythonDocstrings(
  filepath: string,
  changedNames?: string[]
): string | null {
  const scriptPath = findScriptPath();
  if (!scriptPath) return null;
  if (!isPythonAvailable()) return null;

  const pythonCmd = getPythonCommand();
  const args = [scriptPath, filepath];
  if (changedNames && changedNames.length > 0) {
    args.push('--changed', changedNames.join(','));
  }

  const result = spawnSync(pythonCmd, args, {
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
 * and the number of added lines.
 *
 * In auto mode the check has two gates:
 *  1. addedLines must exceed OCO_PYTHON_DOCSTRING_THRESHOLD (line count guard).
 *  2. addedLines must cover at least OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO of the
 *     current file size (whole-file guard).
 *
 * Deleted lines are intentionally excluded from both checks. A refactor that
 * removes 1000 lines from a 2000-line file but only adds 200 new lines should
 * NOT trigger docstring mode — the actual diff is far more informative.
 * Docstring mode is appropriate only when the added content represents most of
 * the resulting file (i.e. a new file or a near-complete rewrite).
 */
export function shouldUseDocstringMode(
  filepath: string,
  addedLines: number
): boolean {
  if (!filepath.endsWith('.py')) return false;

  const config = getConfig();
  const mode = config.OCO_PYTHON_DOCSTRING_MODE || 'auto';
  const threshold = config.OCO_PYTHON_DOCSTRING_THRESHOLD ?? 500;
  const wholeFileRatio = config.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO ?? 0.9;

  if (mode === 'never') return false;
  if (mode === 'always') return true;

  if (addedLines <= threshold) return false;

  // Whole-file check: added lines must be >= wholeFileRatio of the resulting file.
  try {
    const fileLines = readFileSync(filepath, 'utf-8').split('\n').length;
    return addedLines / fileLines >= wholeFileRatio;
  } catch {
    // File not readable (e.g. already deleted/moved) — skip ratio check.
    return true;
  }
}
