import { findFileClusters, findPartners } from '../../src/utils/filePairs';

describe('filePairs', () => {
  describe('TypeScript / JavaScript', () => {
    it('pairs same-dir test ↔ source for foo.test.ts', () => {
      const cluster = findFileClusters([
        'src/utils/foo.ts',
        'src/utils/foo.test.ts'
      ]);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toEqual([
        'src/utils/foo.ts',
        'src/utils/foo.test.ts'
      ]);
    });

    it('pairs same-dir test ↔ source for foo.spec.js', () => {
      const cluster = findFileClusters(['lib/foo.js', 'lib/foo.spec.js']);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toContain('lib/foo.js');
      expect(cluster[0]).toContain('lib/foo.spec.js');
    });

    it("pairs cross-tree src/utils/foo.ts ↔ test/unit/foo.test.ts (this fork's convention)", () => {
      const cluster = findFileClusters([
        'src/utils/diffRouter.ts',
        'test/unit/diffRouter.test.ts'
      ]);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toEqual([
        'src/utils/diffRouter.ts',
        'test/unit/diffRouter.test.ts'
      ]);
    });

    it('pairs cross-tree mirrored src/foo/bar.ts ↔ test/foo/bar.test.ts', () => {
      const cluster = findFileClusters([
        'src/foo/bar.ts',
        'test/foo/bar.test.ts'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('pairs cross-tree __tests__ convention', () => {
      const cluster = findFileClusters([
        'src/components/Button.tsx',
        '__tests__/Button.test.tsx'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('does not pair unrelated TS files in the same directory', () => {
      const clusters = findFileClusters([
        'src/utils/foo.ts',
        'src/utils/bar.ts'
      ]);
      expect(clusters).toHaveLength(2);
    });
  });

  describe('React component siblings', () => {
    it('clusters Component.tsx with .module.css, .styles.ts, .types.ts', () => {
      const cluster = findFileClusters([
        'src/components/Card.tsx',
        'src/components/Card.module.css',
        'src/components/Card.styles.ts',
        'src/components/Card.types.ts'
      ]);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toHaveLength(4);
    });

    it('clusters Component.tsx with Component.test.tsx and Component.module.scss', () => {
      const cluster = findFileClusters([
        'src/components/Modal.tsx',
        'src/components/Modal.test.tsx',
        'src/components/Modal.module.scss'
      ]);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toHaveLength(3);
    });

    it('clusters Component.tsx with Component.stories.tsx', () => {
      const cluster = findFileClusters([
        'src/components/Button.tsx',
        'src/components/Button.stories.tsx'
      ]);
      expect(cluster).toHaveLength(1);
    });
  });

  describe('Python', () => {
    it('pairs same-dir test_foo.py ↔ foo.py', () => {
      const cluster = findFileClusters(['pkg/foo.py', 'pkg/test_foo.py']);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toContain('pkg/foo.py');
      expect(cluster[0]).toContain('pkg/test_foo.py');
    });

    it('pairs same-dir foo_test.py ↔ foo.py (alt naming)', () => {
      const cluster = findFileClusters(['pkg/bar.py', 'pkg/bar_test.py']);
      expect(cluster).toHaveLength(1);
    });

    it('pairs cross-tree src/foo.py ↔ tests/test_foo.py', () => {
      const cluster = findFileClusters([
        'src/parser.py',
        'tests/test_parser.py'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('pairs cross-tree src/pkg/foo.py ↔ tests/pkg/test_foo.py (mirrored)', () => {
      const cluster = findFileClusters([
        'src/pkg/parser.py',
        'tests/pkg/test_parser.py'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('pairs cross-tree src/pkg/foo.py ↔ tests/test_foo.py (flattened)', () => {
      const cluster = findFileClusters([
        'src/pkg/sub/parser.py',
        'tests/test_parser.py'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('pairs cross-tree pkg/foo.py ↔ tests/test_foo.py (no src prefix)', () => {
      const cluster = findFileClusters([
        'doc_tools/parser.py',
        'tests/test_parser.py'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('pairs tests/unit/test_foo.py ↔ src/foo.py', () => {
      const cluster = findFileClusters([
        'src/foo.py',
        'tests/unit/test_foo.py'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('does not pair unrelated Python files', () => {
      const clusters = findFileClusters([
        'src/foo.py',
        'src/bar.py',
        'tests/test_baz.py'
      ]);
      expect(clusters).toHaveLength(3);
    });

    it('does not pair test_foo.py with bar.py despite shared dir', () => {
      const clusters = findFileClusters([
        'pkg/test_foo.py',
        'pkg/bar.py'
      ]);
      expect(clusters).toHaveLength(2);
    });
  });

  describe('Migrations', () => {
    it('clusters numbered migration with the migrations index file', () => {
      const cluster = findFileClusters([
        'src/migrations/04_migrate_config_location.ts',
        'src/migrations/_migrations.ts'
      ]);
      expect(cluster).toHaveLength(1);
    });

    it('clusters multiple numbered migrations together via the registry', () => {
      const cluster = findFileClusters([
        'src/migrations/03_per_provider_api_keys.ts',
        'src/migrations/04_migrate_config_location.ts',
        'src/migrations/_migrations.ts'
      ]);
      expect(cluster).toHaveLength(1);
      expect(cluster[0]).toHaveLength(3);
    });

    it('clusters Python migrations under their __init__.py', () => {
      const cluster = findFileClusters([
        'app/migrations/0001_initial.py',
        'app/migrations/__init__.py'
      ]);
      expect(cluster).toHaveLength(1);
    });
  });

  describe('Go', () => {
    it('pairs foo.go ↔ foo_test.go in same dir', () => {
      const cluster = findFileClusters([
        'pkg/handler.go',
        'pkg/handler_test.go'
      ]);
      expect(cluster).toHaveLength(1);
    });
  });

  describe('mixed clusters', () => {
    it('groups source + test + style for one logical change, leaves unrelated alone', () => {
      const clusters = findFileClusters([
        'src/components/Card.tsx',
        'src/components/Card.module.css',
        'src/components/Card.test.tsx',
        'src/utils/unrelated.ts'
      ]);
      expect(clusters).toHaveLength(2);
      const cardCluster = clusters.find((c) =>
        c.includes('src/components/Card.tsx')
      );
      expect(cardCluster).toHaveLength(3);
      const unrelated = clusters.find((c) =>
        c.includes('src/utils/unrelated.ts')
      );
      expect(unrelated).toEqual(['src/utils/unrelated.ts']);
    });

    it('preserves input order of cluster representatives', () => {
      // The first file in the input order determines its cluster's position.
      const clusters = findFileClusters([
        'b.ts',
        'a.ts',
        'a.test.ts'
      ]);
      // b.ts is its own cluster, comes first because input order
      expect(clusters[0]).toEqual(['b.ts']);
      // a.ts cluster comes second
      expect(clusters[1]).toContain('a.ts');
      expect(clusters[1]).toContain('a.test.ts');
    });
  });

  describe('findPartners', () => {
    it('returns partners for a file that has a pair', () => {
      const partners = findPartners('src/utils/foo.ts', [
        'src/utils/foo.ts',
        'src/utils/foo.test.ts'
      ]);
      expect(partners).toEqual(['src/utils/foo.test.ts']);
    });

    it('returns empty array when file has no partners', () => {
      const partners = findPartners('src/utils/foo.ts', [
        'src/utils/foo.ts',
        'src/utils/bar.ts'
      ]);
      expect(partners).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      expect(findFileClusters([])).toEqual([]);
    });

    it('handles single file', () => {
      expect(findFileClusters(['solo.ts'])).toEqual([['solo.ts']]);
    });

    it('does not pair test_foo.ts (TS file with python-style prefix) to foo.py', () => {
      const clusters = findFileClusters(['pkg/test_foo.ts', 'pkg/foo.py']);
      // These are different languages — the python rule only matches .py files.
      expect(clusters).toHaveLength(2);
    });
  });
});
