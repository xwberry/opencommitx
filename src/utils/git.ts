import { execa } from 'execa';
import { readFileSync } from 'fs';
import ignore, { Ignore } from 'ignore';
import { join } from 'path';
import { outro, spinner } from '@clack/prompts';

export const assertGitRepo = async () => {
  try {
    await execa('git', ['rev-parse']);
  } catch (error) {
    throw new Error(error as string);
  }
};

// const excludeBigFilesFromDiff = ['*-lock.*', '*.lock'].map(
//   (file) => `:(exclude)${file}`
// );

export const getOpenCommitIgnore = async (): Promise<Ignore> => {
  const gitDir = await getGitDir();

  const ig = ignore();

  try {
    ig.add(
      readFileSync(join(gitDir, '.opencommitignore')).toString().split('\n')
    );
  } catch (e) {}

  return ig;
};

export const getCoreHooksPath = async (): Promise<string> => {
  const gitDir = await getGitDir();

  const { stdout } = await execa('git', ['config', 'core.hooksPath'], {
    cwd: gitDir
  });

  return stdout;
};

export const getStagedFiles = async (): Promise<string[]> => {
  const gitDir = await getGitDir();

  const { stdout: files } = await execa(
    'git',
    ['diff', '--name-only', '--cached', '--relative'],
    { cwd: gitDir }
  );

  if (!files) return [];

  const filesList = files.split('\n');

  const ig = await getOpenCommitIgnore();
  const allowedFiles = filesList.filter((file) => !ig.ignores(file));

  if (!allowedFiles) return [];

  return allowedFiles.sort();
};

/**
 * All staged paths vs those excluded by `.opencommitignore` (for debug / soak logs).
 * Does not filter — callers should use this only when auditing, not for normal flow.
 */
export const getStagedFilesIgnoreAudit = async (): Promise<{
  included: string[];
  filteredByOpencommitignore: string[];
}> => {
  const gitDir = await getGitDir();

  const { stdout: files } = await execa(
    'git',
    ['diff', '--name-only', '--cached', '--relative'],
    { cwd: gitDir }
  );

  if (!files) {
    return { included: [], filteredByOpencommitignore: [] };
  }

  const filesList = files.split('\n').filter(Boolean);
  const ig = await getOpenCommitIgnore();

  const filteredByOpencommitignore: string[] = [];
  const included: string[] = [];

  for (const file of filesList) {
    if (ig.ignores(file)) filteredByOpencommitignore.push(file);
    else included.push(file);
  }

  filteredByOpencommitignore.sort();
  included.sort();

  return { included, filteredByOpencommitignore };
};

export const getChangedFiles = async (): Promise<string[]> => {
  const gitDir = await getGitDir();

  const { stdout: modified } = await execa('git', ['ls-files', '--modified'], {
    cwd: gitDir
  });

  const { stdout: others } = await execa(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: gitDir }
  );

  const files = [...modified.split('\n'), ...others.split('\n')].filter(
    (file) => !!file
  );

  return files.sort();
};

export const gitAdd = async ({ files }: { files: string[] }) => {
  const gitDir = await getGitDir();

  const gitAddSpinner = spinner();

  gitAddSpinner.start('Adding files to commit');

  await execa('git', ['add', ...files], { cwd: gitDir });

  gitAddSpinner.stop(`Staged ${files.length} files`);
};

export const getDiff = async ({ files }: { files: string[] }) => {
  const gitDir = await getGitDir();

  const lockFiles = files.filter(
    (file) =>
      file.includes('.lock') ||
      file.includes('-lock.') ||
      file.includes('.svg') ||
      file.includes('.png') ||
      file.includes('.jpg') ||
      file.includes('.jpeg') ||
      file.includes('.webp') ||
      file.includes('.gif')
  );

  if (lockFiles.length) {
    outro(
      `Some files are excluded by default from 'git diff'. No commit messages are generated for this files:\n${lockFiles.join(
        '\n'
      )}`
    );
  }

  const filesWithoutLocks = files.filter(
    (file) => !file.includes('.lock') && !file.includes('-lock.')
  );

  const { stdout: diff } = await execa(
    'git',
    ['diff', '--staged', '--', ...filesWithoutLocks],
    { cwd: gitDir }
  );

  return diff;
};

export const getGitDir = async (): Promise<string> => {
  const { stdout: gitDir } = await execa('git', [
    'rev-parse',
    '--show-toplevel'
  ]);

  return gitDir;
};

export interface FileStats {
  added: number;
  deleted: number;
  file: string;
}

export const getStagedFilesStats = async (): Promise<FileStats[]> => {
  const gitDir = await getGitDir();

  const { stdout } = await execa('git', ['diff', '--staged', '--numstat'], {
    cwd: gitDir
  });

  if (!stdout.trim()) return [];

  const ig = await getOpenCommitIgnore();

  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split('\t');
      return {
        added: parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0,
        deleted: parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0,
        file: parts[2] || ''
      };
    })
    .filter((stat) => stat.file && !ig.ignores(stat.file));
};

export const getDiffForFiles = async (files: string[]): Promise<string> => {
  return getDiff({ files });
};

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'U';

export interface FileStatusEntry {
  file: string;
  status: FileStatus;
}

/** Returns the staged status (Added/Modified/Deleted/Renamed) for each staged file. */
export const getStagedFilesStatus = async (): Promise<FileStatusEntry[]> => {
  const gitDir = await getGitDir();

  const { stdout } = await execa('git', ['diff', '--staged', '--name-status'], {
    cwd: gitDir
  });

  if (!stdout.trim()) return [];

  const ig = await getOpenCommitIgnore();

  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split('\t');
      const raw = parts[0]?.trim()[0] ?? 'M';
      const status: FileStatus =
        raw === 'A' ||
        raw === 'M' ||
        raw === 'D' ||
        raw === 'R' ||
        raw === 'C' ||
        raw === 'U'
          ? raw
          : 'M';
      const file = parts[parts.length - 1]?.trim() ?? '';
      return { file, status };
    })
    .filter((e) => e.file && !ig.ignores(e.file));
};
