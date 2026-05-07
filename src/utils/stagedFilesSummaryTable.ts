import type { FileGroupResult } from './diffRouter';
import type { FileStats, FileStatusEntry } from './git';

export interface BuildStagedFilesSummaryTableArgs {
  stagedFiles: string[];
  stats: FileStats[];
  statusEntries: FileStatusEntry[];
  fileGroups: FileGroupResult[];
  usePerFileMode: boolean;
  perFileMode: string;
  shouldUseDocstringMode: (file: string, added: number) => boolean;
}

/** One row of the upfront staged-files summary (terminal + routing debug log). */
export interface StagedFilesSummaryRow {
  file: string;
  lines_added: number | null;
  lines_deleted: number | null;
  is_new: boolean;
  docstring_mode: boolean;
  /** 1-based group index (Grp column). */
  group: number;
  /** Smart mode: tag from diffRouter, if any. */
  inferred_commit_type: string | null;
  /** Smart mode: raw group.reason from diffRouter (e.g. singleton, file-pair). */
  router_cluster_reason: string | null;
  /** Smart mode: Theme column text as rendered (matches terminal). */
  theme_display: string | null;
}

export interface StagedFilesSummaryData {
  show_theme_column: boolean;
  rows: StagedFilesSummaryRow[];
}

export function buildStagedFilesSummaryData(
  args: BuildStagedFilesSummaryTableArgs
): StagedFilesSummaryData {
  const {
    stagedFiles,
    stats,
    statusEntries,
    fileGroups,
    usePerFileMode,
    perFileMode,
    shouldUseDocstringMode
  } = args;

  const statusMap = new Map<string, string>(
    statusEntries.map((e) => [e.file, e.status] as [string, string])
  );
  const statsMap = new Map<string, FileStats>(
    stats.map((s) => [s.file, s] as [string, FileStats])
  );

  const groupIndexMap = new Map<string, number>();
  if (usePerFileMode && fileGroups.length > 0) {
    fileGroups.forEach((g, i) => {
      g.files.forEach((f) => {
        groupIndexMap.set(f, i + 1);
      });
    });
  } else {
    stagedFiles.forEach((f) => {
      groupIndexMap.set(f, 1);
    });
  }

  const docstringFiles = new Set<string>();
  for (const [f, s] of statsMap) {
    if (shouldUseDocstringMode(f, s.added)) {
      docstringFiles.add(f);
    }
  }

  const showThemeCol = perFileMode === 'smart' && fileGroups.length > 0;

  const groupMetaByFile = new Map<string, { reason?: string; type?: string }>();
  if (showThemeCol) {
    for (const g of fileGroups) {
      for (const f of g.files) {
        groupMetaByFile.set(f, { reason: g.reason, type: g.type });
      }
    }
  }

  const rows: StagedFilesSummaryRow[] = stagedFiles.map((f) => {
    const s = statsMap.get(f);
    const isNew = (statusMap.get(f) ?? 'M') === 'A';
    const row: StagedFilesSummaryRow = {
      file: f,
      lines_added: s !== undefined ? s.added : null,
      lines_deleted: s !== undefined ? s.deleted : null,
      is_new: isNew,
      docstring_mode: docstringFiles.has(f),
      group: groupIndexMap.get(f) ?? 1,
      inferred_commit_type: null,
      router_cluster_reason: null,
      theme_display: null
    };

    if (showThemeCol) {
      const meta = groupMetaByFile.get(f);
      row.inferred_commit_type = meta?.type ?? null;
      row.router_cluster_reason = meta?.reason ?? null;
      const parts: string[] = [];
      if (meta?.type) parts.push(meta.type);
      if (meta?.reason && meta.reason !== 'singleton') parts.push(meta.reason);
      row.theme_display = parts.length > 0 ? parts.join(':') : '—';
    }

    return row;
  });

  return { show_theme_column: showThemeCol, rows };
}

/**
 * Renders the same layout as the "Staged files" upfront table in the commit command.
 */
export function formatStagedFilesSummaryTable(
  data: StagedFilesSummaryData
): string {
  const { show_theme_column, rows } = data;
  const colWidths = {
    file: 40,
    lines: 10,
    theme: 24
  };
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

  const themeHeader = show_theme_column
    ? `  ${pad('Theme', colWidths.theme)}`
    : '';
  const header = `${pad('File', colWidths.file)}  ${pad('+/-', colWidths.lines)}  New  DS  Grp${themeHeader}`;
  const divider = '─'.repeat(header.length);

  const lines = rows.map((r) => {
    const lineInfo =
      r.lines_added !== null && r.lines_deleted !== null
        ? `+${r.lines_added}/-${r.lines_deleted}`
        : '(binary)';
    const newCol = r.is_new ? 'Y' : ' ';
    const dsCol = r.docstring_mode ? 'Y' : ' ';
    const grp = String(r.group);
    let themeCell = '';
    if (show_theme_column) {
      const td = r.theme_display ?? '—';
      themeCell = `  ${pad(td, colWidths.theme)}`;
    }
    return `${pad(r.file, colWidths.file)}  ${pad(lineInfo, colWidths.lines)}   ${newCol}   ${dsCol}   ${grp}${themeCell}`;
  });

  return `${header}\n${divider}\n${lines.join('\n')}`;
}

export function buildStagedFilesSummaryTable(
  args: BuildStagedFilesSummaryTableArgs
): string {
  return formatStagedFilesSummaryTable(buildStagedFilesSummaryData(args));
}
