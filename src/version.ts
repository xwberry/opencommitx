import { execa } from 'execa';

export const getOpenCommitLatestVersion = async (): Promise<
  string | undefined
> => {
  try {
    const { stdout } = await execa('npm', ['view', 'opencommitx', 'version']);
    return stdout;
  } catch (_) {
    return undefined;
  }
};
