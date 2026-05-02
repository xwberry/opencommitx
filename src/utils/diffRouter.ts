import { FileStats } from './git';
import { ConfigType } from '../commands/config';
import {
  extractPythonDocstrings,
  shouldUseDocstringMode
} from './pythonDocstringExtractor';
import { findFileClusters } from './filePairs';
import {
  ConventionalCommitType,
  inferThemeTokens,
  inferType
} from './themeInference';

export interface FileGroupResult {
  files: string[];
  totalLines: number;
  docstringOverride?: string;
  /** Best-guess Conventional Commit type for the group (smart mode). */
  type?: ConventionalCommitType;
  /** Why this group exists ("file-pair", "theme-cluster", "directory-affinity", "merged-undersized"). */
  reason?: string;
}

export interface RoutingResult {
  usePerFile: boolean;
  fileGroups: FileGroupResult[];
  reason: string;
}

const BINARY_OR_GENERATED_EXTENSIONS = new Set([
  '.lock',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.wasm',
  '.min.js',
  '.min.css'
]);

function isBinaryOrGenerated(file: string): boolean {
  const lower = file.toLowerCase();
  const ext = `.${lower.split('.').pop() || ''}`;
  return (
    BINARY_OR_GENERATED_EXTENSIONS.has(ext) ||
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    lower.endsWith('-lock.json') ||
    lower.endsWith('.lock')
  );
}

/** Files that are always boilerplate (grouped together even in always/individual mode). */
const BOILERPLATE_BASENAMES = new Set([
  '__init__.py',
  '__init__.pyi',
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'mod.rs',
  'types.ts',
  'types.js',
  'constants.ts',
  'constants.js'
]);

function isBoilerplateFile(file: string): boolean {
  const basename = file.split('/').pop() ?? file;
  return BOILERPLATE_BASENAMES.has(basename);
}

/**
 * Map lock file basenames to their associated manifest basenames.
 * Used to attach lock files to the same commit group as their manifest.
 */
const LOCK_TO_MANIFEST: Record<string, string> = {
  'pixi.lock': 'pixi.toml',
  'package-lock.json': 'package.json',
  'yarn.lock': 'package.json',
  'pnpm-lock.yaml': 'package.json',
  'Cargo.lock': 'Cargo.toml',
  'Pipfile.lock': 'Pipfile',
  'Gemfile.lock': 'Gemfile',
  'go.sum': 'go.mod',
  'poetry.lock': 'pyproject.toml',
  'uv.lock': 'pyproject.toml'
};

/**
 * Return the expected manifest path for a lock file, preserving directory.
 * Returns null if the file is not a known lock file.
 */
function getLockManifestPath(lockFile: string): string | null {
  const basename = lockFile.split('/').pop() ?? lockFile;
  const manifest = LOCK_TO_MANIFEST[basename];
  if (!manifest) return null;
  const dir = lockFile.includes('/')
    ? lockFile.substring(0, lockFile.lastIndexOf('/') + 1)
    : '';
  return dir + manifest;
}

/** Return the directory portion of a file path (empty string for root-level files). */
function fileDir(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx >= 0 ? file.substring(0, idx) : '';
}

/**
 * Group files by directory affinity using greedy bin-packing.
 *
 * Files are sorted by their directory path so that files within the same
 * sub-tree are naturally adjacent. Each group is closed when it would exceed
 * either the file-count cap or the line-count cap.
 */
function groupByDirectory(
  stats: FileStats[],
  maxFiles: number,
  maxLines: number
): string[][] {
  // Sort by directory first so siblings cluster together.
  const sorted = [...stats].sort((a, b) => {
    const da = fileDir(a.file);
    const db = fileDir(b.file);
    if (da !== db) return da.localeCompare(db);
    return a.file.localeCompare(b.file);
  });

  const groups: string[][] = [];
  let currentFiles: string[] = [];
  let currentLines = 0;

  for (const stat of sorted) {
    const statLines = stat.added + stat.deleted;
    const wouldExceedFiles = currentFiles.length >= maxFiles;
    const wouldExceedLines =
      currentLines + statLines > maxLines && currentFiles.length > 0;

    if (wouldExceedFiles || wouldExceedLines) {
      groups.push(currentFiles);
      currentFiles = [];
      currentLines = 0;
    }

    currentFiles.push(stat.file);
    currentLines += statLines;
  }

  if (currentFiles.length > 0) {
    groups.push(currentFiles);
  }

  return groups;
}

