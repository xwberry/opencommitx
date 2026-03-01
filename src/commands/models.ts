import { intro, outro, spinner } from '@clack/prompts';
import chalk from 'chalk';
import { command } from 'cleye';
import { COMMANDS } from './ENUMS';
import {
  MODEL_LIST,
  OCO_AI_PROVIDER_ENUM,
  getConfig
} from './config';
import {
  fetchModelsForProvider,
  clearModelCache,
  getCacheInfo,
  getCachedModels
} from '../utils/modelCache';
import {
  addCustomModel,
  removeCustomModel,
  getCustomModels,
  getAllCustomModels
} from '../utils/customModels';

function formatCacheAge(timestamp: number | null): string {
  if (!timestamp) return 'never';
  const ageMs = Date.now() - timestamp;
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  const minutes = Math.floor(ageMs / (1000 * 60));

  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (minutes > 0) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return 'just now';
}

async function listModels(provider: string, useCache: boolean = true): Promise<void> {
  const config = getConfig();
  const apiKey = config.OCO_API_KEY;
  const currentModel = config.OCO_MODEL;

  let models: string[] = [];

  if (useCache) {
    const cached = getCachedModels(provider);
    if (cached) models = cached;
  }

  if (models.length === 0) {
    const providerKey = provider.toLowerCase() as keyof typeof MODEL_LIST;
    models = MODEL_LIST[providerKey] || [];
  }

  const customModels = getCustomModels(provider);

  console.log(`\n${chalk.bold('Available models for')} ${chalk.cyan(provider)}:\n`);

  if (customModels.length > 0) {
    console.log(chalk.dim('  Custom models (from ~/.opencommitx-custom-models.json):'));
    customModels.forEach((model) => {
      const isCurrent = model === currentModel;
      const prefix = isCurrent ? chalk.green('* ') : '  + ';
      const label = isCurrent ? chalk.green(model) : chalk.yellow(model);
      console.log(`${prefix}${label}`);
    });
    console.log('');
  }

  if (models.length === 0) {
    console.log(chalk.dim('  No built-in models found'));
  } else {
    console.log(chalk.dim('  Built-in models:'));
    models.forEach((model) => {
      const isCurrent = model === currentModel;
      const prefix = isCurrent ? chalk.green('* ') : '  ';
      const label = isCurrent ? chalk.green(model) : model;
      console.log(`${prefix}${label}`);
    });
  }

  console.log('');
}

async function refreshModels(provider: string): Promise<void> {
  const config = getConfig();
  const apiKey = config.OCO_API_KEY;

  const loadingSpinner = spinner();
  loadingSpinner.start(`Fetching models from ${provider}...`);

  clearModelCache();

  try {
    const models = await fetchModelsForProvider(provider, apiKey, undefined, true);
    loadingSpinner.stop(`${chalk.green('+')} Fetched ${models.length} models`);
    await listModels(provider, true);
  } catch (error) {
    loadingSpinner.stop(chalk.red('Failed to fetch models'));
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}

export const modelsCommand = command(
  {
    name: COMMANDS.models,
    parameters: ['[action]', '[provider]', '[model]'],
    help: {
      description: 'List and manage models for your AI provider',
      examples: [
        'List models for current provider: ocox models',
        'List models for a specific provider: ocox models list openrouter',
        'Refresh model list from API: ocox models --refresh',
        'Add a custom model: ocox models add openrouter google/gemma-3-27b-it:free',
        'Remove a custom model: ocox models remove openrouter google/gemma-3-27b-it:free'
      ]
    },
    flags: {
      refresh: {
        type: Boolean,
        alias: 'r',
        description: 'Clear cache and re-fetch models from the provider',
        default: false
      },
      provider: {
        type: String,
        alias: 'p',
        description: 'Specify provider (defaults to current OCO_AI_PROVIDER)'
      }
    }
  },
  async ({ flags, _ }) => {
    const config = getConfig();
    const action = _.action;

    intro(chalk.bgCyan(' OpenCommitX Models '));

    if (action === 'add') {
      const provider = _.provider;
      const model = _.model;

      if (!provider || !model) {
        console.log(chalk.red('Usage: ocox models add <provider> <model-name>'));
        console.log(chalk.dim('Example: ocox models add openrouter google/gemma-3-27b-it:free'));
        process.exit(1);
      }

      addCustomModel(provider, model);
      outro(`${chalk.green('✔')} Added model ${chalk.cyan(model)} for provider ${chalk.cyan(provider)}`);
      return;
    }

    if (action === 'remove') {
      const provider = _.provider;
      const model = _.model;

      if (!provider || !model) {
        console.log(chalk.red('Usage: ocox models remove <provider> <model-name>'));
        process.exit(1);
      }

      const removed = removeCustomModel(provider, model);
      if (removed) {
        outro(`${chalk.green('✔')} Removed model ${chalk.cyan(model)} for provider ${chalk.cyan(provider)}`);
      } else {
        outro(chalk.yellow(`Model ${model} not found in custom models for ${provider}`));
      }
      return;
    }

    // list / default
    const provider = (action === 'list' ? _.provider : action)
      || flags.provider
      || config.OCO_AI_PROVIDER
      || OCO_AI_PROVIDER_ENUM.OPENAI;

    const cacheInfo = getCacheInfo();
    if (cacheInfo.timestamp) {
      console.log(chalk.dim(`  Cache last updated: ${formatCacheAge(cacheInfo.timestamp)}`));
      if (cacheInfo.providers.length > 0) {
        console.log(chalk.dim(`  Cached providers: ${cacheInfo.providers.join(', ')}`));
      }
    } else {
      console.log(chalk.dim('  No cached models'));
    }

    const customAll = getAllCustomModels();
    const customProviders = Object.keys(customAll);
    if (customProviders.length > 0) {
      console.log(chalk.dim(`  Custom model providers: ${customProviders.join(', ')}`));
    }

    if (flags.refresh) {
      await refreshModels(provider);
    } else {
      await listModels(provider);
    }

    outro(
      `Run ${chalk.cyan('ocox models --refresh')} to update the model list\n` +
      `Add custom models: ${chalk.cyan('ocox models add <provider> <model>')}`
    );
  }
);
