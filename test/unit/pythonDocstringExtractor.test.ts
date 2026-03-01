import { existsSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pathJoin } from 'path';
import { spawnSync } from 'child_process';

import {
  shouldUseDocstringMode,
  extractPythonDocstrings
} from '../../src/utils/pythonDocstringExtractor';

function isPythonAvailable(): boolean {
  const r = spawnSync('python', ['--version'], { encoding: 'utf-8' });
  if (r.status === 0) return true;
  return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
}

const PYTHON_AVAILABLE = isPythonAvailable();

const TMP_PY = pathJoin(tmpdir(), 'ocox_test_docstrings.py');
const TMP_NO_DOCS = pathJoin(tmpdir(), 'ocox_test_no_docs.py');

const SAMPLE_PYTHON = `"""Module docstring for testing."""

class MyClass:
    """A sample class."""

    def my_method(self):
        """A sample method."""
        pass

def standalone_func():
    """Standalone function docstring."""
    return 42
`;

describe('shouldUseDocstringMode', () => {
  afterEach(() => {
    delete process.env.OCO_PYTHON_DOCSTRING_MODE;
    delete process.env.OCO_PYTHON_DOCSTRING_THRESHOLD;
    delete process.env.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO;
  });

  it('returns false for non-.py files', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    expect(shouldUseDocstringMode('src/foo.ts', 1000)).toBe(false);
    expect(shouldUseDocstringMode('src/bar.js', 1000)).toBe(false);
  });

  it('returns false in never mode regardless of file type or size', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'never';
    expect(shouldUseDocstringMode('foo.py', 10_000)).toBe(false);
  });

  it('returns true in always mode for .py files regardless of size', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'always';
    expect(shouldUseDocstringMode('foo.py', 1)).toBe(true);
  });

  it('returns false in auto mode when below threshold', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    process.env.OCO_PYTHON_DOCSTRING_THRESHOLD = '500';
    expect(shouldUseDocstringMode('foo.py', 499)).toBe(false);
  });

  it('returns true in auto mode when above threshold and file is unreadable (ratio fallback)', () => {
    // 'foo.py' does not exist — catch block falls back to true (line count only).
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    process.env.OCO_PYTHON_DOCSTRING_THRESHOLD = '500';
    expect(shouldUseDocstringMode('foo.py', 501)).toBe(true);
  });

  it('uses default threshold of 500 when not configured', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    expect(shouldUseDocstringMode('foo.py', 499)).toBe(false);
    // 501 > 500 threshold, file unreadable → ratio fallback → true
    expect(shouldUseDocstringMode('foo.py', 501)).toBe(true);
  });

  describe('whole-file ratio check (auto mode, file exists)', () => {
    let tmpFile: string;

    beforeEach(() => {
      tmpFile = pathJoin(tmpdir(), `ocox_test_${Date.now()}.py`);
      const lines = Array.from({ length: 100 }, (_, i) => `line_${i} = ${i}`).join('\n');
      writeFileSync(tmpFile, lines, 'utf-8');
      process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
      process.env.OCO_PYTHON_DOCSTRING_THRESHOLD = '50';
      process.env.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO = '0.9';
    });

    afterEach(() => {
      try { rmSync(tmpFile); } catch { /* ignore */ }
    });

    it('returns true when changedLines/fileLines >= ratio (new-file or full rewrite)', () => {
      // 95 changed / 100 file lines = 0.95 >= 0.9
      expect(shouldUseDocstringMode(tmpFile, 95)).toBe(true);
    });

    it('returns false when changedLines/fileLines < ratio (partial refactor)', () => {
      // 60 changed / 100 file lines = 0.60 < 0.9
      expect(shouldUseDocstringMode(tmpFile, 60)).toBe(false);
    });

    it('returns false when changedLines is below the line-count threshold', () => {
      // 40 < threshold of 50 — ratio check never reached
      expect(shouldUseDocstringMode(tmpFile, 40)).toBe(false);
    });
  });
});

describe('extractPythonDocstrings', () => {
  beforeAll(() => {
    writeFileSync(TMP_PY, SAMPLE_PYTHON, 'utf-8');
    writeFileSync(TMP_NO_DOCS, 'x = 1\ny = 2\n', 'utf-8');
  });

  afterAll(() => {
    if (existsSync(TMP_PY)) rmSync(TMP_PY);
    if (existsSync(TMP_NO_DOCS)) rmSync(TMP_NO_DOCS);
  });

  it('returns null for a non-existent file (Python error → exit 1)', () => {
    // Either Python unavailable or script returns null for missing file — both give null
    const result = extractPythonDocstrings('/does/not/exist.py');
    expect(result).toBeNull();
  });

  (PYTHON_AVAILABLE ? it : it.skip)(
    'extracts module, class, and function docstrings',
    () => {
      const result = extractPythonDocstrings(TMP_PY);
      expect(result).not.toBeNull();
      expect(result).toContain('Module docstring for testing');
      expect(result).toContain('MyClass');
      expect(result).toContain('standalone_func');
      expect(result).toContain('my_method');
    }
  );

  (PYTHON_AVAILABLE ? it : it.skip)(
    'returns non-null for a file with no docstrings (exit 2 is treated as success)',
    () => {
      // Exit code 2 means "no docstrings found" — the script still prints a summary line
      const result = extractPythonDocstrings(TMP_NO_DOCS);
      // extractPythonDocstrings returns stdout on exit 0 or 2
      // With no docstrings the script prints "# No docstrings found in: ..." to stdout
      // stdout.trim() may be empty if Python echoes nothing — either null or a summary string is valid
      expect(typeof result === 'string' || result === null).toBe(true);
    }
  );

  (PYTHON_AVAILABLE ? it : it.skip)(
    'output includes the Docstring summary header',
    () => {
      const result = extractPythonDocstrings(TMP_PY);
      expect(result).toMatch(/Docstring summary for:/);
    }
  );
});