interface ClassifiedFiles {
  /** Generated files with a known manifest mapping (e.g. package-lock.json). */
  lockFiles: FileStats[];
  /** Generated files without a manifest mapping (e.g. logo.png, *.min.js). */
  standaloneGenerated: FileStats[];
  /** Source files — everything not detected as binary/generated. */
  relevantStats: FileStats[];
}

function classifyFiles(stats: FileStats[]): ClassifiedFiles {
  const lockFiles = stats.filter(
    (s) => isBinaryOrGenerated(s.file) && getLockManifestPath(s.file) !== null
  );
  const standaloneGenerated = stats.filter(
    (s) => isBinaryOrGenerated(s.file) && getLockManifestPath(s.file) === null
  );
  const relevantStats = stats.filter((s) => !isBinaryOrGenerated(s.file));
  return { lockFiles, standaloneGenerated, relevantStats };
}

type ShouldUseFn = (file: string, lines: number) => boolean;
type ExtractFn = (file: string) => string | null;

/**
 * Given numstat results and config, determine whether to use per-file mode
 * and how to group the files.
 *
 * `_shouldUse` and `_extract` are injectable for unit tests; production callers
 * rely on the defaults.
 */
export function routeDiff(
  stats: FileStats[],
  config: Partial<ConfigType>,
  _shouldUse: ShouldUseFn = shouldUseDocstringMode,
  _extract: ExtractFn = extractPythonDocstrings
): RoutingResult {
  const mode = config.OCO_PER_FILE_COMMIT_MODE || 'auto';
  const { lockFiles, standaloneGenerated, relevantStats } =
    classifyFiles(stats);

  if (mode === 'never') {
    return routeDiffNever({ lockFiles, standaloneGenerated, relevantStats });
  }

  if (relevantStats.length === 0) {
    return routeDiffEmptyRelevant({ mode, lockFiles, standaloneGenerated });
  }

  if (mode === 'always') {
    return routeDiffAlways({ lockFiles, standaloneGenerated, relevantStats });
  }

  if (mode === 'smart') {
    return routeDiffSmart({
      config,
      lockFiles,
      standaloneGenerated,
      relevantStats,
      _shouldUse,
      _extract
    });
  }

  // Default: auto.
  return routeDiffAuto({
    config,
    lockFiles,
    standaloneGenerated,
    relevantStats,
    _shouldUse,
    _extract
  });
}

interface ModeContext {
  lockFiles: FileStats[];
  standaloneGenerated: FileStats[];
  relevantStats: FileStats[];
}

function routeDiffNever(ctx: ModeContext): RoutingResult {
  const allFiles = [
    ...ctx.relevantStats,
    ...ctx.lockFiles,
    ...ctx.standaloneGenerated
  ].map((s) => s.file);
  return {
    usePerFile: false,
    fileGroups: allFiles.length ? [{ files: allFiles, totalLines: 0 }] : [],
    reason: 'per-file mode disabled'
  };
}

function routeDiffEmptyRelevant(args: {
  mode: string;
  lockFiles: FileStats[];
  standaloneGenerated: FileStats[];
}): RoutingResult {
  const { mode, lockFiles, standaloneGenerated } = args;
  const groups: FileGroupResult[] = [];
  if (lockFiles.length) {
    groups.push({
      files: lockFiles.map((s) => s.file),
      totalLines: lockFiles.reduce((a, s) => a + s.added + s.deleted, 0)
    });
  }
  for (const gen of standaloneGenerated) {
    groups.push({
      files: [gen.file],
      totalLines: gen.added + gen.deleted
    });
  }
  return {
    usePerFile: mode === 'always' || standaloneGenerated.length > 0,
    fileGroups: groups,
    reason: 'no relevant files'
  };
}

function routeDiffAlways(ctx: ModeContext): RoutingResult {
  const { lockFiles, standaloneGenerated, relevantStats } = ctx;
  const boilerplateFiles = relevantStats.filter((s) =>
    isBoilerplateFile(s.file)
  );
  const normalFiles = relevantStats.filter((s) => !isBoilerplateFile(s.file));

  const groups: FileGroupResult[] = normalFiles.map((s) => ({
    files: [s.file],
    totalLines: s.added + s.deleted
  }));

  if (boilerplateFiles.length > 0) {
    groups.push({
      files: boilerplateFiles.map((s) => s.file),
      totalLines: boilerplateFiles.reduce(
        (acc, s) => acc + s.added + s.deleted,
        0
      )
    });
  }

  attachLockFiles(lockFiles, groups);
  attachStandaloneGenerated(standaloneGenerated, groups);

  return {
    usePerFile: true,
    fileGroups: groups,
    reason: 'per-file mode forced (always)'
  };
}

