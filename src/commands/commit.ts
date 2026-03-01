import {
  text,
  confirm,
  intro,
  isCancel,
  multiselect,
  outro,
  select,
  spinner
} from '@clack/prompts';
import chalk from 'chalk';
import { execa } from 'execa';
import { generateCommitMessageByDiff } from '../generateCommitMessageFromGitDiff';
import {
  buildCommitPlan,
  combineCommitMessages
} from '../utils/commitStrategy';
import {
  formatUserFriendlyError,
  printFormattedError
} from '../utils/errors';
import {
  assertGitRepo,
  getChangedFiles,
  getDiff,
  getDiffForFiles,
  getStagedFiles,
  getStagedFilesStats,
  gitAdd
} from '../utils/git';
import {
  getCachedCommitMessage,
  setCachedCommitMessage,
  formatCacheAge
} from '../utils/commitCache';
import { routeDiff, FileGroupResult } from '../utils/diffRouter';
import { trytm } from '../utils/trytm';
import { getConfig } from './config';

const config = getConfig();

const getGitRemotes = async () => {
  const { stdout } = await execa('git', ['remote']);
  return stdout.split('\n').filter((remote) => Boolean(remote.trim()));
};

const checkMessageTemplate = (extraArgs: string[]): string | false => {
  for (const key in extraArgs) {
    if (extraArgs[key].includes(config.OCO_MESSAGE_TEMPLATE_PLACEHOLDER))
      return extraArgs[key];
  }
  return false;
};

interface GenerateCommitMessageFromGitDiffParams {
  diff: string;
  extraArgs: string[];
  context?: string;
  fullGitMojiSpec?: boolean;
  skipCommitConfirmation?: boolean;
}

async function handleGitPush(): Promise<void> {
  if (config.OCO_GITPUSH === false) return;

  const remotes = await getGitRemotes();

  if (!remotes.length) {
    const { stdout } = await execa('git', ['push']);
    if (stdout) outro(stdout);
    return;
  }

  if (remotes.length === 1) {
    const isPushConfirmedByUser = await confirm({
      message: 'Do you want to run `git push`?'
    });

    if (isCancel(isPushConfirmedByUser)) process.exit(1);

    if (isPushConfirmedByUser) {
      const pushSpinner = spinner();
      pushSpinner.start(`Running 'git push ${remotes[0]}'`);
      const { stdout } = await execa('git', ['push', '--verbose', remotes[0]]);
      pushSpinner.stop(
        `${chalk.green('✔')} Successfully pushed all commits to ${remotes[0]}`
      );
      if (stdout) outro(stdout);
    } else {
      outro('`git push` aborted');
    }
  } else {
    const skipOption = `don't push`;
    const selectedRemote = (await select({
      message: 'Choose a remote to push to',
      options: [...remotes, skipOption].map((remote) => ({
        value: remote,
        label: remote
      }))
    })) as string;

    if (isCancel(selectedRemote)) process.exit(1);

    if (selectedRemote !== skipOption) {
      const pushSpinner = spinner();
      pushSpinner.start(`Running 'git push ${selectedRemote}'`);
      const { stdout } = await execa('git', ['push', selectedRemote]);
      if (stdout) outro(stdout);
      pushSpinner.stop(
        `${chalk.green('✔')} successfully pushed all commits to ${selectedRemote}`
      );
    }
  }
}

