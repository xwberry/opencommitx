import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join as pathJoin } from 'path';
import { getConfig } from '../commands/config';

const SCRIPT_NAME = 'extract_docstrings.py';

function findScriptPath(): string | null {
  // When installed via npm (CJS bundle), __dirname points to out/
  // The scripts/ directory is at the package root (one level up)
  const candidates = [
    // Installed: out/ -> package root/scripts/
    pathJoin(__dirname, '..', 'scripts', SCRIPT_NAME),
    // Development: project root/scripts/
    pathJoin(process.cwd(), 'scripts', SCRIPT_NAME)
  ];

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
 */
export function shouldUseDocstringMode(
  filepath: string,
  changedLines: number
): boolean {
  if (!filepath.endsWith('.py')) return false;

  const config = getConfig();
  const mode = config.OCO_PYTHON_DOCSTRING_MODE || 'auto';
  const threshold = config.OCO_PYTHON_DOCSTRING_THRESHOLD ?? 500;

  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return changedLines > threshold;
}