function routeDiffAuto(args: {
  config: Partial<ConfigType>;
  lockFiles: FileStats[];
  standaloneGenerated: FileStats[];
  relevantStats: FileStats[];
  _shouldUse: ShouldUseFn;
  _extract: ExtractFn;
}): RoutingResult {
  const {
    config,
    lockFiles,
    standaloneGenerated,
    relevantStats,
    _shouldUse,
    _extract
  } = args;
  const threshold = config.OCO_PER_FILE_THRESHOLD_LINES ?? 300;
  const maxFilesPerGroup = config.OCO_MAX_FILES_PER_GROUP ?? 10;
  const maxLinesPerGroup = config.OCO_MAX_LINES_PER_GROUP ?? 1500;

  const largeFiles = relevantStats.filter(
    (s) => s.added + s.deleted > threshold
  );
  const smallFiles = relevantStats.filter(
    (s) => s.added + s.deleted <= threshold
  );

  if (largeFiles.length === 0) {
    // All files are small — group by directory with caps.
    const chunks = groupByDirectory(
      relevantStats,
      maxFilesPerGroup,
      maxLinesPerGroup
    );
    const groups: FileGroupResult[] = chunks.map((files) => ({
      files,
      totalLines: files.reduce((acc, f) => {
        const s = relevantStats.find((r) => r.file === f);
        return acc + (s ? s.added + s.deleted : 0);
      }, 0)
    }));

    attachLockFiles(lockFiles, groups);
    attachStandaloneGenerated(standaloneGenerated, groups);

    return {
      usePerFile: standaloneGenerated.length > 0,
      fileGroups: groups,
      reason: `all files under ${threshold} line threshold`
    };
  }

  const groups: FileGroupResult[] = largeFiles.map((s) => {
    const totalLines = s.added + s.deleted;
    // Pass only s.added — deleted lines must not inflate the ratio.
    const docstringOverride = _shouldUse(s.file, s.added)
      ? (_extract(s.file) ?? undefined)
      : undefined;
    return {
      files: [s.file],
      totalLines,
      docstringOverride
    };
  });

  if (smallFiles.length > 0) {
    // Group small files by directory with both caps.
    const chunks = groupByDirectory(
      smallFiles,
      maxFilesPerGroup,
      maxLinesPerGroup
    );
    chunks.forEach((files) => {
      groups.push({
        files,
        totalLines: files.reduce((acc, f) => {
          const s = smallFiles.find((r) => r.file === f);
          return acc + (s ? s.added + s.deleted : 0);
        }, 0)
      });
    });
  }

  attachLockFiles(lockFiles, groups);
  attachStandaloneGenerated(standaloneGenerated, groups);

  return {
    usePerFile: true,
    fileGroups: groups,
    reason: `${largeFiles.length} file(s) exceeded ${threshold} line threshold`
  };
}

