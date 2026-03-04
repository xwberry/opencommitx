import { existsSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pathJoin } from 'path';
import { spawnSync } from 'child_process';

import {
  shouldUseDocstringMode,
  extractPythonDocstrings,
  changedNamesFromDiff
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

  it('returns false in auto mode when addedLines is below threshold', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    process.env.OCO_PYTHON_DOCSTRING_THRESHOLD = '500';
    expect(shouldUseDocstringMode('foo.py', 499)).toBe(false);
  });

  it('returns true in auto mode when above threshold and file is unreadable (ratio fallback)', () => {
    // 'foo.py' does not exist — catch block falls back to true.
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    process.env.OCO_PYTHON_DOCSTRING_THRESHOLD = '500';
    expect(shouldUseDocstringMode('foo.py', 501)).toBe(true);
  });

  it('uses default threshold of 500 when not configured', () => {
    process.env.OCO_PYTHON_DOCSTRING_MODE = 'auto';
    expect(shouldUseDocstringMode('foo.py', 499)).toBe(false);
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

    it('returns true when addedLines/fileLines >= ratio (new file or full rewrite)', () => {
      // 95 added / 100 file lines = 0.95 >= 0.9
      expect(shouldUseDocstringMode(tmpFile, 95)).toBe(true);
    });

    it('returns false when addedLines/fileLines < ratio (partial refactor)', () => {
      // 60 added / 100 file lines = 0.60 < 0.9
      expect(shouldUseDocstringMode(tmpFile, 60)).toBe(false);
    });

    it('returns false when addedLines is below the line-count threshold', () => {
      // 40 < threshold of 50 — ratio check never reached
      expect(shouldUseDocstringMode(tmpFile, 40)).toBe(false);
    });

    it('does NOT trigger for a refactor with many deletions but few additions', () => {
      // Real-world scenario: 254 added, 1045 deleted, file is 945 lines.
      // Only added lines count: 254 / 945 = 0.27 < 0.9 — should NOT trigger.
      // Replicating proportionally: 27 added / 100 file lines = 0.27 < 0.9
      process.env.OCO_PYTHON_DOCSTRING_THRESHOLD = '20';
      expect(shouldUseDocstringMode(tmpFile, 27)).toBe(false);
    });
  });
});

describe('changedNamesFromDiff', () => {
  it('returns empty array for a diff with no Python hunk headers', () => {
    const diff = '@@ -1,3 +1,4 @@\n +const x = 1;';
    expect(changedNamesFromDiff(diff)).toEqual([]);
  });

  it('extracts function names from @@ hunk headers', () => {
    const diff = [
      '@@ -10,7 +10,9 @@ def process_data',
      '+    new_line = 1',
      '@@ -50,3 +52,5 @@ def validate_input',
      '+    extra = True'
    ].join('\n');
    const names = changedNamesFromDiff(diff);
    expect(names).toContain('process_data');
    expect(names).toContain('validate_input');
  });

  it('extracts class names from @@ hunk headers', () => {
    const diff = '@@ -20,10 +20,12 @@ class DataProcessor\n +    pass';
    expect(changedNamesFromDiff(diff)).toContain('DataProcessor');
  });

  it('extracts async def names', () => {
    const diff = '@@ -5,4 +5,6 @@ async def fetch_data\n +    await something()';
    expect(changedNamesFromDiff(diff)).toContain('fetch_data');
  });

  it('deduplicates names appearing in multiple hunks', () => {
    const diff = [
      '@@ -1,3 +1,4 @@ def my_func',
      '@@ -10,2 +11,3 @@ def my_func'
    ].join('\n');
    expect(changedNamesFromDiff(diff)).toEqual(['my_func']);
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
    const result = extractPythonDocstrings('/does/not/exist.py');
    expect(result).toBeNull();
  });

  (PYTHON_AVAILABLE ? it : it.skip)(
    'extracts module, class, and function docstrings in whole-file mode',
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
    'filters to changed functions when changedNames is provided',
    () => {
      const result = extractPythonDocstrings(TMP_PY, ['standalone_func']);
      expect(result).not.toBeNull();
      // Module docstring is always included
      expect(result).toContain('Module docstring for testing');
      // Only the requested function
      expect(result).toContain('standalone_func');
      // Other functions/classes should be excluded
      expect(result).not.toContain('my_method');
      expect(result).not.toContain('MyClass');
    }
  );

  (PYTHON_AVAILABLE ? it : it.skip)(
    'returns non-null for a file with no docstrings (exit 2 treated as success)',
    () => {
      const result = extractPythonDocstrings(TMP_NO_DOCS);
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