async function performCommit(
  commitMessage: string,
  extraArgs: string[],
  skipCommitConfirmation: boolean = false,
  label: string = ''
): Promise<boolean> {
  const displayLabel = label ? `${label}\n` : '';

  outro(
    `${displayLabel}Generated commit message:\n${chalk.grey('——————————————————')}\n${commitMessage}\n${chalk.grey('——————————————————')}`
  );

  const userAction = skipCommitConfirmation
    ? 'Yes'
    : await select({
        message: 'Confirm the commit message?',
        options: [
          { value: 'Yes', label: 'Yes' },
          { value: 'No', label: 'No' },
          { value: 'Edit', label: 'Edit' }
        ]
      });

  if (isCancel(userAction)) process.exit(1);

  let finalMessage = commitMessage;

  if (userAction === 'Edit') {
    const textResponse = await text({
      message: 'Please edit the commit message: (press Enter to continue)',
      initialValue: commitMessage
    });
    finalMessage = textResponse.toString();
  }

  if (userAction === 'Yes' || userAction === 'Edit') {
    const committingChangesSpinner = spinner();
    committingChangesSpinner.start('Committing the changes');
    const { stdout } = await execa('git', [
      'commit',
      '-m',
      finalMessage,
      ...extraArgs
    ]);
    committingChangesSpinner.stop(`${chalk.green('✔')} Successfully committed`);
    outro(stdout);
    return true;
  }

  return false;
}

const generateCommitMessageFromGitDiff = async ({
  diff,
  extraArgs,
  context = '',
  fullGitMojiSpec = false,
  skipCommitConfirmation = false
}: GenerateCommitMessageFromGitDiffParams): Promise<void> => {
  await assertGitRepo();

  // Check cache before calling LLM
  const cached = getCachedCommitMessage(diff);
  if (cached) {
    const age = formatCacheAge(cached.timestamp);
    outro(
      `Cached commit message found (generated ${age}):\n${chalk.grey('——————————————————')}\n${cached.message}\n${chalk.grey('——————————————————')}`
    );

    const cacheAction = skipCommitConfirmation
      ? 'UseCached'
      : await select({
          message: 'Use cached message or regenerate?',
          options: [
            { value: 'UseCached', label: 'Use cached' },
            { value: 'Regenerate', label: 'Regenerate' }
          ]
        });

    if (!isCancel(cacheAction) && cacheAction === 'UseCached') {
      const committed = await performCommit(cached.message, extraArgs, skipCommitConfirmation);
      if (committed) await handleGitPush();
      return;
    }
  }

  const commitGenerationSpinner = spinner();
  commitGenerationSpinner.start('Generating the commit message');

  try {
    let commitMessage = await generateCommitMessageByDiff(
      diff,
      fullGitMojiSpec,
      context
    );

    const messageTemplate = checkMessageTemplate(extraArgs);
    if (
      config.OCO_MESSAGE_TEMPLATE_PLACEHOLDER &&
      typeof messageTemplate === 'string'
    ) {
      const messageTemplateIndex = extraArgs.indexOf(messageTemplate);
      extraArgs.splice(messageTemplateIndex, 1);
      commitMessage = messageTemplate.replace(
        config.OCO_MESSAGE_TEMPLATE_PLACEHOLDER,
        commitMessage
      );
    }

    commitGenerationSpinner.stop('📝 Commit message generated');

    setCachedCommitMessage(diff, commitMessage);

    const committed = await performCommit(commitMessage, extraArgs, skipCommitConfirmation);

    if (committed) {
      await handleGitPush();
    } else {
      const regenerateMessage = await confirm({
        message: 'Do you want to regenerate the message?'
      });

      if (isCancel(regenerateMessage)) process.exit(1);

      if (regenerateMessage) {
        await generateCommitMessageFromGitDiff({
          diff,
          extraArgs,
          context,
          fullGitMojiSpec,
          skipCommitConfirmation
        });
      }
    }
  } catch (error) {
    commitGenerationSpinner.stop(
      `${chalk.red('✖')} Failed to generate the commit message`
    );

    const errorConfig = getConfig();
    const provider = errorConfig.OCO_AI_PROVIDER || 'openai';
    const formatted = formatUserFriendlyError(error, provider);
    outro(printFormattedError(formatted));

    process.exit(1);
  }
};

/**
 * Handle per-file commit messages when diff routing splits files individually.
 */
