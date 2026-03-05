import { FileStats } from './git';
import { ConfigType } from '../commands/config';
import {
  extractPythonDocstrings,
  shouldUseDocstringMode
} from './pythonDocstringExtractor';

export interface FileGroupResult {
  files: string[];
  totalLines: number;
  docstringOverride?: string;
}

export interface RoutingResult {
  usePerFile: boolean;
  fileGroups: FileGroupResult[];
  reason: string;
}

const BINARY_OR_GENERATED_EXTENSIONS = new Set([
  '.lock', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.wasm', '.min.js', '.min.css'
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
  '__init__.py', '__init__.pyi',
  'index.ts', 'index.tsx', 'index.js', 'index.jsx',
  'mod.rs',
  'types.ts', 'types.js',
  'constants.ts', 'constants.js',
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
  'uv.lock': 'pyproject.toml',
};

/**
 * Return the expected manifest path for a lock file, preserving directory.
 * Returns null if the file is not a known lock file.
 */
function getLockManifestPath(lockFile: string): string | null {
  const basename = lockFile.split('/').pop() ?? lockFile;
  const manifest = LOCK_TO_MANIFEST[basename];
  if (!manifest) return null;
  const dir = lockFile.includes('/') ? lockFile.substring(0, lockFile.lastIndexOf('/') + 1) : '';
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
    const wouldExceedLines = currentLines + statLines > maxLines && currentFiles.length > 0;

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
  _shouldUse: (file: string, lines: number) => boolean = shouldUseDocstringMode,
  _extract: (file: string) => string | null = extractPythonDocstrings
): RoutingResult {
  const mode = config.OCO_PER_FILE_COMMIT_MODE || 'auto';
  const threshold = config.OCO_PER_FILE_THRESHOLD_LINES ?? 300;
  const maxFilesPerGroup = config.OCO_MAX_FILES_PER_GROUP ?? 10;
  const maxLinesPerGroup = (config as any).OCO_MAX_LINES_PER_GROUP ?? 1500;

  // Lock files are excluded from diff by git (binary/generated) but we want
  // them committed alongside their manifest. Collect them separately.
  const lockFiles = stats.filter((s) => isBinaryOrGenerated(s.file));
  const relevantStats = stats.filter((s) => !isBinaryOrGenerated(s.file));

  if (mode === 'never' || relevantStats.length === 0) {
    return {
      usePerFile: false,
      fileGroups: [{ files: relevantStats.map((s) => s.file), totalLines: 0 }],
      reason: mode === 'never' ? 'per-file mode disabled' : 'no relevant files'
    };
  }

  // always mode: every file gets its own group except boilerplate files,
  // which are grouped together.
  if (mode === 'always') {
    const boilerplateFiles = relevantStats.filter((s) => isBoilerplateFile(s.file));
    const normalFiles = relevantStats.filter((s) => !isBoilerplateFile(s.file));

    const groups: FileGroupResult[] = normalFiles.map((s) => ({
      files: [s.file],
      totalLines: s.added + s.deleted
    }));

    if (boilerplateFiles.length > 0) {
      groups.push({
        files: boilerplateFiles.map((s) => s.file),
        totalLines: boilerplateFiles.reduce((acc, s) => acc + s.added + s.deleted, 0)
      });
    }

    attachLockFiles(lockFiles, groups);

    return {
      usePerFile: true,
      fileGroups: groups,
      reason: 'per-file mode forced (always)'
    };
  }

  // auto mode: group files that exceed threshold individually, merge small files
  // respecting both the file-count cap and the line-count cap.
  const largeFiles = relevantStats.filter(
    (s) => s.added + s.deleted > threshold
  );
  const smallFiles = relevantStats.filter(
    (s) => s.added + s.deleted <= threshold
  );

  if (largeFiles.length === 0) {
    // All files are small — group by directory with caps.
    const chunks = groupByDirectory(relevantStats, maxFilesPerGroup, maxLinesPerGroup);
    const groups: FileGroupResult[] = chunks.map((files) => ({
      files,
      totalLines: files.reduce((acc, f) => {
        const s = relevantStats.find((r) => r.file === f);
        return acc + (s ? s.added + s.deleted : 0);
      }, 0)
    }));

    attachLockFiles(lockFiles, groups);

    return {
      usePerFile: false,
      fileGroups: groups,
      reason: `all files under ${threshold} line threshold`
    };
  }

  const groups: FileGroupResult[] = largeFiles.map((s) => {
    const totalLines = s.added + s.deleted;
    // Pass only s.added — deleted lines must not inflate the ratio.
    const docstringOverride = _shouldUse(s.file, s.added)
      ? _extract(s.file) ?? undefined
      : undefined;
    return {
      files: [s.file],
      totalLines,
      docstringOverride
    };
  });

  if (smallFiles.length > 0) {
    // Group small files by directory with both caps.
    const chunks = groupByDirectory(smallFiles, maxFilesPerGroup, maxLinesPerGroup);
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

  return {
    usePerFile: true,
    fileGroups: groups,
    reason: `${largeFiles.length} file(s) exceeded ${threshold} line threshold`
  };
}

/**
 * Attach lock files to the group that contains their manifest file.
 * Lock files without a matching manifest are appended to the last group.
 */
function attachLockFiles(lockStats: FileStats[], groups: FileGroupResult[]): void {
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
  }
}
