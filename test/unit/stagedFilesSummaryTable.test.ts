import type { FileGroupResult } from '../../src/utils/diffRouter';
import { buildStagedFilesSummaryTable } from '../../src/utils/stagedFilesSummaryTable';

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
  });
});