async function generatePerFileCommits(
  stagedFiles: string[],
  fileGroups: FileGroupResult[],
  extraArgs: string[],
  context: string,
  fullGitMojiSpec: boolean,
  skipCommitConfirmation: boolean
): Promise<void> {
  const currentConfig = getConfig();
  const strategy = currentConfig.OCO_MULTI_COMMIT_STRATEGY || 'single';

  const genSpinner = spinner();

  const sigintHandler = () => {
    genSpinner.stop('Cancelled');
    process.exit(1);
  };
  process.once('SIGINT', sigintHandler);

  genSpinner.start(`Generating commit messages for ${fileGroups.length} file group(s)...`);

  let rawMessages: string[];
  try {
    rawMessages = [];
    for (const group of fileGroups) {
      const payload = group.docstringOverride ?? (await getDiffForFiles(group.files));
      const msg = await generateCommitMessageByDiff(payload, fullGitMojiSpec, context);
      rawMessages.push(msg);
    }
    genSpinner.stop(`📝 Generated ${rawMessages.length} commit message(s)`);
  } catch (error) {
    genSpinner.stop(`${chalk.red('✖')} Failed to generate commit messages`);
    throw error;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }

  // buildCommitPlan enforces the index-aligned file↔message contract
  const commitPlan = buildCommitPlan(fileGroups, rawMessages);

  if (strategy === 'single') {
    const combinedMessage = combineCommitMessages(commitPlan.map((c) => c.message));
    const fullDiff = await getDiffForFiles(stagedFiles);
    setCachedCommitMessage(fullDiff, combinedMessage);
    const committed = await performCommit(combinedMessage, extraArgs, skipCommitConfirmation);
    if (committed) await handleGitPush();
    return;
  }

  // Sequential strategy: unstage only plan files, then stage and commit per-group.
  // This ensures group[i].files are committed with group[i].message and unrelated staged files are not dropped.
  const groupedFiles = new Set(commitPlan.flatMap((c) => c.files));
  const omittedFiles = stagedFiles.filter((f) => !groupedFiles.has(f));
  if (omittedFiles.length > 0) {
    throw new Error(
      `Sequential strategy would omit staged files: ${omittedFiles.join(', ')}`
    );
  }
  await execa('git', ['reset', 'HEAD', '--']);

  let acceptAll = false;
  const accepted: string[] = [];

  for (let i = 0; i < commitPlan.length; i++) {
    const { files, message } = commitPlan[i];
    const label = `File group ${i + 1}/${commitPlan.length}: ${files.join(', ')}`;

    // Stage only this group's files before presenting/committing
    await execa('git', ['add', '--', ...files]);

    if (acceptAll) {
      const committingSpinner = spinner();
      committingSpinner.start(`Committing group ${i + 1}/${commitPlan.length}`);
      await execa('git', ['commit', '-m', message, ...extraArgs]);
      committingSpinner.stop(`${chalk.green('✔')} Committed group ${i + 1}`);
      accepted.push(message);
      continue;
    }

    outro(
      `${label}\n${chalk.grey('——————————————————')}\n${message}\n${chalk.grey('——————————————————')}`
    );

    const userAction = skipCommitConfirmation
      ? 'Accept'
      : await select({
          message: `Commit message ${i + 1}/${commitPlan.length}?`,
          options: [
            { value: 'Accept', label: 'Accept' },
            { value: 'Edit', label: 'Edit' },
            { value: 'Skip', label: 'Skip this message' },
            { value: 'AcceptAll', label: 'Accept all remaining' }
          ]
        });

    if (isCancel(userAction)) process.exit(1);

    if (userAction === 'AcceptAll') {
      acceptAll = true;
    }

    if (userAction === 'Skip') {
      // Unstage this group's files so they don't bleed into a later commit
      await execa('git', ['reset', 'HEAD', '--', ...files]);
      continue;
    }

    let finalMessage = message;
    if (userAction === 'Edit') {
      const textResponse = await text({
        message: 'Edit the commit message:',
        initialValue: message
      });
      finalMessage = textResponse.toString();
    }

    if (userAction === 'Accept' || userAction === 'Edit' || userAction === 'AcceptAll') {
      const committingSpinner = spinner();
      committingSpinner.start('Committing the changes');
      const { stdout } = await execa('git', ['commit', '-m', finalMessage, ...extraArgs]);
      committingSpinner.stop(`${chalk.green('✔')} Successfully committed`);
      outro(stdout);
      accepted.push(finalMessage);
    }
  }

  if (accepted.length > 0) {
    await handleGitPush();
  }
}

