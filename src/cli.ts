#!/usr/bin/env node

// Raise the default limit before any @clack/prompts spinners or selects are
// created. Sequential multi-commit mode creates one spinner+select per group;
// without this guard Node emits MaxListenersExceededWarning at >10 groups.
process.stdin.setMaxListeners(process.stdin.getMaxListeners() + 20);

import { cli } from 'cleye';

import packageJSON from '../package.json';
import { commit } from './commands/commit';
import { commitlintConfigCommand } from './commands/commitlint';
import { configCommand } from './commands/config';
import { hookCommand, isHookCalled } from './commands/githook.js';
import { prepareCommitMessageHook } from './commands/prepare-commit-msg-hook';
import {
  setupCommand,
  isFirstRun,
  runSetup,
  promptForMissingApiKey
} from './commands/setup';
import { modelsCommand } from './commands/models';
import { benchmarkCommand } from './commands/benchmark';
import { checkIsLatestVersion } from './utils/checkIsLatestVersion';
import { runMigrations } from './migrations/_run.js';

const extraArgs = process.argv.slice(2);

cli(
  {
    version: packageJSON.version,
    name: 'opencommitx',
    commands: [configCommand, hookCommand, commitlintConfigCommand, setupCommand, modelsCommand, benchmarkCommand],
    flags: {
      fgm: {
        type: Boolean,
        description: 'Use full GitMoji specification',
        default: false
      },
      context: {
        type: String,
        alias: 'c',
        description: 'Additional user input context for the commit message',
        default: ''
      },
      yes: {
        type: Boolean,
        alias: 'y',
        description: 'Skip commit confirmation prompt',
        default: false
      },
      dryRun: {
        type: Boolean,
        alias: 'd',
        description: 'Dry run: generate and display commit message without committing',
        default: false
      }
    },
    ignoreArgv: (type) => type === 'unknown-flag' || type === 'argument',
    help: { description: packageJSON.description }
  },
  async ({ flags }) => {
    // Dry run: override provider to test mock for this invocation only
    if (flags.dryRun) {
      process.env.OCO_AI_PROVIDER = 'test';
      process.env.OCO_TEST_MOCK_TYPE = 'commit-message';
    }

    await runMigrations();
    await checkIsLatestVersion();

    if (await isHookCalled()) {
      prepareCommitMessageHook();
    } else {
      // Check for first run and trigger setup wizard
      if (!flags.dryRun && isFirstRun()) {
        const setupComplete = await runSetup();
        if (!setupComplete) {
          process.exit(1);
        }
      }

      // Check for missing API key and prompt if needed (skip for dry run)
      if (!flags.dryRun) {
        const hasApiKey = await promptForMissingApiKey();
        if (!hasApiKey) {
          process.exit(1);
        }
      }

      commit(extraArgs, flags.context, false, flags.fgm, flags.yes || flags.dryRun);
    }
  },
  extraArgs
);
