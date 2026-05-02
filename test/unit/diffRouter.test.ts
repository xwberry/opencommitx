import { routeDiff } from '../../src/utils/diffRouter';
import type { FileStats } from '../../src/utils/git';

// Dependency-injected mocks — no jest.mock() path games needed.
const neverUse = () => false;
const alwaysUse = () => true;
const nullExtract = () => null;

describe('diffRouter', () => {
  const baseConfig = {
    OCO_PER_FILE_COMMIT_MODE: 'auto' as const,
    OCO_PER_FILE_THRESHOLD_LINES: 300,
    OCO_PYTHON_DOCSTRING_MODE: 'auto',
    OCO_PYTHON_DOCSTRING_THRESHOLD: 500,
    OCO_MAX_FILES_PER_GROUP: 10,
    OCO_MAX_LINES_PER_GROUP: 1500
  };

  describe('never mode', () => {
    it('returns usePerFile=false regardless of file sizes', () => {
      const stats: FileStats[] = [{ added: 500, deleted: 200, file: 'big.ts' }];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'never'
      });
      expect(result.usePerFile).toBe(false);
      expect(result.reason).toContain('disabled');
    });
  });

  describe('always mode', () => {
    it('returns usePerFile=true with one group per non-boilerplate file', () => {
      const stats: FileStats[] = [
        { added: 10, deleted: 5, file: 'a.ts' },
        { added: 20, deleted: 2, file: 'b.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'always'
      });
      expect(result.usePerFile).toBe(true);
      expect(result.fileGroups).toHaveLength(2);
      expect(result.fileGroups[0].files).toEqual(['a.ts']);
      expect(result.fileGroups[1].files).toEqual(['b.ts']);
    });

    it('groups boilerplate files together even in always mode', () => {
      const stats: FileStats[] = [
        { added: 10, deleted: 5, file: 'src/foo.ts' },
        { added: 5, deleted: 2, file: 'src/__init__.py' },
        { added: 3, deleted: 0, file: 'lib/__init__.py' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'always'
      });
      expect(result.usePerFile).toBe(true);
      // foo.ts gets its own group; both __init__.py files go together
      const boilerplateGroup = result.fileGroups.find((g) =>
        g.files.some((f) => f.endsWith('__init__.py'))
      );
      expect(boilerplateGroup).toBeDefined();
      expect(boilerplateGroup!.files).toHaveLength(2);
      const fooGroup = result.fileGroups.find((g) =>
        g.files.includes('src/foo.ts')
      );
      expect(fooGroup!.files).toHaveLength(1);
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
      const largeGroup = result.fileGroups.find((g) =>
        g.files.includes('large.ts')
      );
      expect(largeGroup).toBeDefined();
      expect(largeGroup!.files).toEqual(['large.ts']);
      const smallGroup = result.fileGroups.find((g) =>
        g.files.includes('small1.ts')
      );
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

    it('attaches lock files to a group rather than silently dropping them', () => {
      // package-lock.json is binary/generated so it is excluded from the diff
      // content sent to the LLM, but it is appended to a group so it is committed.
      const stats: FileStats[] = [
        { added: 500, deleted: 0, file: 'package-lock.json' },
        { added: 50, deleted: 10, file: 'src/index.ts' }
      ];
      const result = routeDiff(stats, baseConfig);
      const allGroupFiles = result.fileGroups.flatMap((g) => g.files);
      // package-lock.json should be in some group (attached to last group as fallback)
      expect(allGroupFiles).toContain('package-lock.json');
      // src/index.ts should be in the main diff group
      expect(allGroupFiles).toContain('src/index.ts');
    });

    it('returns no groups for empty stats', () => {
      const result = routeDiff([], baseConfig);
      expect(result.usePerFile).toBe(false);
    });

    it('attaches docstringOverride when shouldUseDocstringMode returns true', () => {
      const extractResult =
        '## module: big_module.py (line 1)\nModule docstring here.';
      const stats: FileStats[] = [
        { added: 600, deleted: 50, file: 'big_module.py' }
      ];
      const result = routeDiff(
        stats,
        baseConfig,
        alwaysUse,
        () => extractResult
      );
      expect(result.usePerFile).toBe(true);
      expect(result.fileGroups[0].docstringOverride).toContain(
        'Module docstring here'
      );
    });

    it('leaves docstringOverride undefined when extraction returns null', () => {
      const stats: FileStats[] = [
        { added: 600, deleted: 50, file: 'big_module.py' }
      ];
      const result = routeDiff(stats, baseConfig, alwaysUse, nullExtract);
      expect(result.usePerFile).toBe(true);
      expect(result.fileGroups[0].docstringOverride).toBeUndefined();
    });

    it('leaves docstringOverride undefined when shouldUse returns false', () => {
      const stats: FileStats[] = [
        { added: 600, deleted: 50, file: 'big_module.py' }
      ];
      const result = routeDiff(
        stats,
        baseConfig,
        neverUse,
        () => 'should not appear'
      );
      expect(result.fileGroups[0].docstringOverride).toBeUndefined();
    });

    it('splits small files into multiple groups when OCO_MAX_FILES_PER_GROUP is exceeded', () => {
      const stats: FileStats[] = Array.from({ length: 15 }, (_, i) => ({
        added: 10,
        deleted: 2,
        file: `src/file${i}.ts`
      }));
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_MAX_FILES_PER_GROUP: 5
      });
      expect(result.fileGroups.length).toBeGreaterThanOrEqual(3);
      for (const g of result.fileGroups) {
        expect(g.files.length).toBeLessThanOrEqual(5);
      }
    });

    it('splits small files into multiple groups when OCO_MAX_LINES_PER_GROUP is exceeded', () => {
      const stats: FileStats[] = Array.from({ length: 8 }, (_, i) => ({
        added: 200,
        deleted: 100,
        file: `src/module${i}.ts`
      }));
      // Each file = 300 lines; cap = 700 → max 2 files per group
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_MAX_LINES_PER_GROUP: 700
      });
      expect(result.fileGroups.length).toBeGreaterThanOrEqual(4);
      for (const g of result.fileGroups) {
        expect(g.totalLines).toBeLessThanOrEqual(700);
      }
    });

    it('groups files by subdirectory affinity', () => {
      const stats: FileStats[] = [
        { added: 10, deleted: 5, file: 'src/utils/a.ts' },
        { added: 10, deleted: 5, file: 'src/utils/b.ts' },
        { added: 10, deleted: 5, file: 'src/engine/x.ts' },
        { added: 10, deleted: 5, file: 'src/engine/y.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_MAX_FILES_PER_GROUP: 2
      });
      // With directory-aware grouping, utils files should be in the same group
      const hasUtilsGroup = result.fileGroups.some(
        (g) =>
          g.files.includes('src/utils/a.ts') &&
          g.files.includes('src/utils/b.ts')
      );
      expect(hasUtilsGroup).toBe(true);
    });

    it('attaches lock files to the group containing their manifest', () => {
      const stats: FileStats[] = [
        { added: 5, deleted: 0, file: 'package.json' },
        { added: 500, deleted: 0, file: 'package-lock.json' } // binary → lock
      ];
      const result = routeDiff(stats, baseConfig);
      const manifestGroup = result.fileGroups.find((g) =>
        g.files.includes('package.json')
      );
      expect(manifestGroup).toBeDefined();
      expect(manifestGroup!.files).toContain('package-lock.json');
      expect(manifestGroup!.totalLines).toBe(505);
    });

    it('puts standalone generated assets in their own group, not bundled with source', () => {
      const stats: FileStats[] = [
        { added: 50, deleted: 10, file: 'src/index.ts' },
        { added: 5, deleted: 0, file: 'assets/logo.png' },
        { added: 200, deleted: 0, file: 'public/app.min.js' }
      ];
      const result = routeDiff(stats, baseConfig);

      const pngGroup = result.fileGroups.find((g) =>
        g.files.includes('assets/logo.png')
      );
      const minJsGroup = result.fileGroups.find((g) =>
        g.files.includes('public/app.min.js')
      );
      const tsGroup = result.fileGroups.find((g) =>
        g.files.includes('src/index.ts')
      );

      expect(pngGroup).toBeDefined();
      expect(minJsGroup).toBeDefined();
      expect(tsGroup).toBeDefined();
      expect(pngGroup!.files).toEqual(['assets/logo.png']);
      expect(minJsGroup!.files).toEqual(['public/app.min.js']);
      // logo.png and app.min.js should not be attached to the source group
      expect(tsGroup!.files).not.toContain('assets/logo.png');
      expect(tsGroup!.files).not.toContain('public/app.min.js');
      // Each standalone generated asset gets its own group → triggers per-file mode
      expect(result.usePerFile).toBe(true);
    });
  });
});
