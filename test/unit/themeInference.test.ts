import {
  inferThemeTokens,
  themeOverlap,
  inferType
} from '../../src/utils/themeInference';

describe('themeInference', () => {
  describe('inferThemeTokens', () => {
    it('extracts basename tokens', () => {
      expect(inferThemeTokens('src/utils/cacheManager.ts')).toContain('cache');
      expect(inferThemeTokens('src/utils/cacheManager.ts')).toContain(
        'manager'
      );
    });

    it('drops generic directory tokens (src, utils, test, lib)', () => {
      const tokens = inferThemeTokens('src/utils/foo.ts');
      expect(tokens).toContain('foo');
      expect(tokens).not.toContain('src');
      expect(tokens).not.toContain('utils');
    });

    it('strips test_ prefix on Python files', () => {
      const tokens = inferThemeTokens('tests/test_parser.py');
      expect(tokens).toContain('parser');
      expect(tokens).not.toContain('test');
    });

    it('strips _test suffix on Go/Python files', () => {
      const tokens = inferThemeTokens('pkg/handler_test.go');
      expect(tokens).toContain('handler');
      expect(tokens).not.toContain('test');
    });

    it('strips .test/.spec suffixes on TS/JS files', () => {
      const tokens = inferThemeTokens('src/utils/foo.test.ts');
      expect(tokens).toContain('foo');
    });

    it('strips React role suffixes (.module, .styles, .types, .stories)', () => {
      expect(inferThemeTokens('src/components/Card.module.css')).toContain(
        'card'
      );
      expect(inferThemeTokens('src/components/Card.styles.ts')).toContain(
        'card'
      );
      expect(inferThemeTokens('src/components/Card.types.ts')).toContain(
        'card'
      );
      expect(inferThemeTokens('src/components/Card.stories.tsx')).toContain(
        'card'
      );
      expect(inferThemeTokens('src/components/Card.module.css')).toContain(
        'components'
      );
    });

    it('strips numeric migration prefixes', () => {
      const tokens = inferThemeTokens('migrations/0001_initial_schema.py');
      expect(tokens).toContain('initial');
      expect(tokens).toContain('schema');
      // The numeric prefix is gone
      expect(tokens.some((t) => /^\d/.test(t))).toBe(false);
    });

    it('splits camelCase and snake_case basename tokens', () => {
      expect(inferThemeTokens('src/utils/getUserData.ts')).toEqual(
        expect.arrayContaining(['get', 'user', 'data'])
      );
      expect(inferThemeTokens('src/utils/get_user_data.py')).toEqual(
        expect.arrayContaining(['get', 'user', 'data'])
      );
    });

    it('splits PascalCase preserving acronym groups', () => {
      const tokens = inferThemeTokens('src/parsers/PDFParser.ts');
      expect(tokens).toContain('pdf');
      expect(tokens).toContain('parser');
    });

    it('uses parent dir name as theme for boilerplate __init__.py', () => {
      const tokens = inferThemeTokens('app/cache/__init__.py');
      expect(tokens).toContain('cache');
    });

    it('returns empty array for plain index.ts (no parent dir signal)', () => {
      // index.ts is boilerplate; no parent dir or generic parent → empty
      const tokens = inferThemeTokens('lib/index.ts');
      expect(tokens).toEqual([]);
    });

    it('drops 2-character tokens', () => {
      const tokens = inferThemeTokens('src/io/foo.ts');
      expect(tokens).not.toContain('io'); // too short
      expect(tokens).toContain('foo');
    });

    it('treats test sub-dir names (unit, integration, e2e) as generic', () => {
      // Regression: these were leaking through and false-clustering test files.
      const cases = [
        'test/unit/parser.test.ts',
        'tests/integration/api.test.ts',
        'tests/e2e/flow.spec.ts',
        'test/functional/checkout.test.js',
        'tests/fixtures/sample.ts',
        '__mocks__/fs.ts'
      ];
      for (const file of cases) {
        const tokens = inferThemeTokens(file);
        expect(tokens).not.toContain('unit');
        expect(tokens).not.toContain('integration');
        expect(tokens).not.toContain('e2e');
        expect(tokens).not.toContain('functional');
        expect(tokens).not.toContain('fixtures');
      }
    });
  });

  describe('themeOverlap', () => {
    it('returns 0 for unrelated files', () => {
      expect(
        themeOverlap('src/parser.ts', 'src/renderer.ts')
      ).toBe(0);
    });

    it('returns >0 for files sharing a theme token across directories', () => {
      // commands/cache.ts and utils/cacheManager.ts both contain "cache"
      expect(
        themeOverlap('src/commands/cache.ts', 'src/utils/cacheManager.ts')
      ).toBeGreaterThan(0);
    });

    it('returns 0 for files sharing only generic dir tokens', () => {
      // Both have "src" and "utils" but those are generic; basenames differ.
      expect(
        themeOverlap('src/utils/foo.ts', 'src/utils/bar.ts')
      ).toBe(0);
    });

    it('Python: src/parser.py overlaps with tests/test_parser.py', () => {
      expect(
        themeOverlap('src/parser.py', 'tests/test_parser.py')
      ).toBeGreaterThan(0);
    });
  });

  describe('inferType — path-based decisive matches', () => {
    it('classifies markdown as docs', () => {
      expect(inferType('README.md')).toBe('docs');
      expect(inferType('docs/usage.mdx')).toBe('docs');
      expect(inferType('CHANGELOG.md')).toBe('docs');
    });

    it('classifies CI workflows as ci', () => {
      expect(inferType('.github/workflows/test.yml')).toBe('ci');
      expect(inferType('.gitlab-ci.yml')).toBe('ci');
    });

    it('classifies build/tooling configs as build', () => {
      expect(inferType('webpack.config.js')).toBe('build');
      expect(inferType('vite.config.ts')).toBe('build');
      expect(inferType('tsconfig.json')).toBe('build');
      expect(inferType('Dockerfile')).toBe('build');
      expect(inferType('Makefile')).toBe('build');
      expect(inferType('pyproject.toml')).toBe('build');
      expect(inferType('go.mod')).toBe('build');
      expect(inferType('Cargo.toml')).toBe('build');
    });

    it('classifies test files by path as test', () => {
      expect(inferType('test/unit/foo.test.ts')).toBe('test');
      expect(inferType('tests/test_parser.py')).toBe('test');
      expect(inferType('src/foo.test.ts')).toBe('test');
      expect(inferType('pkg/handler_test.go')).toBe('test');
    });

    it('classifies dotfiles and lockless tooling as chore', () => {
      expect(inferType('package.json')).toBe('chore');
      expect(inferType('.gitignore')).toBe('chore');
      expect(inferType('.eslintrc.json')).toBe('chore');
      expect(inferType('.prettierrc')).toBe('chore');
    });

    it('returns undefined for plain source files without a diff', () => {
      expect(inferType('src/utils/parser.ts')).toBeUndefined();
      expect(inferType('app/handlers/cache.py')).toBeUndefined();
    });
  });

  describe('inferType — diff-content sniffing', () => {
    it("flags 'fix' on added throw lines", () => {
      const diff =
        '@@ -1,3 +1,5 @@\n' +
        ' function foo() {\n' +
        '+  throw new Error("bad");\n' +
        '+  return null;\n' +
        ' }';
      expect(inferType('src/foo.ts', diff)).toBe('fix');
    });

    it("flags 'fix' on Python raise statements", () => {
      const diff =
        '@@ -1,3 +1,5 @@\n' +
        ' def parse():\n' +
        '+    if bad:\n' +
        '+        raise ValueError("bad input")';
      expect(inferType('src/parser.py', diff)).toBe('fix');
    });

    it("flags 'fix' on added except blocks", () => {
      const diff =
        '@@ -1,3 +1,5 @@\n' +
        ' try:\n' +
        '     do_thing()\n' +
        '+except KeyError:\n' +
        '+    pass';
      expect(inferType('src/handler.py', diff)).toBe('fix');
    });

    it("flags 'feat' on new exported function", () => {
      const diff =
        '@@ -1,3 +1,8 @@\n' +
        ' const x = 1;\n' +
        '+\n' +
        '+export function newFeature(): string {\n' +
        '+  return "hello";\n' +
        '+}';
      expect(inferType('src/foo.ts', diff)).toBe('feat');
    });

    it("flags 'feat' on new Python def", () => {
      const diff =
        '@@ -1,3 +1,7 @@\n' +
        ' import os\n' +
        '+\n' +
        '+def new_handler(arg):\n' +
        '+    return arg.upper()';
      expect(inferType('src/handler.py', diff)).toBe('feat');
    });

    it("flags 'feat' on new Python class", () => {
      const diff =
        '@@ -1,3 +1,7 @@\n' +
        ' import os\n' +
        '+\n' +
        '+class NewService:\n' +
        '+    pass';
      expect(inferType('src/service.py', diff)).toBe('feat');
    });

    it("flags 'test' on new describe/it blocks", () => {
      const diff =
        '@@ -1,1 +1,5 @@\n' +
        ' \n' +
        "+describe('foo', () => {\n" +
        "+  it('does X', () => {});\n" +
        '+});';
      expect(inferType('src/something.ts', diff)).toBe('test');
    });

    it("flags 'test' on Python def test_*", () => {
      const diff =
        '@@ -1,1 +1,4 @@\n' +
        ' \n' +
        '+def test_parser():\n' +
        '+    assert parse("x") == "x"';
      expect(inferType('src/somefile.py', diff)).toBe('test');
    });

    it("flags 'style' on comment-only diff", () => {
      const diff =
        '@@ -1,3 +1,4 @@\n' +
        ' const x = 1;\n' +
        '+// note: x is the count\n' +
        ' const y = 2;';
      expect(inferType('src/foo.ts', diff)).toBe('style');
    });

    it("flags 'refactor' on high-churn rewrite without feat/fix signal", () => {
      const diff =
        '@@ -1,10 +1,10 @@\n' +
        '-const a = 1;\n' +
        '-const b = 2;\n' +
        '-const c = 3;\n' +
        '-const d = 4;\n' +
        '-const e = 5;\n' +
        '-const f = 6;\n' +
        '-const g = 7;\n' +
        '-const h = 8;\n' +
        '-const i = 9;\n' +
        '-const j = 10;\n' +
        '+const aa = 1;\n' +
        '+const bb = 2;\n' +
        '+const cc = 3;\n' +
        '+const dd = 4;\n' +
        '+const ee = 5;\n' +
        '+const ff = 6;\n' +
        '+const gg = 7;\n' +
        '+const hh = 8;\n' +
        '+const ii = 9;\n' +
        '+const jj = 10;';
      expect(inferType('src/foo.ts', diff)).toBe('refactor');
    });

    it('returns undefined for ambiguous small additions', () => {
      const diff =
        '@@ -1,3 +1,4 @@\n' +
        ' const x = 1;\n' +
        '+const y = 2;\n' +
        ' const z = 3;';
      expect(inferType('src/foo.ts', diff)).toBeUndefined();
    });

    it("path beats diff: docs file always wins regardless of content", () => {
      // A markdown file with code-block additions still classifies as docs
      const diff =
        '@@ -1,3 +1,5 @@\n' +
        ' Title\n' +
        '+```ts\n' +
        '+throw new Error("x");\n' +
        '+```';
      expect(inferType('README.md', diff)).toBe('docs');
    });
  });
});
