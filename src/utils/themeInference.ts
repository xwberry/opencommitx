/**
 * Theme & Conventional-Commit type inference for the smart diff router.
 *
 * Two functions:
 *  - `inferThemeTokens(file)` — extract a normalised set of theme tokens from
 *    a file path. Used to cluster files across directories when they share
 *    domain vocabulary (e.g. `commands/cache.ts` + `utils/cacheManager.ts`
 *    share the token `cache`).
 *  - `inferType(file, diff?)` — make a best-effort guess at the Conventional
 *    Commit type for the file (`feat`, `fix`, `test`, `docs`, etc.).
 *    Returns `undefined` when uncertain rather than guessing.
 *
 * Both are heuristics only — false negatives are preferred to false positives.
 * The router treats `undefined` as "no signal" and falls back to other rules.
 */

export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'test'
  | 'chore'
  | 'docs'
  | 'perf'
  | 'style'
  | 'build'
  | 'ci';

/**
 * Path tokens that are too generic to count toward semantic clustering.
 * Two files sharing only these tokens are NOT considered thematically related.
 */
const GENERIC_TOKENS = new Set([
  // Source roots
  'src',
  'lib',
  'libs',
  'app',
  'apps',
  'pkg',
  'packages',
  'internal',
  // Test roots and standard sub-dirs
  'test',
  'tests',
  'spec',
  'specs',
  '__tests__',
  'unit',
  'integration',
  'e2e',
  'functional',
  'fixtures',
  'mocks',
  'mock',
  'stubs',
  'snapshots',
  '__mocks__',
  '__snapshots__',
  // Generic groupings
  'utils',
  'util',
  'helpers',
  'helper',
  'common',
  'shared',
  'core',
  'base',
  'misc',
  // File-role generics
  'index',
  'main',
  'init',
  'mod',
  // Language extensions
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'pyi',
  'go',
  'rs',
  'java',
  'kt',
  'rb',
  'md',
  'mdx',
  'json',
  'yaml',
  'yml',
  'toml',
  // Common stopwords that creep in
  'the',
  'and',
  'for',
  'with',
  'from',
  'into'
]);

/**
 * Tokens appended to a file name that should be stripped before tokenising
 * (they describe the file's role, not its theme).
 */
const ROLE_SUFFIXES = [
  '.test',
  '.spec',
  '.module',
  '.styles',
  '.types',
  '.stories',
  '.story',
  '.d',
  '.config'
];

/**
 * Filename prefixes that should be stripped before tokenising. Currently:
 * - `test_` (Python pytest convention)
 */
const ROLE_PREFIXES = ['test_'];

/** Basenames that are pure boilerplate (no theme content). */
const BOILERPLATE_BASENAMES = new Set([
  '__init__.py',
  '__init__.pyi',
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'mod.rs',
  'main.go'
]);

/**
 * Split an identifier into lowercase tokens.
 *
 * Handles:
 *  - snake_case → ['snake', 'case']
 *  - kebab-case → ['kebab', 'case']
 *  - camelCase  → ['camel', 'Case']
 *  - PascalCase → ['Pascal', 'Case']
 *  - SCREAMING_SNAKE → ['screaming', 'snake']
 *  - "foo2bar3"  → ['foo', 'bar']
 */
function splitIdentifier(s: string): string[] {
  if (!s) return [];
  // Replace separators with spaces.
  const normalized = s
    .replace(/[_\-.]+/g, ' ')
    // Insert space before uppercase that follows lowercase (camelCase split).
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // Insert space between consecutive uppercase + lowercase (PDFParser → PDF Parser).
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Collapse digits into separators.
    .replace(/(\d+)/g, ' $1 ');
  return normalized
    .toLowerCase()
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !/^\d+$/.test(tok));
}

/**
 * Extract theme tokens from a file path. Returns an empty array for files
 * that contribute no theme signal (boilerplate, lockfiles, generated assets).
 */
