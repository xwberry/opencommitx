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

/** Files that are always boilerplate (grouped together even in individual mode). */
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

/** Split a flat array of files into chunks of at most `maxSize`. */
function chunkFiles(files: string[], maxSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < files.length; i += maxSize) {
    chunks.push(files.slice(i, i + maxSize));
  }
  return chunks;
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
  const individualFiles = config.OCO_DIFF_INDIVIDUAL_FILES ?? false;

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

  // Individual-file mode: every file gets its own group except boilerplate.
  if (individualFiles || mode === 'always') {
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
      reason: individualFiles ? 'OCO_DIFF_INDIVIDUAL_FILES=true' : 'per-file mode forced'
    };
  }

  // auto mode: group files that exceed threshold individually, merge small files.
  const largeFiles = relevantStats.filter(
    (s) => s.added + s.deleted > threshold
  );
  const smallFiles = relevantStats.filter(
    (s) => s.added + s.deleted <= threshold
  );

  if (largeFiles.length === 0) {
    // All files are small — keep as a single group, but respect max group size.
    const chunks = chunkFiles(relevantStats.map((s) => s.file), maxFilesPerGroup);
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
    // Split oversized small-file groups to respect OCO_MAX_FILES_PER_GROUP.
    const chunks = chunkFiles(smallFiles.map((s) => s.file), maxFilesPerGroup);
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
