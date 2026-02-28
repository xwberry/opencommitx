import { routeDiff } from '../../src/utils/diffRouter';
import type { FileStats } from '../../src/utils/git';

// Prevent actual Python docstring extraction in tests
jest.mock('../../src/utils/pythonDocstringExtractor', () => ({
  extractPythonDocstrings: jest.fn().mockReturnValue(null),
  shouldUseDocstringMode: jest.fn().mockReturnValue(false)
}));

describe('diffRouter', () => {
  const baseConfig = {
    OCO_PER_FILE_COMMIT_MODE: 'auto' as const,
    OCO_PER_FILE_THRESHOLD_LINES: 300,
    OCO_PYTHON_DOCSTRING_MODE: 'auto',
    OCO_PYTHON_DOCSTRING_THRESHOLD: 500
  };

  describe('never mode', () => {
    it('returns usePerFile=false regardless of file sizes', () => {
      const stats: FileStats[] = [
        { added: 500, deleted: 200, file: 'big.ts' }
      ];
      const result = routeDiff(stats, { ...baseConfig, OCO_PER_FILE_COMMIT_MODE: 'never' });
      expect(result.usePerFile).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('always mode', () => {
    it('returns usePerFile=true with one group per file', () => {
      const stats: FileStats[] = [
        { added: 10, deleted: 5, file: 'a.ts' },
        { added: 20, deleted: 2, file: 'b.ts' }
      ];
      const result = routeDiff(stats, { ...baseConfig, OCO_PER_FILE_COMMIT_MODE: 'always' });
      expect(result.usePerFile).toBe(true);
      expect(result.fileGroups).toHaveLength(2);
      expect(result.fileGroups[0].files).toEqual(['a.ts']);
      expect(result.fileGroups[1].files).toEqual(['b.ts']);
    });
  });

  describe('auto mode', () => {
    it('aggregates when all files are under threshold', () => {
      const stats: FileStats[] = [
        { added: 50, deleted: 20, file: 'small.ts' },
        { added: 30, deleted: 10, file: 'smaller.ts' }
      ];
      const result = routeDiff(stats, baseConfig);
      expect(result.usePerFile).toBe(false);
    });

    it('routes large files individually and merges small files', () => {
      const stats: FileStats[] = [
        { added: 400, deleted: 100, file: 'large.ts' },
        { added: 20, deleted: 5, file: 'small1.ts' },
        { added: 15, deleted: 3, file: 'small2.ts' }
      ];
      const result = routeDiff(stats, baseConfig);
      expect(result.usePerFile).toBe(true);
      // large.ts gets its own group
      const largeGroup = result.fileGroups.find((g) => g.files.includes('large.ts'));
      expect(largeGroup).toBeDefined();
      expect(largeGroup!.files).toEqual(['large.ts']);
      // small files are merged
      const smallGroup = result.fileGroups.find((g) => g.files.includes('small1.ts'));
      expect(smallGroup).toBeDefined();
      expect(smallGroup!.files).toContain('small2.ts');
    });

    it('returns single aggregate group when no large files', () => {
      const stats: FileStats[] = [
        { added: 100, deleted: 50, file: 'a.ts' },
        { added: 80, deleted: 30, file: 'b.ts' }
      ];
      const result = routeDiff(stats, baseConfig);
      expect(result.usePerFile).toBe(false);
      expect(result.fileGroups[0].files).toHaveLength(2);
    });

    it('filters out binary/lock files', () => {
      const stats: FileStats[] = [
        { added: 500, deleted: 0, file: 'package-lock.json' },
        { added: 50, deleted: 10, file: 'src/index.ts' }
      ];
      const result = routeDiff(stats, baseConfig);
      expect(result.fileGroups[0].files).not.toContain('package-lock.json');
    });

    it('returns no groups for empty stats', () => {
      const result = routeDiff([], baseConfig);
      expect(result.usePerFile).toBe(false);
    });
  });
});