export function inferThemeTokens(file: string): string[] {
  const segments = file.split('/');
  const basename = segments[segments.length - 1] ?? '';

  if (BOILERPLATE_BASENAMES.has(basename)) {
    // Use the parent directory name as the theme token for boilerplate.
    if (segments.length >= 2) {
      const parentTokens = splitIdentifier(segments[segments.length - 2]);
      return parentTokens.filter((t) => t.length > 2 && !GENERIC_TOKENS.has(t));
    }
    return [];
  }

  // Strip extension(s): `Component.module.css` → `Component.module`
  let trimmed = basename;
  const firstDot = trimmed.lastIndexOf('.');
  if (firstDot > 0) trimmed = trimmed.substring(0, firstDot);

  // Strip role suffixes (.test, .spec, etc.) iteratively.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of ROLE_SUFFIXES) {
      if (trimmed.endsWith(suf)) {
        trimmed = trimmed.substring(0, trimmed.length - suf.length);
        changed = true;
      }
    }
  }
  // Strip role prefixes (test_).
  for (const pre of ROLE_PREFIXES) {
    if (trimmed.startsWith(pre)) {
      trimmed = trimmed.substring(pre.length);
    }
  }
  // Strip leading numeric prefixes (0001_, 04_, etc. — common in migrations).
  trimmed = trimmed.replace(/^\d+_/, '');
  // Trailing _test on Go/Python.
  trimmed = trimmed.replace(/_test$/, '');

  const basenameTokens = splitIdentifier(trimmed);

  // Directory tokens: tokenise each path segment except the basename and
  // generic roots (src, test, tests, __tests__, etc.).
  const dirTokens: string[] = [];
  for (const seg of segments.slice(0, -1)) {
    for (const tok of splitIdentifier(seg)) {
      if (!GENERIC_TOKENS.has(tok)) dirTokens.push(tok);
    }
  }

  // Combine, dedupe, drop generics + tiny tokens.
  const combined = new Set<string>();
  for (const tok of [...basenameTokens, ...dirTokens]) {
    if (tok.length <= 2) continue;
    if (GENERIC_TOKENS.has(tok)) continue;
    combined.add(tok);
  }
  return [...combined];
}

/**
 * Score how thematically related two files are based on shared theme tokens.
 * Returns 0 when files share no tokens; higher = more related.
 *
 * Scoring rule: shared-token count, with a small bonus for sharing a basename
 * token (which is usually more specific than a directory token).
 */
export function themeOverlap(fileA: string, fileB: string): number {
  const a = new Set(inferThemeTokens(fileA));
  const b = new Set(inferThemeTokens(fileB));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const tok of a) {
    if (b.has(tok)) shared += 1;
  }
  return shared;
}

// ─── Conventional Commit type inference ─────────────────────────────────────

/** File-extension or basename → type, when the path alone is decisive. */
const PATH_BASED_TYPE: Array<{
  test: (file: string) => boolean;
  type: ConventionalCommitType;
}> = [
  // CI workflows
  {
    test: (f) =>
      f.startsWith('.github/workflows/') ||
      f === '.gitlab-ci.yml' ||
      f.startsWith('.circleci/') ||
      f === 'Jenkinsfile' ||
      f.startsWith('.travis') ||
      f === '.azure-pipelines.yml',
    type: 'ci'
  },
  // Build / tooling
  {
    test: (f) => {
      const base = f.split('/').pop() ?? f;
      return (
        /^(webpack|rollup|esbuild|vite|tsup|tsdown|swc)\.config\./.test(base) ||
        base === 'tsconfig.json' ||
        base.startsWith('tsconfig.') ||
        base === 'Dockerfile' ||
        base.startsWith('Dockerfile.') ||
        base === 'Makefile' ||
        base === 'Justfile' ||
        base === 'pyproject.toml' ||
        base === 'setup.py' ||
        base === 'setup.cfg' ||
        base === 'go.mod' ||
        base === 'Cargo.toml'
      );
    },
    type: 'build'
  },
  // Documentation
  {
    test: (f) => /\.(md|mdx|rst|adoc|asciidoc|txt)$/i.test(f),
    type: 'docs'
  },
  // Tests by path
  {
    test: (f) =>
      /(^|\/)(tests?|__tests__|spec|specs)\//.test(f) ||
      /\.(test|spec)\.[a-zA-Z]+$/.test(f) ||
      /(^|\/)test_[^/]+\.py$/.test(f) ||
      /(^|\/)[^/]+_test\.(py|go)$/.test(f),
    type: 'test'
  },
  // Tooling-config / chore
  {
    test: (f) => {
      const base = f.split('/').pop() ?? f;
      return (
        base === 'package.json' ||
        base === 'requirements.txt' ||
        base === 'Pipfile' ||
        base === '.gitignore' ||
        base === '.gitattributes' ||
        base === '.editorconfig' ||
        base === '.prettierrc' ||
        base === '.prettierignore' ||
        base.startsWith('.eslintrc') ||
        base === '.dockerignore'
      );
    },
    type: 'chore'
  }
];