function routeDiffSmart(args: {
  config: Partial<ConfigType>;
  lockFiles: FileStats[];
  standaloneGenerated: FileStats[];
  relevantStats: FileStats[];
  _shouldUse: ShouldUseFn;
  _extract: ExtractFn;
}): RoutingResult {
  const {
    config,
    lockFiles,
    standaloneGenerated,
    relevantStats,
    _shouldUse,
    _extract
  } = args;
  const maxFilesPerGroup = config.OCO_MAX_FILES_PER_GROUP ?? 10;
  const maxLinesPerGroup = config.OCO_MAX_LINES_PER_GROUP ?? 1500;
  const minSharedTokens = config.OCO_ROUTING_THEME_MIN_TOKENS ?? 1;
  const rebalanceThreshold = config.OCO_ROUTING_REBALANCE_THRESHOLD ?? 0.3;

  if (relevantStats.length === 0) {
    // Should be handled upstream by routeDiffEmptyRelevant, but be defensive.
    return {
      usePerFile: standaloneGenerated.length > 0,
      fileGroups: [],
      reason: 'smart routing — no relevant files'
    };
  }

  const statsByFile = new Map<string, FileStats>(
    relevantStats.map((s) => [s.file, s])
  );
  const filePaths = relevantStats.map((s) => s.file);

  // Phase A: explicit file-pair clusters (test↔source, component↔siblings, etc.).
  const pairClusters = findFileClusters(filePaths);

  // Phase B: merge pair clusters that share theme tokens.
  const themeClusters = mergeByThemeTokens(pairClusters, minSharedTokens);

  // Phase C: bin-pack each theme cluster respecting caps; tag with reason.
  // Reason logic:
  //   - 'singleton'      → cluster of 1 file
  //   - 'file-pair'      → cluster IS exactly one original pair cluster (no theme merge happened)
  //   - 'theme-cluster'  → cluster spans 2+ original pair clusters merged via shared theme tokens
  const groups: FileGroupResult[] = [];
  for (const cluster of themeClusters) {
    const containedPairs = pairClusters.filter(
      (pc) => pc.length > 1 && pc.every((f) => cluster.includes(f))
    );
    let reason: string;
    if (cluster.length === 1) {
      reason = 'singleton';
    } else if (
      containedPairs.length === 1 &&
      containedPairs[0].length === cluster.length
    ) {
      reason = 'file-pair';
    } else {
      reason = 'theme-cluster';
    }
    const packed = packCluster(
      cluster,
      statsByFile,
      maxFilesPerGroup,
      maxLinesPerGroup,
      reason
    );
    groups.push(...packed);
  }

  // Phase D: merge adjacent undersized groups when their themes overlap.
  const rebalanced = rebalanceUndersized(
    groups,
    maxFilesPerGroup,
    maxLinesPerGroup,
    rebalanceThreshold
  );

  // Phase E: docstring-override for single-file Python groups (preserves
  // the existing auto-mode behaviour for large Python rewrites).
  for (const group of rebalanced) {
    if (group.files.length === 1) {
      const stat = statsByFile.get(group.files[0]);
      if (stat && _shouldUse(stat.file, stat.added)) {
        group.docstringOverride = _extract(stat.file) ?? undefined;
      }
    }
  }

  // Tag each group with an inferred Conventional Commit type when path-based
  // signals are decisive. Conservative rule: ALL files in the group must have
  // the same concrete inferred type. A mixed group (e.g. source + test) where
  // some files have undefined inferred type stays untagged — the LLM will
  // pick the type from the diff content. Tagging a mixed test/source pair as
  // "test" was misleading.
  for (const group of rebalanced) {
    const types = group.files.map((f) => inferType(f));
    if (
      types.length > 0 &&
      types.every(
        (t): t is ConventionalCommitType => t !== undefined && t === types[0]
      )
    ) {
      group.type = types[0];
    }
  }

  // Phase F: attach lock + standalone-generated files.
  attachLockFiles(lockFiles, rebalanced);
  attachStandaloneGenerated(standaloneGenerated, rebalanced);

  // usePerFile is true whenever there's more than one logical group.
  const usePerFile = rebalanced.length > 1;

  return {
    usePerFile,
    fileGroups: rebalanced,
    reason: `smart routing — ${rebalanced.length} group(s)`
  };
}

/**
 * Merge pair-clusters when they share at least `minOverlap` non-generic theme
 * tokens. Operates over arrays of file paths; returns merged clusters.
 */
function mergeByThemeTokens(
  clusters: string[][],
  minOverlap: number
): string[][] {
  if (clusters.length <= 1) return clusters;

  const signatures = clusters.map(
    (c) => new Set(c.flatMap((f) => inferThemeTokens(f)))
  );

  const parent = clusters.map((_, i) => i);
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) cur = parent[cur];
    let node = i;
    while (parent[node] !== cur) {
      const next = parent[node];
      parent[node] = cur;
      node = next;
    }
    return cur;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < clusters.length; i++) {
    if (signatures[i].size === 0) continue;
    for (let j = i + 1; j < clusters.length; j++) {
      if (signatures[j].size === 0) continue;
      let shared = 0;
      for (const tok of signatures[i]) {
        if (signatures[j].has(tok)) shared += 1;
        if (shared >= minOverlap) break;
      }
      if (shared >= minOverlap) union(i, j);
    }
  }

  // Build merged clusters preserving the input order of the first member
  // of each cluster.
  const seen = new Set<number>();
  const merged: string[][] = [];
  for (let i = 0; i < clusters.length; i++) {
    const root = find(i);
    if (seen.has(root)) continue;
    seen.add(root);
    const memberIdxs: number[] = [];
    for (let j = 0; j < clusters.length; j++) {
      if (find(j) === root) memberIdxs.push(j);
    }
    merged.push(memberIdxs.flatMap((k) => clusters[k]));
  }
  return merged;
}

