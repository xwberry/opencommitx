/**
 * File-pair recognition for thematic commit grouping.
 *
 * Each rule maps a path to a list of plausible *partner* paths. A pair (or
 * larger cluster) exists when one or more candidates from a rule are also in
 * the staged set. Clusters are computed by union-find over all rules.
 *
 * Pair rules are intentionally explicit: each pattern is one named rule with a
 * dedicated test fixture. Generic regex-on-path pattern matching is avoided
 * because it produces false positives that are hard to debug.
 */

type CandidateFn = (file: string) => string[];

interface PairRule {
  name: string;
  candidates: CandidateFn;
}

const TS_JS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];
const TS_JS_TEST_SUFFIXES = ['test', 'spec'];

/** Standard test-directory roots used across many JS/TS projects. */
const JS_TEST_ROOTS = ['test', 'tests', '__tests__'];

/** Common subdirectories under a test root: test/unit/foo.test.ts, etc. */
const JS_TEST_SUBDIRS = ['', 'unit/', 'integration/', 'e2e/'];

/** Standard test-directory roots used across many Python projects. */
const PY_TEST_ROOTS = ['test', 'tests'];
const PY_TEST_SUBDIRS = ['', 'unit/', 'integration/', 'e2e/'];

/** React component sibling extensions (same basename, different file). */
const REACT_SIBLING_SUFFIXES = [
  '.module.css',
  '.module.scss',
  '.module.sass',
  '.styles.ts',
  '.styles.tsx',
  '.types.ts',
  '.types.tsx',
  '.stories.tsx',
  '.stories.ts',
  '.story.tsx',
  '.story.ts'
];

/** Helper: split a path into [dir-with-trailing-slash, basename]. */
function splitPath(file: string): [string, string] {
  const idx = file.lastIndexOf('/');
  if (idx < 0) return ['', file];
  return [file.substring(0, idx + 1), file.substring(idx + 1)];
}

/** Helper: strip a known leading directory prefix, returning the rest. */
function stripLeadingDir(file: string, dir: string): string | null {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return file.startsWith(prefix) ? file.substring(prefix.length) : null;
}

