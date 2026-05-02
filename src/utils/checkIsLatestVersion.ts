import chalk from 'chalk';

import { outro } from '@clack/prompts';

import currentPackage from '../../package.json';
import { getOpenCommitLatestVersion } from '../version';

export const checkIsLatestVersion = async () => {
  const latestVersion = await getOpenCommitLatestVersion();

  if (latestVersion) {
    const currentVersion = currentPackage.version;

    if (currentVersion !== latestVersion) {
      outro(
        chalk.yellow(
          `
You are not using the latest version of opencommitx.
Current version: ${currentVersion}. Latest version: ${latestVersion}.
🚀 To update run: npm i -g opencommitx@latest.
        `
        )
      );
    }
  }
};