/**
 * Bin-pack one theme cluster into one or more groups respecting file/line caps.
 * Within the cluster, files keep their input order so the user sees stable
 * grouping. When a single file already exceeds the line cap it gets its own
 * group (no further splitting — that's a different concern).
 */
function packCluster(
  cluster: string[],
  statsByFile: Map<string, FileStats>,
  maxFiles: number,
  maxLines: number,
  reason: string
): FileGroupResult[] {
  const groups: FileGroupResult[] = [];
  let currentFiles: string[] = [];
  let currentLines = 0;
  for (const file of cluster) {
    const stat = statsByFile.get(file);
    const lines = stat ? stat.added + stat.deleted : 0;
    const wouldExceedFiles = currentFiles.length >= maxFiles;
    const wouldExceedLines =
      currentLines + lines > maxLines && currentFiles.length > 0;
    if (wouldExceedFiles || wouldExceedLines) {
      groups.push({
        files: currentFiles,
        totalLines: currentLines,
        reason:
          cluster.length > currentFiles.length ? `${reason} (split)` : reason
      });
      currentFiles = [];
      currentLines = 0;
    }
    currentFiles.push(file);
    currentLines += lines;
  }
  if (currentFiles.length > 0) {
    groups.push({
      files: currentFiles,
      totalLines: currentLines,
      reason: groups.length > 0 ? `${reason} (split)` : reason
    });
  }
  return groups;
}

/**
 * Greedy single-pass merge of adjacent undersized groups when their themes
 * overlap and the merged group still fits within caps.
 */
function rebalanceUndersized(
  groups: FileGroupResult[],
  maxFiles: number,
  maxLines: number,
  threshold: number
): FileGroupResult[] {
  if (groups.length < 2) return groups;
  const fileLimit = Math.max(1, Math.floor(maxFiles * threshold));
  const lineLimit = Math.max(1, Math.floor(maxLines * threshold));

  const merged: FileGroupResult[] = [];
  let i = 0;
  while (i < groups.length) {
    const cur = groups[i];
    const next = i < groups.length - 1 ? groups[i + 1] : null;
    if (next) {
      const curUnder =
        cur.files.length <= fileLimit && cur.totalLines <= lineLimit;
      const nextUnder =
        next.files.length <= fileLimit && next.totalLines <= lineLimit;
      if (curUnder && nextUnder) {
        // Theme compatibility check: any non-generic shared token.
        const curTokens = new Set(
          cur.files.flatMap((f) => inferThemeTokens(f))
        );
        const nextTokens = new Set(
          next.files.flatMap((f) => inferThemeTokens(f))
        );
        let overlap = 0;
        for (const t of curTokens) {
          if (nextTokens.has(t)) {
            overlap += 1;
            break;
          }
        }
        const combinedFiles = cur.files.length + next.files.length;
        const combinedLines = cur.totalLines + next.totalLines;
        const fitsCaps = combinedFiles <= maxFiles && combinedLines <= maxLines;
        if (overlap > 0 && fitsCaps) {
          merged.push({
            files: [...cur.files, ...next.files],
            totalLines: combinedLines,
            reason: 'merged-undersized'
          });
          i += 2;
          continue;
        }
      }
    }
    merged.push(cur);
    i += 1;
  }
  return merged;
}

/**
 * Attach lock files to the group that contains their manifest file.
 * Lock files without a matching manifest are appended to the last group
 * (intentional — a lone lockfile change usually accompanies the most recent
 * dependency-related commit).
 */
function attachLockFiles(
  lockStats: FileStats[],
  groups: FileGroupResult[]
): void {
  if (lockStats.length === 0 || groups.length === 0) return;

  for (const lockStat of lockStats) {
    const manifestPath = getLockManifestPath(lockStat.file);
    let targetGroup: FileGroupResult | undefined;

    if (manifestPath) {
      targetGroup = groups.find((g) => g.files.includes(manifestPath));
    }

    if (!targetGroup) {
      targetGroup = groups[groups.length - 1];
    }

    targetGroup.files.push(lockStat.file);
    targetGroup.totalLines += lockStat.added + lockStat.deleted;
  }
}

/**
 * Append each standalone generated asset (no manifest mapping — e.g. .png,
 * .min.js, .wasm) as its own group. Bundling these into an unrelated source
 * commit produces misleading commit messages.
 */
function attachStandaloneGenerated(
  generatedStats: FileStats[],
  groups: FileGroupResult[]
): void {
  for (const stat of generatedStats) {
    groups.push({
      files: [stat.file],
      totalLines: stat.added + stat.deleted
    });
  }
}
