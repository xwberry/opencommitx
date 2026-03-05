import {
  text,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  spinner
} from '@clack/prompts';
import chalk from 'chalk';
import { execa } from 'execa';
import { generateCommitMessageByDiff, consumeLastUsedModel } from '../generateCommitMessageFromGitDiff';
import {
  buildCommitPlan,
  combineCommitMessages
} from '../utils/commitStrategy';
import {
  formatUserFriendlyError,
  printFormattedError
} from '../utils/errors';
import { existsSync } from 'fs';
import { join as pathJoin } from 'path';
import {
  assertGitRepo,
  getChangedFiles,
  getDiff,
  getDiffForFiles,
  getGitDir,
  getStagedFiles,
  getStagedFilesStats,
  getStagedFilesStatus,
  gitAdd
} from '../utils/git';
import { shouldUseDocstringMode } from '../utils/pythonDocstringExtractor';
import {
  archiveCacheEntry,
  formatCacheAge,
  getCachedCommitMessage,
  pruneArchivedCache,
  setCachedCommitMessage
} from '../utils/commitCache';
import { routeDiff, FileGroupResult } from '../utils/diffRouter';
import { trytm } from '../utils/trytm';
import { getConfig } from './config';

const config = getConfig();

/**
 * Shorten a file list to fit within the visible terminal width.
 * When the full list would exceed the budget, trailing files are replaced
 * by "+N more" so the spinner message never wraps (clack bug #132).
 */
function truncateFileList(files: string[], prefix: string): string {
  const cols = process.stdout.columns ?? 80;
  const budget = Math.max(20, cols - prefix.length - 1);
  let result = '';
  let shown = 0;

  for (const file of files) {
    const sep = shown > 0 ? ', ' : '';
    const remaining = files.length - shown - 1;
    const suffix = remaining > 0 ? ` +${remaining} more` : '';
    const candidate = result + sep + file;

    if (candidate.length + suffix.length > budget && shown > 0) {
      result += ` +${files.length - shown} more`;
      break;
    }

    result = candidate;
    shown++;
  }

  return result;
}

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

type RegenerateFn = (opts: { detail?: string; feedback?: string }) => Promise<string>;

