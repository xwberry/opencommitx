import type { FileGroupResult } from '../../src/utils/diffRouter';
import {
  buildStagedFilesSummaryData,
  buildStagedFilesSummaryTable
} from '../../src/utils/stagedFilesSummaryTable';

describe('buildStagedFilesSummaryTable', () => {
  const shouldUse = () => false;

  it('renders header and one row for aggregate display', () => {
    const table = buildStagedFilesSummaryTable({
      stagedFiles: ['src/a.ts'],
      stats: [{ file: 'src/a.ts', added: 3, deleted: 1 }],
      statusEntries: [{ file: 'src/a.ts', status: 'M' }],
      fileGroups: [],
      usePerFileMode: false,
      perFileMode: 'never',
      shouldUseDocstringMode: shouldUse
    });
    expect(table).toContain('File');
    expect(table).toContain('src/a.ts');
    expect(table).toContain('+3/-1');
    expect(table).toContain('Grp');
    expect(table).not.toContain('Theme');
  });

  it('exposes structured rows without theme columns when not smart mode', () => {
    const data = buildStagedFilesSummaryData({
      stagedFiles: ['src/a.ts'],
      stats: [{ file: 'src/a.ts', added: 3, deleted: 1 }],
      statusEntries: [{ file: 'src/a.ts', status: 'M' }],
      fileGroups: [],
      usePerFileMode: false,
      perFileMode: 'never',
      shouldUseDocstringMode: shouldUse
    });
    expect(data.show_theme_column).toBe(false);
    expect(data.rows).toEqual([
      expect.objectContaining({
        file: 'src/a.ts',
        lines_added: 3,
        lines_deleted: 1,
        is_new: false,
        docstring_mode: false,
        group: 1,
        inferred_commit_type: null,
        router_cluster_reason: null,
        theme_display: null
      })
    ]);
  });

  it('adds Theme column in smart mode with group metadata', () => {
    const fileGroups: FileGroupResult[] = [
      {
        files: ['foo.ts'],
        totalLines: 5,
        reason: 'file-pair',
        type: 'feat'
      }
    ];
    const table = buildStagedFilesSummaryTable({
      stagedFiles: ['foo.ts'],
      stats: [{ file: 'foo.ts', added: 5, deleted: 0 }],
      statusEntries: [{ file: 'foo.ts', status: 'A' }],
      fileGroups,
      usePerFileMode: true,
      perFileMode: 'smart',
      shouldUseDocstringMode: shouldUse
    });
    expect(table).toContain('Theme');
    expect(table).toContain('feat:file-pair');
    expect(table).toContain('Y'); // New column

    const data = buildStagedFilesSummaryData({
      stagedFiles: ['foo.ts'],
      stats: [{ file: 'foo.ts', added: 5, deleted: 0 }],
      statusEntries: [{ file: 'foo.ts', status: 'A' }],
      fileGroups,
      usePerFileMode: true,
      perFileMode: 'smart',
      shouldUseDocstringMode: shouldUse
    });
    expect(data.show_theme_column).toBe(true);
    expect(data.rows[0]).toMatchObject({
      file: 'foo.ts',
      lines_added: 5,
      lines_deleted: 0,
      is_new: true,
      group: 1,
      inferred_commit_type: 'feat',
      router_cluster_reason: 'file-pair',
      theme_display: 'feat:file-pair'
    });
  });
});