/** Number of `+`-prefixed lines in a unified diff (excluding `+++` headers). */
function countAddedLines(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) count += 1;
  }
  return count;
}

/** Number of `-`-prefixed lines (excluding `---` headers). */
function countDeletedLines(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('-') && !line.startsWith('---')) count += 1;
  }
  return count;
}

/**
 * Returns true when the diff contains *any* added line matching the regex.
 * Pattern is applied to the post-`+` content of each added line.
 */
function diffHasAddedLineMatching(diff: string, pattern: RegExp): boolean {
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (pattern.test(line.substring(1))) return true;
  }
  return false;
}

/** Returns true when *all* added/removed lines are pure comments or blank. */
function diffIsCommentOnly(diff: string): boolean {
  let saw = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+') || line.startsWith('-')) {
      const content = line.substring(1).trim();
      if (content.length === 0) continue;
      saw = true;
      const isComment =
        content.startsWith('//') ||
        content.startsWith('#') ||
        content.startsWith('*') ||
        content.startsWith('/*') ||
        content.startsWith('"""') ||
        content.startsWith("'''");
      if (!isComment) return false;
    }
  }
  return saw;
}

/**
 * Best-effort Conventional Commit type for a file change.
 *
 * Precedence:
 *  1. Path-based decisive matches (CI, build config, docs, tests, chore)
 *  2. Diff-content sniffing (when diff is provided)
 *  3. Fall back to `undefined` (no confident signal)
 *
 * Diff-content patterns:
 *  - `feat`     — new exports / new functions / new classes
 *  - `fix`      — added `throw`/`raise` lines, or `catch`/`except` blocks
 *  - `refactor` — heavy churn (>30% added AND >30% deleted of the changed
 *                 lines) AND no clear feat/fix signal
 *  - `style`    — comment-only diff
 *  - `docs`     — comment-only diff in non-source-code files (rare)
 */
export function inferType(
  file: string,
  diff?: string
): ConventionalCommitType | undefined {
  // Path-based first.
  for (const rule of PATH_BASED_TYPE) {
    if (rule.test(file)) return rule.type;
  }

  if (!diff) return undefined;

  const added = countAddedLines(diff);
  const deleted = countDeletedLines(diff);
  if (added === 0 && deleted === 0) return undefined;

  if (diffIsCommentOnly(diff)) return 'style';

  // Test indicators inside diff content
  const isTestyContent =
    diffHasAddedLineMatching(diff, /^\s*(describe|it|test)\s*\(/) ||
    diffHasAddedLineMatching(diff, /^\s*expect\s*\(/) ||
    diffHasAddedLineMatching(diff, /^\s*def\s+test_\w+\s*\(/) ||
    diffHasAddedLineMatching(diff, /^\s*@(pytest|unittest)/);
  if (isTestyContent) return 'test';

  // Fix indicators: new throws/raises, new catch/except blocks.
  const fixSignal =
    diffHasAddedLineMatching(diff, /^\s*throw\s+/) ||
    diffHasAddedLineMatching(diff, /^\s*raise\s+\w+/) ||
    diffHasAddedLineMatching(diff, /^\s*}\s*catch\s*\(/) ||
    diffHasAddedLineMatching(diff, /^\s*except\s+\w+/);

  // Feature indicators: new exports / new top-level definitions.
  const featSignal =
    diffHasAddedLineMatching(
      diff,
      /^\s*export\s+(async\s+)?(function|class|const|interface|type|enum)\s+\w+/
    ) ||
    diffHasAddedLineMatching(diff, /^\s*public\s+\w+\s+\w+\s*\(/) ||
    diffHasAddedLineMatching(diff, /^\s*(async\s+)?def\s+\w+\s*\(/) ||
    diffHasAddedLineMatching(diff, /^\s*class\s+\w+\s*[\(:]/);

  // Refactor heuristic: meaningful churn (significant adds AND deletes) without
  // a clear feat/fix signal. Threshold of 20 changed lines is conservative —
  // anything smaller is too easily a normal edit.
  const total = added + deleted;
  const isRefactor =
    !featSignal &&
    !fixSignal &&
    total >= 20 &&
    added / total > 0.3 &&
    deleted / total > 0.3;

  if (fixSignal && !featSignal) return 'fix';
  if (featSignal && !fixSignal) return 'feat';
  if (featSignal && fixSignal) {
    // Both signals: lean feat (added exports tend to be the meaningful change).
    return 'feat';
  }
  if (isRefactor) return 'refactor';

  return undefined;
}