const RULES: PairRule[] = [
  // ─── TypeScript / JavaScript ───────────────────────────────────────────────

  // Same-dir test → source: foo.test.ts → foo.ts
  {
    name: 'ts-test-to-source-same-dir',
    candidates: (file) => {
      for (const ext of TS_JS_EXTS) {
        for (const suf of TS_JS_TEST_SUFFIXES) {
          const needle = `.${suf}.${ext}`;
          if (file.endsWith(needle)) {
            return [file.slice(0, -needle.length) + `.${ext}`];
          }
        }
      }
      return [];
    }
  },

  // Same-dir source → test: foo.ts → foo.test.ts / foo.spec.ts
  {
    name: 'ts-source-to-test-same-dir',
    candidates: (file) => {
      for (const ext of TS_JS_EXTS) {
        if (!file.endsWith(`.${ext}`)) continue;
        // Skip if already a test file
        if (
          TS_JS_TEST_SUFFIXES.some((suf) => file.endsWith(`.${suf}.${ext}`))
        ) {
          return [];
        }
        const base = file.slice(0, -`.${ext}`.length);
        return TS_JS_TEST_SUFFIXES.map((suf) => `${base}.${suf}.${ext}`);
      }
      return [];
    }
  },

  // Cross-tree source → test: src/.../foo.ts → test{,s,/__tests__}/.../foo.test.ts
  // Also basename-only candidates for forks like ours where test/unit flattens structure.
  {
    name: 'ts-source-to-test-cross-tree',
    candidates: (file) => {
      const rel = stripLeadingDir(file, 'src');
      if (!rel) return [];
      for (const ext of TS_JS_EXTS) {
        if (!rel.endsWith(`.${ext}`)) continue;
        if (TS_JS_TEST_SUFFIXES.some((suf) => rel.endsWith(`.${suf}.${ext}`))) {
          return [];
        }
        const relNoExt = rel.slice(0, -`.${ext}`.length);
        const basenameNoExt = relNoExt.split('/').pop() ?? relNoExt;
        const out: string[] = [];
        for (const root of JS_TEST_ROOTS) {
          for (const sub of JS_TEST_SUBDIRS) {
            for (const suf of TS_JS_TEST_SUFFIXES) {
              // Mirrored path: test/unit/utils/foo.test.ts
              out.push(`${root}/${sub}${relNoExt}.${suf}.${ext}`);
              // Flattened path: test/unit/foo.test.ts
              out.push(`${root}/${sub}${basenameNoExt}.${suf}.${ext}`);
            }
          }
        }
        return out;
      }
      return [];
    }
  },

  // Cross-tree test → source: test{,s,/__tests__}/.../foo.test.ts → src/.../foo.ts
  {
    name: 'ts-test-to-source-cross-tree',
    candidates: (file) => {
      for (const root of JS_TEST_ROOTS) {
        const rel = stripLeadingDir(file, root);
        if (!rel) continue;
        // Strip leading sub-dir if it's one we recognise.
        let inner = rel;
        for (const sub of JS_TEST_SUBDIRS) {
          if (sub && rel.startsWith(sub)) {
            inner = rel.substring(sub.length);
            break;
          }
        }
        for (const ext of TS_JS_EXTS) {
          for (const suf of TS_JS_TEST_SUFFIXES) {
            const needle = `.${suf}.${ext}`;
            if (!inner.endsWith(needle)) continue;
            const innerNoSuf = inner.slice(0, -needle.length);
            const basenameNoSuf = innerNoSuf.split('/').pop() ?? innerNoSuf;
            return [
              `src/${innerNoSuf}.${ext}`,
              // Common case: source file at src/<deeper-than-test-tree>/<basename>
              `src/${basenameNoSuf}.${ext}`,
              // Also try src/utils/, src/commands/ etc. via basename-only (fork convention).
              `src/utils/${basenameNoSuf}.${ext}`,
              `src/commands/${basenameNoSuf}.${ext}`,
              `src/engine/${basenameNoSuf}.${ext}`,
              // No-src-prefix project layouts:
              `${innerNoSuf}.${ext}`
            ];
          }
        }
      }
      return [];
    }
  },

  // ─── React component sibling files ─────────────────────────────────────────

  // Component.tsx → Component.module.css / .styles.ts / .types.ts / .stories.tsx
  {
    name: 'react-component-to-siblings',
    candidates: (file) => {
      for (const ext of ['tsx', 'jsx']) {
        if (!file.endsWith(`.${ext}`)) continue;
        // Skip test files
        if (
          TS_JS_TEST_SUFFIXES.some((suf) => file.endsWith(`.${suf}.${ext}`))
        ) {
          return [];
        }
        const base = file.slice(0, -`.${ext}`.length);
        return REACT_SIBLING_SUFFIXES.map((sufx) => `${base}${sufx}`);
      }
      return [];
    }
  },

  // Component.module.css → Component.tsx (and other reverse directions)
  {
    name: 'react-sibling-to-component',
    candidates: (file) => {
      for (const sufx of REACT_SIBLING_SUFFIXES) {
        if (!file.endsWith(sufx)) continue;
        const base = file.slice(0, -sufx.length);
        return ['tsx', 'jsx', 'ts', 'js'].map((ext) => `${base}.${ext}`);
      }
      return [];
    }
  },

  // ─── Python ────────────────────────────────────────────────────────────────

  // Same-dir test → source (test_foo.py → foo.py)
  {
    name: 'py-test-prefix-to-source-same-dir',
    candidates: (file) => {
      const [dir, basename] = splitPath(file);
      const m = basename.match(/^test_(.+)\.py$/);
      if (!m) return [];
      return [`${dir}${m[1]}.py`];
    }
  },

  // Same-dir source → test (foo.py → test_foo.py / foo_test.py)
  {
    name: 'py-source-to-test-same-dir',
    candidates: (file) => {
      const [dir, basename] = splitPath(file);
      if (!basename.endsWith('.py')) return [];
      if (basename.startsWith('test_') || basename.endsWith('_test.py')) {
        return [];
      }
      const stem = basename.slice(0, -'.py'.length);
      return [`${dir}test_${stem}.py`, `${dir}${stem}_test.py`];
    }
  },

  // Same-dir foo_test.py → foo.py (Go-style Python convention)
  {
    name: 'py-test-suffix-to-source-same-dir',
    candidates: (file) => {
      const [dir, basename] = splitPath(file);
      const m = basename.match(/^(.+)_test\.py$/);
      if (!m) return [];
      return [`${dir}${m[1]}.py`];
    }
  },

  // Cross-tree source → test (src/.../foo.py → tests/.../test_foo.py)
  {
    name: 'py-source-to-test-cross-tree',
    candidates: (file) => {
      // Try stripping common source roots; fall back to full path otherwise.
      const sourceRoots = ['src', ''];
      for (const srcRoot of sourceRoots) {
        const rel = srcRoot ? stripLeadingDir(file, srcRoot) : file;
        if (rel === null) continue;
        if (!rel.endsWith('.py')) continue;
        const basename = rel.split('/').pop() ?? rel;
        if (basename.startsWith('test_') || basename.endsWith('_test.py')) {
          continue;
        }
        const relNoExt = rel.slice(0, -'.py'.length);
        const basenameNoExt = relNoExt.split('/').pop() ?? relNoExt;
        const dirOfRel = relNoExt.includes('/')
          ? relNoExt.substring(0, relNoExt.lastIndexOf('/') + 1)
          : '';
        const out: string[] = [];
        for (const root of PY_TEST_ROOTS) {
          for (const sub of PY_TEST_SUBDIRS) {
            // Mirrored: tests/dir/test_foo.py
            out.push(`${root}/${sub}${dirOfRel}test_${basenameNoExt}.py`);
            out.push(`${root}/${sub}${dirOfRel}${basenameNoExt}_test.py`);
            // Flattened: tests/test_foo.py
            out.push(`${root}/${sub}test_${basenameNoExt}.py`);
            out.push(`${root}/${sub}${basenameNoExt}_test.py`);
          }
        }
        return out;
      }
      return [];
    }
  },

  // Cross-tree test → source (tests/.../test_foo.py → src/.../foo.py)
  {
    name: 'py-test-to-source-cross-tree',
    candidates: (file) => {
      for (const root of PY_TEST_ROOTS) {
        const rel = stripLeadingDir(file, root);
        if (!rel) continue;
        let inner = rel;
        for (const sub of PY_TEST_SUBDIRS) {
          if (sub && rel.startsWith(sub)) {
            inner = rel.substring(sub.length);
            break;
          }
        }
        const basename = inner.split('/').pop() ?? inner;
        let stem: string | null = null;
        if (basename.startsWith('test_') && basename.endsWith('.py')) {
          stem = basename.slice('test_'.length, -'.py'.length);
        } else if (basename.endsWith('_test.py')) {
          stem = basename.slice(0, -'_test.py'.length);
        }
        if (!stem) continue;
        const dirOfInner = inner.includes('/')
          ? inner.substring(0, inner.lastIndexOf('/') + 1)
          : '';
        return [
          `src/${dirOfInner}${stem}.py`,
          `src/${stem}.py`,
          `${dirOfInner}${stem}.py`,
          `${stem}.py`
        ];
      }
      return [];
    }
  },

  // ─── Schema / migration cluster ────────────────────────────────────────────

  // Migrations: numbered files in a migrations/ directory cluster together.
  // Pair each numbered migration with the registry/index file in the same dir.
  {
    name: 'migration-to-registry',
    candidates: (file) => {
      const m = file.match(
        /^(.*\/)?migrations?\/(\d+_[^/]+|_migrations|index)\.(ts|tsx|js|jsx|mjs|cjs|py)$/
      );
      if (!m) return [];
      const [, dir, , ext] = m;
      const migrationsDir = `${dir ?? ''}migrations/`;
      // Look for the registry by common names.
      return [
        `${migrationsDir}_migrations.${ext}`,
        `${migrationsDir}index.${ext}`,
        `${migrationsDir}__init__.py`
      ];
    }
  },

  // ─── Go ────────────────────────────────────────────────────────────────────

  // foo.go ↔ foo_test.go (same dir)
  {
    name: 'go-test-suffix',
    candidates: (file) => {
      const m = file.match(/^(.+)_test\.go$/);
      if (m) return [`${m[1]}.go`];
      const m2 = file.match(/^(.+)\.go$/);
      if (m2 && !file.endsWith('_test.go')) {
        return [`${m2[1]}_test.go`];
      }
      return [];
    }
  }
];