export async function commit(
  extraArgs: string[] = [],
  context: string = '',
  isStageAllFlag: Boolean = false,
  fullGitMojiSpec: boolean = false,
  skipCommitConfirmation: boolean = false
) {
  if (isStageAllFlag) {
    const changedFiles = await getChangedFiles();

    if (changedFiles) await gitAdd({ files: changedFiles });
    else {
      outro('No changes detected, write some code and run `ocox` again');
      process.exit(1);
    }
  }

  const [stagedFiles, errorStagedFiles] = await trytm(getStagedFiles());
  const [changedFiles, errorChangedFiles] = await trytm(getChangedFiles());

  if (!changedFiles?.length && !stagedFiles?.length) {
    outro(chalk.red('No changes detected'));
    process.exit(1);
  }

  intro('opencommitx');
  if (errorChangedFiles ?? errorStagedFiles) {
    outro(`${chalk.red('✖')} ${errorChangedFiles ?? errorStagedFiles}`);
    process.exit(1);
  }

  const stagedFilesSpinner = spinner();

  stagedFilesSpinner.start('Counting staged files');

  if (stagedFiles.length === 0) {
    stagedFilesSpinner.stop('No files are staged');

    const isStageAllAndCommitConfirmedByUser = await confirm({
      message: 'Do you want to stage all files and generate commit message?'
    });

    if (isCancel(isStageAllAndCommitConfirmedByUser)) process.exit(1);

    if (isStageAllAndCommitConfirmedByUser) {
      await commit(extraArgs, context, true, fullGitMojiSpec, skipCommitConfirmation);
      process.exit(0);
    }

    if (stagedFiles.length === 0 && changedFiles.length > 0) {
      const files = (await multiselect({
        message: chalk.cyan('Select the files you want to add to the commit:'),
        options: changedFiles.map((file) => ({
          value: file,
          label: file
        }))
      })) as string[];

      if (isCancel(files)) process.exit(0);

      await gitAdd({ files });
    }

    await commit(extraArgs, context, false, fullGitMojiSpec, skipCommitConfirmation);
    process.exit(0);
  }

  stagedFilesSpinner.stop(
    `${stagedFiles.length} staged files:\n${stagedFiles
      .map((file) => `  ${file}`)
      .join('\n')}`
  );

  // Check diff routing
  const currentConfig = getConfig();
  const perFileMode = currentConfig.OCO_PER_FILE_COMMIT_MODE || 'auto';

  let usePerFileMode = false;
  let fileGroups: FileGroupResult[] = [];

  if (perFileMode !== 'never') {
    try {
      const stats = await getStagedFilesStats();
      const routing = routeDiff(stats, currentConfig);
      usePerFileMode = routing.usePerFile;
      fileGroups = routing.fileGroups;
    } catch {
      // Fall back to aggregate mode on error
      usePerFileMode = false;
    }
  }

  if (usePerFileMode && fileGroups.length > 0) {
    const [, generateCommitError] = await trytm(
      generatePerFileCommits(
        stagedFiles,
        fileGroups,
        extraArgs,
        context,
        fullGitMojiSpec,
        skipCommitConfirmation
      )
    );

    if (generateCommitError) {
      outro(`${chalk.red('✖')} ${generateCommitError}`);
      process.exit(1);
    }
  } else {
    const diff = await getDiff({ files: stagedFiles });

    const [, generateCommitError] = await trytm(
      generateCommitMessageFromGitDiff({
        diff,
        extraArgs,
        context,
        fullGitMojiSpec,
        skipCommitConfirmation
      })
    );

    if (generateCommitError) {
      outro(`${chalk.red('✖')} ${generateCommitError}`);
      process.exit(1);
    }
  }

  process.exit(0);
}
