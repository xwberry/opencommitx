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

/**
 * Same layout as the "Staged files" upfront table in the commit command.
 */
export function buildStagedFilesSummaryTable(
  args: BuildStagedFilesSummaryTableArgs
): string {
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

  const colWidths = {
    file: 40,
    lines: 10,
    status: 4,
    ds: 3,
    grp: 4,
    theme: 24
  };
  const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

  const themeHeader = showThemeCol ? `  ${pad('Theme', colWidths.theme)}` : '';
  const header = `${pad('File', colWidths.file)}  ${pad('+/-', colWidths.lines)}  New  DS  Grp${themeHeader}`;
  const divider = '─'.repeat(header.length);

  const rows = stagedFiles.map((f) => {
    const s = statsMap.get(f);
    const lineInfo = s ? `+${s.added}/-${s.deleted}` : '(binary)';
    const isNew = (statusMap.get(f) ?? 'M') === 'A' ? 'Y' : ' ';
    const isDs = docstringFiles.has(f) ? 'Y' : ' ';
    const grp = String(groupIndexMap.get(f) ?? 1);
    let themeCell = '';
    if (showThemeCol) {
      const meta = groupMetaByFile.get(f);
      const parts: string[] = [];
      if (meta?.type) parts.push(meta.type);
      if (meta?.reason && meta.reason !== 'singleton') parts.push(meta.reason);
      themeCell = `  ${pad(parts.join(':') || '—', colWidths.theme)}`;
    }
    return `${pad(f, colWidths.file)}  ${pad(lineInfo, colWidths.lines)}   ${isNew}   ${isDs}   ${grp}${themeCell}`;
  });

  return `${header}\n${divider}\n${rows.join('\n')}`;
}
