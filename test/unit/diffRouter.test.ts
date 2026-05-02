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

    it('smart mode pairs cross-tree test/source for TS', () => {
      const stats: FileStats[] = [
        { added: 50, deleted: 10, file: 'src/utils/cache.ts' },
        { added: 80, deleted: 5, file: 'test/unit/cache.test.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      // The source/test pair should be in the same group regardless of dir.
      const cacheGroup = result.fileGroups.find((g) =>
        g.files.includes('src/utils/cache.ts')
      );
      expect(cacheGroup).toBeDefined();
      expect(cacheGroup!.files).toContain('test/unit/cache.test.ts');
    });

    it('smart mode pairs cross-tree test/source for Python', () => {
      const stats: FileStats[] = [
        { added: 60, deleted: 0, file: 'src/parser.py' },
        { added: 30, deleted: 0, file: 'tests/test_parser.py' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      const grp = result.fileGroups.find((g) =>
        g.files.includes('src/parser.py')
      );
      expect(grp).toBeDefined();
      expect(grp!.files).toContain('tests/test_parser.py');
    });

    it('smart mode clusters files sharing a non-generic theme token across directories', () => {
      // commands/cache.ts and utils/cacheManager.ts both contain "cache".
      const stats: FileStats[] = [
        { added: 20, deleted: 2, file: 'src/commands/cache.ts' },
        { added: 30, deleted: 5, file: 'src/utils/cacheManager.ts' },
        { added: 10, deleted: 1, file: 'src/utils/unrelated.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      const cacheGroup = result.fileGroups.find((g) =>
        g.files.includes('src/commands/cache.ts')
      );
      expect(cacheGroup).toBeDefined();
      expect(cacheGroup!.files).toContain('src/utils/cacheManager.ts');
      const unrelated = result.fileGroups.find((g) =>
        g.files.includes('src/utils/unrelated.ts')
      );
      expect(unrelated).toBeDefined();
      expect(unrelated!.files).not.toContain('src/commands/cache.ts');
    });

    it('smart mode does not cluster unrelated files in the same dir', () => {
      const stats: FileStats[] = [
        { added: 10, deleted: 0, file: 'src/utils/foo.ts' },
        { added: 10, deleted: 0, file: 'src/utils/bar.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      // No theme overlap (foo and bar share no specific tokens) — they should
      // remain in separate groups even though they're in the same dir.
      expect(result.fileGroups).toHaveLength(2);
    });

    it('smart mode merges undersized adjacent groups when themes overlap', () => {
      // Three files, all "auth" themed, each tiny on its own.
      const stats: FileStats[] = [
        { added: 4, deleted: 1, file: 'src/auth/login.ts' },
        { added: 3, deleted: 0, file: 'src/auth/logout.ts' },
        { added: 5, deleted: 2, file: 'src/auth/session.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      // All share "auth" → should cluster into a single group.
      expect(result.fileGroups).toHaveLength(1);
      expect(result.fileGroups[0].files.sort()).toEqual([
        'src/auth/login.ts',
        'src/auth/logout.ts',
        'src/auth/session.ts'
      ]);
    });

    it('smart mode tags single-type groups with the inferred type', () => {
      const stats: FileStats[] = [
        { added: 30, deleted: 0, file: 'README.md' },
        { added: 40, deleted: 0, file: 'docs/usage.md' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      // Both are docs; whichever group contains a md file should be tagged.
      const docsGroup = result.fileGroups.find((g) =>
        g.files.some((f) => f.endsWith('.md'))
      );
      expect(docsGroup).toBeDefined();
      expect(docsGroup!.type).toBe('docs');
    });

    it('smart mode respects file/line caps when splitting large clusters', () => {
      // 12 files all sharing "auth" theme, each 50 lines.
      const stats: FileStats[] = Array.from({ length: 12 }, (_, i) => ({
        added: 50,
        deleted: 0,
        file: `src/auth/handler${i}.ts`
      }));
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart',
        OCO_MAX_FILES_PER_GROUP: 5
      });
      // 12 files / cap of 5 → at least 3 groups.
      expect(result.fileGroups.length).toBeGreaterThanOrEqual(3);
      for (const g of result.fileGroups) {
        expect(g.files.length).toBeLessThanOrEqual(5);
      }
    });

    it('smart mode preserves docstring override for large Python files', () => {
      const stats: FileStats[] = [
        { added: 600, deleted: 50, file: 'big_module.py' }
      ];
      const result = routeDiff(
        stats,
        { ...baseConfig, OCO_PER_FILE_COMMIT_MODE: 'smart' },
        alwaysUse,
        () => 'docstring summary here'
      );
      expect(result.fileGroups[0].docstringOverride).toContain(
        'docstring summary here'
      );
    });

    it("smart mode does not false-merge unrelated test/source pairs via 'unit' subdir", () => {
      // Regression: 'unit', 'integration', 'e2e' were being treated as theme
      // tokens, causing every test file under test/unit/ to share that token
      // and merging all unrelated test/source pairs into one giant cluster.
      const stats: FileStats[] = [
        { added: 100, deleted: 10, file: 'src/utils/diffRouter.ts' },
        { added: 100, deleted: 10, file: 'src/utils/filePairs.ts' },
        { added: 100, deleted: 10, file: 'src/utils/themeInference.ts' },
        { added: 50, deleted: 0, file: 'test/unit/diffRouter.test.ts' },
        { added: 50, deleted: 0, file: 'test/unit/filePairs.test.ts' },
        { added: 50, deleted: 0, file: 'test/unit/themeInference.test.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      // Should produce 3 separate file-pair groups, NOT one big cluster.
      expect(result.fileGroups).toHaveLength(3);
      // Each group should be a single source/test pair.
      for (const g of result.fileGroups) {
        expect(g.files).toHaveLength(2);
        expect(g.reason).toBe('file-pair');
      }
    });

    it('smart mode does not tag mixed test/source groups as type=test', () => {
      // Regression: type was being set to 'test' on a [source, test] group
      // because the test file's inferType returned 'test' and the source's
      // returned undefined, leaving 'test' as the only "concrete" type.
      const stats: FileStats[] = [
        { added: 50, deleted: 5, file: 'src/utils/foo.ts' },
        { added: 30, deleted: 0, file: 'test/unit/foo.test.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      const grp = result.fileGroups.find((g) =>
        g.files.includes('src/utils/foo.ts')
      );
      expect(grp).toBeDefined();
      expect(grp!.type).toBeUndefined();
    });

    it('smart mode tags pure-test groups as type=test', () => {
      // Two test files that pair with no staged source — should still tag as test.
      const stats: FileStats[] = [
        { added: 30, deleted: 0, file: 'test/unit/foo.test.ts' },
        { added: 40, deleted: 0, file: 'test/unit/bar.test.ts' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      // foo and bar tests don't share a basename theme token (and 'unit' is
      // now generic), so they end up as two separate singletons each tagged 'test'.
      for (const g of result.fileGroups) {
        expect(g.type).toBe('test');
      }
    });

    it('smart mode lock-file attachment to manifest still works', () => {
      const stats: FileStats[] = [
        { added: 5, deleted: 0, file: 'package.json' },
        { added: 500, deleted: 0, file: 'package-lock.json' }
      ];
      const result = routeDiff(stats, {
        ...baseConfig,
        OCO_PER_FILE_COMMIT_MODE: 'smart'
      });
      const manifestGroup = result.fileGroups.find((g) =>
        g.files.includes('package.json')
      );
      expect(manifestGroup).toBeDefined();
      expect(manifestGroup!.files).toContain('package-lock.json');
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