/**
 * Cluster a list of file paths into groups of related files.
 *
 * Files that don't match any pair rule end up as singleton clusters (a list
 * with a single element). Files that match one or more rules are merged via
 * union-find, so e.g. `Component.tsx` + `Component.module.css` +
 * `Component.test.tsx` end up in one cluster of size 3.
 *
 * Returns clusters preserving the input order of the *first* member of each
 * cluster, so the caller can render groups in a stable user-facing order.
 */
export function findFileClusters(files: string[]): string[][] {
  const parent = new Map<string, string>();
  for (const f of files) parent.set(f, f);

  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    // Path compression
    let node = x;
    while (parent.get(node) !== cur) {
      const next = parent.get(node)!;
      parent.set(node, cur);
      node = next;
    }
    return cur;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const fileSet = new Set(files);
  for (const file of files) {
    for (const rule of RULES) {
      const candidates = rule.candidates(file);
      for (const candidate of candidates) {
        if (candidate === file) continue;
        if (fileSet.has(candidate)) {
          union(file, candidate);
        }
      }
    }
  }

  // Build clusters preserving input order.
  const seen = new Set<string>();
  const clusters: string[][] = [];
  for (const file of files) {
    const rep = find(file);
    if (seen.has(rep)) continue;
    seen.add(rep);
    clusters.push(files.filter((f) => find(f) === rep));
  }
  return clusters;
}

/**
 * Convenience: returns the partner of a file under the staged set, or null
 * if no pair rule fires. When multiple partners exist, returns the cluster
 * minus the input file (caller can pick).
 */
export function findPartners(file: string, allStaged: string[]): string[] {
  const clusters = findFileClusters(allStaged);
  for (const cluster of clusters) {
    if (cluster.includes(file)) {
      return cluster.filter((f) => f !== file);
    }
  }
  return [];
}
