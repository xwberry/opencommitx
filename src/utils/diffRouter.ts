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

  const relevantStats = stats.filter((s) => !isBinaryOrGenerated(s.file));

  if (mode === 'never' || relevantStats.length === 0) {
    return {
      usePerFile: false,
      fileGroups: [{ files: relevantStats.map((s) => s.file), totalLines: 0 }],
      reason: mode === 'never' ? 'per-file mode disabled' : 'no relevant files'
    };
  }

  if (mode === 'always') {
    return {
      usePerFile: true,
      fileGroups: relevantStats.map((s) => ({
        files: [s.file],
        totalLines: s.added + s.deleted
      })),
      reason: 'per-file mode forced'
    };
  }

  // auto mode: group files that exceed threshold individually, merge small files
  const largeFiles = relevantStats.filter(
    (s) => s.added + s.deleted > threshold
  );
  const smallFiles = relevantStats.filter(
    (s) => s.added + s.deleted <= threshold
  );

  if (largeFiles.length === 0) {
    return {
      usePerFile: false,
      fileGroups: [{ files: relevantStats.map((s) => s.file), totalLines: 0 }],
      reason: `all files under ${threshold} line threshold`
    };
  }

  const groups: FileGroupResult[] = largeFiles.map((s) => {
    const totalLines = s.added + s.deleted;
    const docstringOverride = _shouldUse(s.file, totalLines)
      ? _extract(s.file) ?? undefined
      : undefined;
    return {
      files: [s.file],
      totalLines,
      docstringOverride
    };
  });

  if (smallFiles.length > 0) {
    groups.push({
      files: smallFiles.map((s) => s.file),
      totalLines: smallFiles.reduce((acc, s) => acc + s.added + s.deleted, 0)
    });
  }

  return {
    usePerFile: true,
    fileGroups: groups,
    reason: `${largeFiles.length} file(s) exceeded ${threshold} line threshold`
  };
}