async function performCommit(
  commitMessage: string,
  extraArgs: string[],
  skipCommitConfirmation: boolean = false,
  label: string = '',
  regenerateFn?: RegenerateFn
): Promise<boolean> {
  let currentMessage = commitMessage;

  // Regeneration loop — repeat until the user accepts, edits, or cancels.
  while (true) {
    const displayLabel = label ? `${label}\n` : '';

    outro(
      `${displayLabel}Generated commit message:\n${chalk.grey('——————————————————')}\n${currentMessage}\n${chalk.grey('——————————————————')}`
    );

    const baseOptions: Array<{ value: string; label: string }> = [
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
      { value: 'Edit', label: 'Edit' }
    ];

    if (regenerateFn) {
      baseOptions.push({ value: 'Regenerate', label: 'Regenerate' });
    }

    const userAction = skipCommitConfirmation
      ? 'Yes'
      : await select({ message: 'Confirm the commit message?', options: baseOptions });

    if (isCancel(userAction)) process.exit(1);

    if (userAction === 'Regenerate' && regenerateFn) {
      const detailAction = await select({
        message: 'Regeneration options:',
        options: [
          { value: 'normal', label: 'Default (same settings)' },
          { value: 'concise', label: 'More concise' },
          { value: 'detailed', label: 'More detailed' },
          { value: 'feedback', label: 'Provide custom feedback' }
        ]
      });

      if (isCancel(detailAction)) process.exit(1);

      let feedback: string | undefined;
      if (detailAction === 'feedback') {
        const feedbackResponse = await text({
          message: 'Enter feedback for the model:',
          placeholder: 'e.g. Focus on the performance improvement aspect'
        });
        if (isCancel(feedbackResponse)) process.exit(1);
        feedback = String(feedbackResponse);
      }

      const regenSpinner = spinner();
      regenSpinner.start('Regenerating commit message...');
      try {
        currentMessage = await regenerateFn({
          detail: detailAction !== 'feedback' ? String(detailAction) : 'normal',
          feedback
        });
        regenSpinner.stop('📝 Regenerated commit message');
      } catch (err: unknown) {
        regenSpinner.stop(`${chalk.red('✖')} Regeneration failed`);
        outro(chalk.red(`✖ ${String(err)}`));
        return false;
      }
      continue;
    }

    if (userAction === 'No') return false;

    let finalMessage = currentMessage;

    if (userAction === 'Edit') {
      const textResponse = await text({
        message: 'Please edit the commit message: (press Enter to continue)',
        initialValue: currentMessage
      });
      if (isCancel(textResponse)) process.exit(1);
      finalMessage = textResponse.toString();
    }

    // Commit the change (Yes or Edit path).
    const committingChangesSpinner = spinner();

    // Show a pre-commit hint if hooks are configured, so the user knows
    // why the spinner may run for a while.
    try {
      const gitDir = await getGitDir();
      if (existsSync(pathJoin(gitDir, '.pre-commit-config.yaml'))) {
        note('Pre-commit hooks are configured and will run now.');
      }
    } catch { /* non-fatal */ }

    committingChangesSpinner.start('Committing...');

    try {
      const proc = execa('git', ['commit', '-m', finalMessage, ...extraArgs], {
        reject: false
      });

      if (proc.stderr) {
        proc.stderr.setEncoding('utf-8');
        proc.stderr.on('data', (chunk: string) => {
          const lastLine = chunk.split('\n').filter((l) => l.trim()).pop() ?? '';
          if (lastLine) {
            committingChangesSpinner.message(
              `Committing... ${chalk.dim(lastLine.slice(0, 60))}`
            );
          }
        });
      }

      const result = await proc;

      if (result.exitCode === 0) {
        committingChangesSpinner.stop(`${chalk.green('✔')} Successfully committed`);
        if (result.stdout) outro(result.stdout);
        return true;
      }

      committingChangesSpinner.stop(`${chalk.red('✖')} Commit failed`);

      const hookOutput = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      if (hookOutput) process.stderr.write(hookOutput + '\n');

      const isHookFailure =
        hookOutput.includes('hook id:') ||
        hookOutput.includes('[WARNING] Unstaged files detected') ||
        hookOutput.includes('pre-commit');

      if (isHookFailure) {
        outro(
          chalk.yellow(
            '⚠  Pre-commit hooks made changes or failed.\n' +
              '   Re-stage any reformatted files (e.g. git add -u) and run ocox again.'
          )
        );
      } else {
        outro(chalk.red(`✖ git commit failed (exit ${result.exitCode ?? 1})`));
      }

      return false;
    } catch (unexpectedErr: unknown) {
      committingChangesSpinner.stop(`${chalk.red('✖')} Commit failed`);
      outro(chalk.red(`✖ Unexpected error: ${String(unexpectedErr)}`));
      return false;
    }
  }
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
    const currentModel = getConfig().OCO_MODEL ?? '';
    const cachedModel = cached.model ?? '';
    const modelMismatch = cachedModel && currentModel && cachedModel !== currentModel;

    outro(
      `Cached commit message found (generated ${age}):\n${chalk.grey('——————————————————')}\n${cached.message}\n${chalk.grey('——————————————————')}`
    );

    if (modelMismatch) {
      note(
        `Cache was generated by ${chalk.cyan(cachedModel)}; current model is ${chalk.cyan(currentModel)}.`,
        chalk.yellow('⚠  Model mismatch')
      );
    }

    const cacheAction = skipCommitConfirmation
      ? 'UseCached'
      : await select({
          message: 'Use cached message or regenerate?',
          options: [
            { value: 'UseCached', label: 'Use cached' },
            { value: 'Regenerate', label: `Regenerate${modelMismatch ? ` with ${currentModel}` : ''}` }
          ]
        });

    if (!isCancel(cacheAction) && cacheAction === 'UseCached') {
      const committed = await performCommit(cached.message, extraArgs, skipCommitConfirmation);
      if (committed) {
        archiveCacheEntry(diff);
        await handleGitPush();
      }
      return;
    }
  }

  const genConfig = getConfig();
  const genModelName = (genConfig.OCO_MODEL ?? '').toLowerCase();
  const isThinkingModelAggregate =
    genModelName.includes('thinking') ||
    genModelName.includes(':thinking') ||
    genModelName.includes('-think') ||
    genModelName.startsWith('o1') ||
    genModelName.startsWith('o3') ||
    /\/o[1-9]/.test(genModelName);
  if (isThinkingModelAggregate) {
    note(
      `Model "${genConfig.OCO_MODEL}" uses reasoning/thinking tokens.\n` +
        `  Generation may take longer than usual.\n` +
        `  If it times out, try: ocox config set OCO_TOKENS_MAX_OUTPUT 2000`,
      chalk.yellow('⚠  Reasoning model detected')
    );
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

    setCachedCommitMessage(diff, commitMessage, undefined, consumeLastUsedModel() ?? undefined);

    const regenFn: RegenerateFn = async ({ detail, feedback }) => {
      const detailInstruction =
        detail === 'concise'
          ? 'Be very concise — one line, no description.'
          : detail === 'detailed'
            ? 'Be detailed — include what changed and why in the description.'
            : '';
      const regenContext = [
        detailInstruction,
        feedback ? `User feedback: ${feedback}` : '',
        context
      ].filter(Boolean).join('\n');
      const newMsg = await generateCommitMessageByDiff(diff, fullGitMojiSpec, regenContext);
      setCachedCommitMessage(diff, newMsg);
      return newMsg;
    };

    const committed = await performCommit(
      commitMessage,
      extraArgs,
      skipCommitConfirmation,
      '',
      regenFn
    );

    if (committed) {
      archiveCacheEntry(diff);
      await handleGitPush();
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

  // Warn upfront if the model is a reasoning/thinking model (slower execution).
  const modelName = (currentConfig.OCO_MODEL ?? '').toLowerCase();
  const isThinkingModel =
    modelName.includes('thinking') ||
    modelName.includes(':thinking') ||
    modelName.includes('-think') ||
    modelName.startsWith('o1') ||
    modelName.startsWith('o3') ||
    /\/o[1-9]/.test(modelName);
  if (isThinkingModel) {
    note(
      `Model "${currentConfig.OCO_MODEL}" uses reasoning/thinking tokens.\n` +
        `  Generation may take longer than usual.\n` +
        `  If it times out, try: ocox config set OCO_TOKENS_MAX_OUTPUT 2000`,
      chalk.yellow('⚠  Reasoning model detected')
    );
  }

  const genSpinner = spinner();
  // Per-group generation timeout. Defaults to 90s; configurable via
  // OCO_GENERATION_TIMEOUT_SECONDS for slow models or slow networks.
  const GROUP_TIMEOUT_MS = (currentConfig.OCO_GENERATION_TIMEOUT_SECONDS ?? 90) * 1000;

  const stopAndExit = (label: string) => {
    genSpinner.stop(label);
    process.exit(1);
  };

  const sigintHandler = () => stopAndExit('Cancelled');
  // SIGBREAK fires for Ctrl+Break on Windows; add it as an alias for Ctrl+C
  // in environments (e.g. PowerShell pixi shell) that intercept SIGINT.
  const sigbreakHandler = () => stopAndExit('Cancelled');
  process.once('SIGINT', sigintHandler);
  if (process.platform === 'win32') {
    process.once('SIGBREAK', sigbreakHandler);
  }

  genSpinner.start(`Generating commit messages for ${fileGroups.length} file group(s)...`);

  let rawMessages: string[];
  // Store the payload (diff text) per group so we can archive cache entries
  // after each group commits successfully.
  const groupPayloads: string[] = [];
  try {
    rawMessages = [];
    for (const group of fileGroups) {
      if (group.docstringOverride) {
        const prefix = 'Generating (docstring mode): ';
        genSpinner.message(prefix + truncateFileList(group.files, prefix));
      } else {
        const prefix = 'Generating: ';
        genSpinner.message(prefix + truncateFileList(group.files, prefix));
      }
      const payload = group.docstringOverride ?? (await getDiffForFiles(group.files));
      groupPayloads.push(payload);

      // Check cache before calling the LLM — skip API call on hit.
      const cached = getCachedCommitMessage(payload);
      if (cached) {
        const age = formatCacheAge(cached.timestamp);
        const cachedModel = cached.model ?? '';
        const currentModel = currentConfig.OCO_MODEL ?? '';
        const modelMismatch = cachedModel && currentModel && cachedModel !== currentModel;
        genSpinner.message(
          `Cache hit (${age})${modelMismatch ? chalk.yellow(` — cached from ${cachedModel}`) : ''}: ${truncateFileList(group.files, 'Cache hit: ')}`
        );
        if (modelMismatch) {
          genSpinner.stop(chalk.yellow(`⚠  Cache hit from different model (${cachedModel})`));
          const reuseAction = await select({
            message: `Cached message was generated by ${cachedModel}; current model is ${currentModel}. Use cached?`,
            options: [
              { value: 'use', label: 'Use cached message' },
              { value: 'regenerate', label: `Regenerate with ${currentModel}` }
            ]
          });
          if (isCancel(reuseAction) || reuseAction === 'use') {
            rawMessages.push(cached.message);
            if (fileGroups.indexOf(group) < fileGroups.length - 1) {
              genSpinner.start(`Generating commit messages for ${fileGroups.length} file group(s)...`);
            }
            continue;
          }
          genSpinner.start(`Generating commit messages for ${fileGroups.length} file group(s)...`);
        } else {
          rawMessages.push(cached.message);
          continue;
        }
      }

      // Race the LLM call against a hard timeout so a stalled model/network
      // does not hold the process open indefinitely.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Generation timed out after ${GROUP_TIMEOUT_MS / 1000}s for: ${group.files.join(', ')}\n` +
                  `  The model or network may be unresponsive. Try a different model.`
              )
            ),
          GROUP_TIMEOUT_MS
        )
      );

      const msg = await Promise.race([
        generateCommitMessageByDiff(payload, fullGitMojiSpec, context),
        timeoutPromise
      ]);

      // Cache each group message immediately so a pre-commit failure on a later
      // group doesn't lose already-generated messages. Pass the actual model
      // used (may be the fallback model if the primary failed).
      setCachedCommitMessage(payload, msg, group.files, consumeLastUsedModel() ?? undefined);
      rawMessages.push(msg);
    }
    genSpinner.stop(`📝 Generated ${rawMessages.length} commit message(s)`);
  } catch (error) {
    genSpinner.stop(`${chalk.red('✖')} Failed to generate commit messages`);
    throw error;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    if (process.platform === 'win32') {
      process.removeListener('SIGBREAK', sigbreakHandler);
    }
  }

  // buildCommitPlan enforces the index-aligned file↔message contract
  const commitPlan = buildCommitPlan(fileGroups, rawMessages);

  if (strategy === 'single') {
    const combinedMessage = combineCommitMessages(commitPlan.map((c) => c.message));
    const fullDiff = await getDiffForFiles(stagedFiles);
    setCachedCommitMessage(fullDiff, combinedMessage, stagedFiles);
    const committed = await performCommit(combinedMessage, extraArgs, skipCommitConfirmation);
    if (committed) {
      // Archive all per-group cache entries now that the commit succeeded.
      for (const payload of groupPayloads) archiveCacheEntry(payload);
      archiveCacheEntry(fullDiff);
      await handleGitPush();
    }
    return;
  }

  // Sequential strategy: unstage only plan files, then stage and commit per-group.
  // This ensures group[i].files are committed with group[i].message and unrelated staged files are not dropped.
  const groupedFiles = new Set(commitPlan.flatMap((c) => c.files));
  const omittedFiles = stagedFiles.filter((f) => !groupedFiles.has(f));
  if (omittedFiles.length > 0) {
    // Files excluded from `git diff` (e.g. pixi.lock, package-lock.json via
    // .gitattributes) never appear in fileGroups but are still staged.
    // Append them to the last commit group so they are not silently dropped.
    note(
      `The following staged files are excluded from diff and cannot be individually analysed.\n` +
        `They will be committed with the last group:\n` +
        omittedFiles.map((f) => `  ${f}`).join('\n')
    );
    commitPlan[commitPlan.length - 1].files.push(...omittedFiles);
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
      try {
        await execa('git', ['commit', '-m', message, ...extraArgs]);
        committingSpinner.stop(`${chalk.green('✔')} Committed group ${i + 1}`);
        if (groupPayloads[i]) archiveCacheEntry(groupPayloads[i]);
      } catch (err: unknown) {
        committingSpinner.stop(`${chalk.red('✖')} Failed to commit group ${i + 1}`);
        throw err;
      }
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
      if (isCancel(textResponse)) process.exit(1);
      finalMessage = textResponse.toString();
    }

    if (userAction === 'Accept' || userAction === 'Edit' || userAction === 'AcceptAll') {
      const committingSpinner = spinner();
      committingSpinner.start('Committing the changes');
      try {
        const { stdout } = await execa('git', ['commit', '-m', finalMessage, ...extraArgs]);
        committingSpinner.stop(`${chalk.green('✔')} Successfully committed`);
        outro(stdout);
        if (groupPayloads[i]) archiveCacheEntry(groupPayloads[i]);
        accepted.push(finalMessage);
      } catch (err: unknown) {
        committingSpinner.stop(`${chalk.red('✖')} Commit failed`);
        throw err;
      }
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
  // Opportunistically clean up stale archived cache entries.
  const retentionDays = getConfig().OCO_CACHE_TTL_SECONDS
    ? Math.ceil((getConfig().OCO_CACHE_TTL_SECONDS ?? 3600) / 86400)
    : 7;
  pruneArchivedCache(retentionDays);

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

  // Warn about partially staged files (staged AND modified in working tree).
  // These files will differ between what was reviewed and what gets committed
  // if a pre-commit hook (e.g. ruff-format) reformats them.
  const partiallyStaged = stagedFiles.filter((f) => changedFiles?.includes(f));
  if (partiallyStaged.length > 0) {
    note(
      partiallyStaged.join('\n'),
      chalk.yellow('⚠  These files have both staged and unstaged changes — a pre-commit formatter may alter them')
    );
  }

  // Check diff routing
  const currentConfig = getConfig();
  const perFileMode = currentConfig.OCO_PER_FILE_COMMIT_MODE || 'auto';

  let usePerFileMode = false;
  let fileGroups: FileGroupResult[] = [];

  // Always fetch stats so we can render the upfront table.
  let stats = await getStagedFilesStats().catch(() => []);

  if (perFileMode !== 'never') {
    try {
      const routing = routeDiff(stats, currentConfig);
      usePerFileMode = routing.usePerFile;
      fileGroups = routing.fileGroups;
    } catch {
      // Fall back to aggregate mode on error
      usePerFileMode = false;
    }
  }

  // Render an upfront summary table so the user can review groupings before
  // waiting for LLM generation.
  try {
    const statusEntries = await getStagedFilesStatus();
    const statusMap = new Map<string, string>(statusEntries.map((e) => [e.file, e.status] as [string, string]));
    const statsMap = new Map<string, typeof stats[number]>(stats.map((s) => [s.file, s] as [string, typeof stats[number]]));

    // Build file → group# lookup (1-indexed for display).
    const groupIndexMap = new Map<string, number>();
    if (usePerFileMode && fileGroups.length > 0) {
      fileGroups.forEach((g, i) => g.files.forEach((f) => groupIndexMap.set(f, i + 1)));
    } else {
      stagedFiles.forEach((f) => groupIndexMap.set(f, 1));
    }

    // Build file → docstring mode lookup using the detection function directly
    // so the DS column shows "Y" whenever a file would trigger docstring mode,
    // regardless of whether extraction actually found anything.
    const docstringFiles = new Set<string>();
    for (const [f, s] of statsMap) {
      if (shouldUseDocstringMode(f, s.added)) {
        docstringFiles.add(f);
      }
    }

    const colWidths = { file: 40, lines: 10, status: 4, ds: 3, grp: 4 };
    const pad = (s: string, n: number) => s.slice(0, n).padEnd(n);

    const header =
      `${pad('File', colWidths.file)}  ${pad('+/-', colWidths.lines)}  New  DS  Grp`;
    const divider = '─'.repeat(header.length);

    const rows = stagedFiles.map((f) => {
      const s = statsMap.get(f);
      const lineInfo = s ? `+${s.added}/-${s.deleted}` : '(binary)';
      const isNew = (statusMap.get(f) ?? 'M') === 'A' ? 'Y' : ' ';
      const isDs = docstringFiles.has(f) ? 'Y' : ' ';
      const grp = String(groupIndexMap.get(f) ?? 1);
      return `${pad(f, colWidths.file)}  ${pad(lineInfo, colWidths.lines)}   ${isNew}   ${isDs}   ${grp}`;
    });

    note(`${header}\n${divider}\n${rows.join('\n')}`, 'Staged files');
  } catch {
    // Non-fatal: skip table on any error
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
