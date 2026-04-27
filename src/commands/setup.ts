import {
  intro,
  note,
  outro,
  select,
  text,
  isCancel,
  spinner
} from '@clack/prompts';
import chalk from 'chalk';
import { command } from 'cleye';
import { COMMANDS } from './ENUMS';
import {
  CONFIG_KEYS,
  MODEL_LIST,
  OCO_AI_PROVIDER_ENUM,
  getConfig,
  setGlobalConfig,
  getGlobalConfig,
  getIsGlobalConfigFileExist,
  DEFAULT_CONFIG,
  PROVIDER_API_KEY_URLS,
  RECOMMENDED_MODELS
} from './config';
import {
  fetchModelsForProvider,
  fetchOllamaModels,
  getCacheInfo
} from '../utils/modelCache';
import { getProviderApiKey } from '../utils/engine';

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  [OCO_AI_PROVIDER_ENUM.OPENAI]: 'OpenAI (GPT-4o, GPT-4)',
  [OCO_AI_PROVIDER_ENUM.ANTHROPIC]: 'Anthropic (Claude Sonnet, Opus)',
  [OCO_AI_PROVIDER_ENUM.OLLAMA]: 'Ollama (Free, runs locally)',
  [OCO_AI_PROVIDER_ENUM.GEMINI]: 'Google Gemini',
  [OCO_AI_PROVIDER_ENUM.GROQ]: 'Groq (Fast inference, free tier)',
  [OCO_AI_PROVIDER_ENUM.MISTRAL]: 'Mistral AI',
  [OCO_AI_PROVIDER_ENUM.DEEPSEEK]: 'DeepSeek',
  [OCO_AI_PROVIDER_ENUM.OPENROUTER]: 'OpenRouter (Multiple providers)',
  [OCO_AI_PROVIDER_ENUM.AIMLAPI]: 'AI/ML API',
  [OCO_AI_PROVIDER_ENUM.AZURE]: 'Azure OpenAI',
  [OCO_AI_PROVIDER_ENUM.MLX]: 'MLX (Apple Silicon, local)'
};

const PRIMARY_PROVIDERS = [
  OCO_AI_PROVIDER_ENUM.OPENAI,
  OCO_AI_PROVIDER_ENUM.ANTHROPIC,
  OCO_AI_PROVIDER_ENUM.OLLAMA
];

const OTHER_PROVIDERS = [
  OCO_AI_PROVIDER_ENUM.GEMINI,
  OCO_AI_PROVIDER_ENUM.GROQ,
  OCO_AI_PROVIDER_ENUM.MISTRAL,
  OCO_AI_PROVIDER_ENUM.DEEPSEEK,
  OCO_AI_PROVIDER_ENUM.OPENROUTER,
  OCO_AI_PROVIDER_ENUM.AIMLAPI,
  OCO_AI_PROVIDER_ENUM.AZURE,
  OCO_AI_PROVIDER_ENUM.MLX
];

const NO_API_KEY_PROVIDERS = [
  OCO_AI_PROVIDER_ENUM.OLLAMA,
  OCO_AI_PROVIDER_ENUM.MLX
];

async function selectProvider(
  currentProvider?: string
): Promise<string | symbol> {
  const makeLabel = (provider: string) =>
    provider === currentProvider
      ? `${PROVIDER_DISPLAY_NAMES[provider] || provider} ${chalk.dim('(current)')}`
      : PROVIDER_DISPLAY_NAMES[provider] || provider;

  const otherIsCurrent =
    currentProvider &&
    !PRIMARY_PROVIDERS.includes(currentProvider as OCO_AI_PROVIDER_ENUM);

  // If the current provider is in PRIMARY_PROVIDERS, move it to the top of the
  // list so that @clack/prompts highlights it by default (first = highlighted).
  let orderedPrimary = [...PRIMARY_PROVIDERS];
  if (
    currentProvider &&
    PRIMARY_PROVIDERS.includes(currentProvider as OCO_AI_PROVIDER_ENUM)
  ) {
    orderedPrimary = [
      currentProvider as OCO_AI_PROVIDER_ENUM,
      ...orderedPrimary.filter((p) => p !== currentProvider)
    ];
  }

  const primaryOptions: { value: string; label: string }[] = orderedPrimary.map(
    (provider) => ({
      value: provider,
      label: makeLabel(provider)
    })
  );

  primaryOptions.push({
    value: 'other',
    label: otherIsCurrent
      ? `Other providers... ${chalk.dim(`(current: ${currentProvider})`)}`
      : 'Other providers...'
  });

  const selection = await select({
    message: 'Select your AI provider:',
    options: primaryOptions
  });

  if (isCancel(selection)) return selection;

  if (selection === 'other') {
    let orderedOther = [...OTHER_PROVIDERS];
    if (otherIsCurrent && currentProvider) {
      orderedOther = [
        currentProvider as OCO_AI_PROVIDER_ENUM,
        ...orderedOther.filter((p) => p !== currentProvider)
      ];
    }
    const otherOptions = orderedOther.map((provider) => ({
      value: provider,
      label: makeLabel(provider)
    }));

    return await select({
      message: 'Select provider:',
      options: otherOptions
    });
  }

  return selection;
}

async function getApiKey(
  provider: string,
  currentKey?: string
): Promise<string | symbol> {
  const url =
    PROVIDER_API_KEY_URLS[provider as keyof typeof PROVIDER_API_KEY_URLS];

  let message = `Enter your ${provider} API key:`;
  if (url) {
    message = `Enter your API key:\n${chalk.dim(`  Get your key at: ${url}`)}`;
  }

  // If a key is already set, let the user keep it by pressing Enter.
  if (currentKey) {
    const maskedKey = currentKey.slice(0, 4) + '****' + currentKey.slice(-4);
    const keepOrUpdate = await select({
      message: `API key for ${provider}:`,
      options: [
        {
          value: 'keep',
          label: `Keep current key ${chalk.dim(`(${maskedKey})`)}`
        },
        { value: 'update', label: 'Enter a new key' }
      ]
    });

    if (isCancel(keepOrUpdate)) return keepOrUpdate;
    if (keepOrUpdate === 'keep') return currentKey;
  }

  const keyResponse = await text({
    message,
    placeholder: 'sk-...',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API key is required';
      }
      return undefined;
    }
  });

  // Warn once that API keys are stored in plain text.
  if (!isCancel(keyResponse) && keyResponse) {
    note(
      `Your API key will be stored in plain text in ~/.opencommitx-data/config.ini.\n` +
        `  Keep this file private and never commit it to source control.`,
      chalk.yellow('⚠  Security notice')
    );
  }

  return keyResponse;
}

function formatCacheAge(timestamp: number | null): string {
  if (!timestamp) return '';
  const ageMs = Date.now() - timestamp;
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(ageMs / (1000 * 60 * 60));

  if (days > 0) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

async function selectModel(
  provider: string,
  apiKey?: string
): Promise<string | symbol> {
  const providerDisplayName =
    PROVIDER_DISPLAY_NAMES[provider]?.split(' (')[0] || provider;
  const loadingSpinner = spinner();
  loadingSpinner.start(`Fetching models from ${providerDisplayName}...`);

  let models: string[] = [];
  let usedFallback = false;

  try {
    models = await fetchModelsForProvider(provider, apiKey);
  } catch {
    // Fall back to hardcoded list
    usedFallback = true;
    const providerKey = provider.toLowerCase() as keyof typeof MODEL_LIST;
    models = MODEL_LIST[providerKey] || [];
  }

  // Check cache info for display
  const cacheInfo = getCacheInfo();
  const cacheAge = formatCacheAge(cacheInfo.timestamp);

  if (usedFallback) {
    loadingSpinner.stop(
      chalk.yellow('Could not fetch models from API. Using default list.')
    );
  } else if (cacheAge) {
    loadingSpinner.stop(`Models loaded ${chalk.dim(`(cached ${cacheAge})`)}`);
  } else {
    loadingSpinner.stop('Models loaded');
  }

  if (models.length === 0) {
    // For Ollama/MLX, prompt for manual entry
    if (NO_API_KEY_PROVIDERS.includes(provider as OCO_AI_PROVIDER_ENUM)) {
      return await text({
        message: 'Enter model name (e.g., llama3:8b, mistral):',
        placeholder: 'llama3:8b',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Model name is required';
          }
          return undefined;
        }
      });
    }

    // Use default from config
    const providerKey = provider.toLowerCase() as keyof typeof MODEL_LIST;
    return MODEL_LIST[providerKey]?.[0] || 'gpt-4o-mini';
  }

  // Get recommended model for this provider
  const recommended =
    RECOMMENDED_MODELS[provider as keyof typeof RECOMMENDED_MODELS];

  // Build options with recommended first
  const options: Array<{ value: string; label: string }> = [];

  if (recommended && models.includes(recommended)) {
    options.push({
      value: recommended,
      label: `${recommended} (Recommended)`
    });
  }

  // Add other models (first 10, excluding recommended)
  const otherModels = models.filter((m) => m !== recommended).slice(0, 10);

  otherModels.forEach((model) => {
    options.push({ value: model, label: model });
  });

  // Add option to see all or enter custom
  if (models.length > 11) {
    options.push({ value: '__show_all__', label: 'Show all models...' });
  }
  options.push({ value: '__custom__', label: 'Enter custom model...' });

  const selection = await select({
    message: 'Select a model:',
    options
  });

  if (isCancel(selection)) return selection;

  if (selection === '__show_all__') {
    const allOptions = models.map((model) => ({
      value: model,
      label: model === recommended ? `${model} (Recommended)` : model
    }));

    return await select({
      message: 'Select a model:',
      options: allOptions
    });
  }

  if (selection === '__custom__') {
    return await text({
      message: 'Enter model name:',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Model name is required';
        }
        return undefined;
      }
    });
  }

  return selection;
}

async function setupOllama(): Promise<{
  provider: string;
  model: string;
  apiUrl: string;
} | null> {
  console.log(chalk.cyan('\n  Ollama - Free Local AI\n'));
  console.log(chalk.dim('  Setup steps:'));
  console.log(chalk.dim('  1. Install: https://ollama.ai/download'));
  console.log(chalk.dim('  2. Pull a model: ollama pull llama3:8b'));
  console.log(chalk.dim('  3. Start server: ollama serve\n'));

  // Try to fetch available models
  const loadingSpinner = spinner();
  loadingSpinner.start('Checking for local Ollama installation...');

  const defaultUrl = 'http://localhost:11434';
  let ollamaModels: string[] = [];

  try {
    ollamaModels = await fetchOllamaModels(defaultUrl);
    if (ollamaModels.length > 0) {
      loadingSpinner.stop(
        `${chalk.green('✔')} Found ${ollamaModels.length} local model(s)`
      );
    } else {
      loadingSpinner.stop(
        chalk.yellow(
          'Ollama is running but no models found. Pull a model first: ollama pull llama3:8b'
        )
      );
    }
  } catch {
    loadingSpinner.stop(
      chalk.yellow(
        'Could not connect to Ollama. Make sure it is running: ollama serve'
      )
    );
  }

  // Model selection
  let model: string | symbol;
  if (ollamaModels.length > 0) {
    model = await select({
      message: 'Select a model:',
      options: [
        ...ollamaModels.map((m) => ({ value: m, label: m })),
        { value: '__custom__', label: 'Enter custom model name...' }
      ]
    });

    if (isCancel(model)) return null;

    if (model === '__custom__') {
      model = await text({
        message: 'Enter model name (e.g., llama3:8b, mistral):',
        placeholder: 'llama3:8b'
      });
    }
  } else {
    model = await text({
      message: 'Enter model name (e.g., llama3:8b, mistral):',
      placeholder: 'llama3:8b',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Model name is required';
        }
        return undefined;
      }
    });
  }

  if (isCancel(model)) return null;

  // API URL (optional)
  const apiUrl = await text({
    message: 'Ollama URL (press Enter for default):',
    placeholder: defaultUrl,
    defaultValue: defaultUrl
  });

  if (isCancel(apiUrl)) return null;

  return {
    provider: OCO_AI_PROVIDER_ENUM.OLLAMA,
    model: model as string,
    apiUrl: (apiUrl as string) || defaultUrl
  };
}

export async function runSetup(): Promise<boolean> {
  intro(chalk.bgCyan(' Welcome to OpenCommitX! '));

  // Load existing config to pre-populate fields.
  const existingConfig = getIsGlobalConfigFileExist()
    ? getGlobalConfig()
    : { ...DEFAULT_CONFIG };
  const currentProvider = (existingConfig as any).OCO_AI_PROVIDER as
    | string
    | undefined;

  // Select provider
  const provider = await selectProvider(currentProvider);
  if (isCancel(provider)) {
    outro('Setup cancelled');
    return false;
  }

  let config: Partial<Record<string, any>> = {};

  // Handle Ollama specially
  if (provider === OCO_AI_PROVIDER_ENUM.OLLAMA) {
    const ollamaConfig = await setupOllama();
    if (!ollamaConfig) {
      outro('Setup cancelled');
      return false;
    }

    config = {
      OCO_AI_PROVIDER: ollamaConfig.provider,
      OCO_MODEL: ollamaConfig.model,
      OCO_API_URL: ollamaConfig.apiUrl,
      OCO_API_KEY: 'ollama'
    };
  } else if (provider === OCO_AI_PROVIDER_ENUM.MLX) {
    console.log(chalk.cyan('\n  MLX - Apple Silicon Local AI\n'));
    console.log(chalk.dim('  MLX runs locally on Apple Silicon Macs.'));
    console.log(chalk.dim('  No API key required.\n'));

    const currentModel = (existingConfig as any).OCO_MODEL as
      | string
      | undefined;
    const model = await text({
      message: 'Enter model name:',
      placeholder: 'mlx-community/Llama-3-8B-Instruct-4bit',
      initialValue: currentModel || ''
    });

    if (isCancel(model)) {
      outro('Setup cancelled');
      return false;
    }

    config = {
      OCO_AI_PROVIDER: OCO_AI_PROVIDER_ENUM.MLX,
      OCO_MODEL: model,
      OCO_API_KEY: 'mlx'
    };
  } else {
    // Standard provider flow: API key then model.
    // Pass the current key so the user can keep it with one keypress.
    const providerKeyName = `OCO_${(provider as string).toUpperCase()}_KEY`;
    const currentKey =
      (existingConfig as any)[providerKeyName] ||
      ((existingConfig as any).OCO_AI_PROVIDER === provider
        ? (existingConfig as any).OCO_API_KEY
        : undefined);

    const apiKey = await getApiKey(provider as string, currentKey);
    if (isCancel(apiKey)) {
      outro('Setup cancelled');
      return false;
    }

    const model = await selectModel(provider as string, apiKey as string);
    if (isCancel(model)) {
      outro('Setup cancelled');
      return false;
    }

    config = {
      OCO_AI_PROVIDER: provider,
      OCO_API_KEY: apiKey,
      [providerKeyName]: apiKey,
      OCO_MODEL: model
    };
  }

  // Merge with existing config so all other settings are preserved.
  const newConfig = {
    ...existingConfig,
    ...config
  };

  setGlobalConfig(newConfig as any);

  outro(
    `${chalk.green('✔')} Configuration saved to ~/.opencommitx-data/config.ini\n\n  Run ${chalk.cyan('ocox')} to generate commit messages!`
  );

  return true;
}

export function isFirstRun(): boolean {
  if (!getIsGlobalConfigFileExist()) {
    return true;
  }

  const config = getConfig();

  // Check if API key is missing for providers that need it
  const provider = config.OCO_AI_PROVIDER || OCO_AI_PROVIDER_ENUM.OPENAI;

  if (NO_API_KEY_PROVIDERS.includes(provider as OCO_AI_PROVIDER_ENUM)) {
    // For Ollama/MLX, check if model is set
    return !config.OCO_MODEL;
  }

  // For other providers, check if provider-specific or generic API key is set
  return !getProviderApiKey(config, provider);
}

export async function promptForMissingApiKey(): Promise<boolean> {
  const config = getConfig();
  const provider = config.OCO_AI_PROVIDER || OCO_AI_PROVIDER_ENUM.OPENAI;

  if (NO_API_KEY_PROVIDERS.includes(provider as OCO_AI_PROVIDER_ENUM)) {
    return true; // No API key needed
  }

  // Check provider-specific key first, then fall back to generic key
  const resolvedKey = getProviderApiKey(config, provider);
  if (resolvedKey) {
    return true; // Already has key
  }

  console.log(
    chalk.yellow(`\nAPI key missing for ${provider}. Let's set it up.\n`)
  );

  const apiKey = await getApiKey(provider);
  if (isCancel(apiKey)) {
    return false;
  }

  const existingConfig = getGlobalConfig();
  const providerKeyName = `OCO_${(provider as string).toUpperCase()}_KEY`;
  setGlobalConfig({
    ...existingConfig,
    OCO_API_KEY: apiKey as string,
    [providerKeyName]: apiKey as string
  } as any);

  console.log(chalk.green('✔') + ' API key saved\n');
  return true;
}

function toPositiveNumber(raw: string, key: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Invalid value for ${key}: "${raw}" — must be a positive number`
    );
  }
  return n;
}

async function runFullSetup(): Promise<void> {
  intro(chalk.bgCyan(' OpenCommitX Full Setup '));
  console.log(
    chalk.dim(
      '  Walk through all configuration keys. Press Enter to keep the current/default value.\n'
    )
  );

  const currentConfig = getIsGlobalConfigFileExist()
    ? getGlobalConfig()
    : { ...DEFAULT_CONFIG };

  const updates: Record<string, any> = {};

  // Provider + model (delegate to main setup flow)
  console.log(chalk.bold('\n── Provider & Model ──'));
  const provider = await selectProvider();
  if (!isCancel(provider)) {
    updates.OCO_AI_PROVIDER = provider;
    if (
      provider !== OCO_AI_PROVIDER_ENUM.OLLAMA &&
      provider !== OCO_AI_PROVIDER_ENUM.MLX
    ) {
      const apiKey = await getApiKey(provider as string);
      if (!isCancel(apiKey)) {
        updates.OCO_API_KEY = apiKey;
        const providerKeyName = `OCO_${(provider as string).toUpperCase()}_KEY`;
        updates[providerKeyName] = apiKey;
      }
    }
    const model = await selectModel(
      provider as string,
      updates.OCO_API_KEY as string | undefined
    );
    if (!isCancel(model)) updates.OCO_MODEL = model;
  }

  // Token limits
  console.log(chalk.bold('\n── Token Limits ──'));
  const maxInput = await text({
    message: `Max input tokens (current: ${currentConfig[CONFIG_KEYS.OCO_TOKENS_MAX_INPUT] ?? 4096}):`,
    placeholder: '4096',
    defaultValue: String(
      currentConfig[CONFIG_KEYS.OCO_TOKENS_MAX_INPUT] ?? 4096
    )
  });
  if (!isCancel(maxInput) && maxInput) {
    try {
      updates.OCO_TOKENS_MAX_INPUT = toPositiveNumber(
        maxInput as string,
        'OCO_TOKENS_MAX_INPUT'
      );
    } catch {
      /* keep default */
    }
  }

  const maxOutput = await text({
    message: `Max output tokens (current: ${currentConfig[CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT] ?? 500}):`,
    placeholder: '500',
    defaultValue: String(
      currentConfig[CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT] ?? 500
    )
  });
  if (!isCancel(maxOutput) && maxOutput) {
    try {
      updates.OCO_TOKENS_MAX_OUTPUT = toPositiveNumber(
        maxOutput as string,
        'OCO_TOKENS_MAX_OUTPUT'
      );
    } catch {
      /* keep default */
    }
  }

  // Commit format
  console.log(chalk.bold('\n── Commit Format ──'));

  const promptModule = await select({
    message: `Prompt module (current: ${currentConfig[CONFIG_KEYS.OCO_PROMPT_MODULE] ?? 'conventional-commit'}):`,
    options: [
      { value: 'conventional-commit', label: 'conventional-commit (default)' },
      {
        value: '@commitlint',
        label: '@commitlint (use project commitlint config)'
      }
    ]
  });
  if (!isCancel(promptModule)) updates.OCO_PROMPT_MODULE = promptModule;

  const emojiEnabled = await select({
    message: `Enable GitMoji emoji prefix (current: ${currentConfig[CONFIG_KEYS.OCO_EMOJI] ?? false}):`,
    options: [
      { value: false, label: 'false (no emoji)' },
      { value: true, label: 'true (GitMoji prefix)' }
    ]
  });
  if (!isCancel(emojiEnabled)) updates.OCO_EMOJI = emojiEnabled;

  const oneLineCommit = await select({
    message: `One-line commit mode (current: ${currentConfig[CONFIG_KEYS.OCO_ONE_LINE_COMMIT] ?? false}):`,
    options: [
      { value: false, label: 'false (multi-line allowed)' },
      { value: true, label: 'true (force single line)' }
    ]
  });
  if (!isCancel(oneLineCommit)) updates.OCO_ONE_LINE_COMMIT = oneLineCommit;

  const description = await select({
    message: `Include description body (current: ${currentConfig[CONFIG_KEYS.OCO_DESCRIPTION] ?? false}):`,
    options: [
      { value: false, label: 'false' },
      { value: true, label: 'true (add 3-sentence body)' }
    ]
  });
  if (!isCancel(description)) updates.OCO_DESCRIPTION = description;

  const omitScope = await select({
    message: `Omit scope from commit message (current: ${currentConfig[CONFIG_KEYS.OCO_OMIT_SCOPE] ?? false}):`,
    options: [
      { value: false, label: 'false (include scope)' },
      { value: true, label: 'true (omit scope)' }
    ]
  });
  if (!isCancel(omitScope)) updates.OCO_OMIT_SCOPE = omitScope;

  const language = await text({
    message: `Output language (current: ${currentConfig[CONFIG_KEYS.OCO_LANGUAGE] ?? 'en'}):`,
    placeholder: 'en',
    defaultValue: currentConfig[CONFIG_KEYS.OCO_LANGUAGE] ?? 'en'
  });
  if (!isCancel(language) && language) updates.OCO_LANGUAGE = language;

  // Cache
  console.log(chalk.bold('\n── Commit Message Cache ──'));
  const cacheEnabled = await select({
    message: `Enable LLM result cache (current: ${currentConfig[CONFIG_KEYS.OCO_CACHE_ENABLED] ?? true}):`,
    options: [
      {
        value: true,
        label: 'true (cache results to survive pre-commit failures)'
      },
      { value: false, label: 'false (always regenerate)' }
    ]
  });
  if (!isCancel(cacheEnabled)) updates.OCO_CACHE_ENABLED = cacheEnabled;

  const cacheTtl = await text({
    message: `Cache TTL in seconds (current: ${currentConfig[CONFIG_KEYS.OCO_CACHE_TTL_SECONDS] ?? 3600}):`,
    placeholder: '3600',
    defaultValue: String(
      currentConfig[CONFIG_KEYS.OCO_CACHE_TTL_SECONDS] ?? 3600
    )
  });
  if (!isCancel(cacheTtl) && cacheTtl) {
    try {
      updates.OCO_CACHE_TTL_SECONDS = toPositiveNumber(
        cacheTtl as string,
        'OCO_CACHE_TTL_SECONDS'
      );
    } catch {
      /* keep default */
    }
  }

  // Diff routing
  console.log(chalk.bold('\n── Smart Diff Routing ──'));
  const perFileMode = await select({
    message: `Per-file commit mode (current: ${currentConfig[CONFIG_KEYS.OCO_PER_FILE_COMMIT_MODE] ?? 'auto'}):`,
    options: [
      { value: 'auto', label: 'auto (smart routing by line threshold)' },
      { value: 'always', label: 'always (always generate per-file messages)' },
      { value: 'never', label: 'never (always aggregate into one message)' }
    ]
  });
  if (!isCancel(perFileMode)) updates.OCO_PER_FILE_COMMIT_MODE = perFileMode;

  const perFileThreshold = await text({
    message: `Per-file line threshold (current: ${currentConfig[CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES] ?? 300}):`,
    placeholder: '300',
    defaultValue: String(
      currentConfig[CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES] ?? 300
    )
  });
  if (!isCancel(perFileThreshold) && perFileThreshold) {
    try {
      updates.OCO_PER_FILE_THRESHOLD_LINES = toPositiveNumber(
        perFileThreshold as string,
        'OCO_PER_FILE_THRESHOLD_LINES'
      );
    } catch {
      /* keep default */
    }
  }

  const multiCommitStrategy = await select({
    message: `Multi-commit strategy (current: ${currentConfig[CONFIG_KEYS.OCO_MULTI_COMMIT_STRATEGY] ?? 'single'}):`,
    options: [
      { value: 'single', label: 'single (join all messages into one commit)' },
      { value: 'sequential', label: 'sequential (one commit per file group)' }
    ]
  });
  if (!isCancel(multiCommitStrategy))
    updates.OCO_MULTI_COMMIT_STRATEGY = multiCommitStrategy;

  const maxFilesPerGroup = await text({
    message: `Max files per commit group (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP] ?? 10}):`,
    placeholder: '10',
    defaultValue: String(
      (currentConfig as any)[CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP] ?? 10
    )
  });
  if (!isCancel(maxFilesPerGroup) && maxFilesPerGroup) {
    try {
      (updates as any).OCO_MAX_FILES_PER_GROUP = toPositiveNumber(
        maxFilesPerGroup as string,
        'OCO_MAX_FILES_PER_GROUP'
      );
    } catch {
      /* keep default */
    }
  }

  // Commit content & style
  console.log(chalk.bold('\n── Commit Content & Style ──'));
  const why = await select({
    message: `Add "Why:" section after commit message (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_WHY] ?? false}):`,
    options: [
      { value: false, label: 'false' },
      { value: true, label: 'true (add motivation/reason section)' }
    ]
  });
  if (!isCancel(why)) (updates as any).OCO_WHY = why;

  const commitDetail = await select({
    message: `Commit message detail level (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_COMMIT_DETAIL] ?? 'normal'}):`,
    options: [
      { value: 'normal', label: 'normal (default)' },
      { value: 'concise', label: 'concise (one-liner, minimal description)' },
      {
        value: 'detailed',
        label: 'detailed (thorough description + reasoning)'
      }
    ]
  });
  if (!isCancel(commitDetail))
    (updates as any).OCO_COMMIT_DETAIL = commitDetail;

  // LLM tuning
  console.log(chalk.bold('\n── LLM Tuning ──'));
  const temperature = await text({
    message: `Temperature 0.0–2.0 (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_TEMPERATURE] ?? 0}):`,
    placeholder: '0',
    defaultValue: String(
      (currentConfig as any)[CONFIG_KEYS.OCO_TEMPERATURE] ?? 0
    )
  });
  if (!isCancel(temperature) && temperature !== undefined) {
    const t = Number(temperature);
    if (!isNaN(t) && t >= 0 && t <= 2) (updates as any).OCO_TEMPERATURE = t;
  }

  const genTimeout = await text({
    message: `Generation timeout in seconds (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS] ?? 90}):`,
    placeholder: '90',
    defaultValue: String(
      (currentConfig as any)[CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS] ?? 90
    )
  });
  if (!isCancel(genTimeout) && genTimeout) {
    try {
      (updates as any).OCO_GENERATION_TIMEOUT_SECONDS = toPositiveNumber(
        genTimeout as string,
        'OCO_GENERATION_TIMEOUT_SECONDS'
      );
    } catch {
      /* keep default */
    }
  }

  // Fallback model
  console.log(chalk.bold('\n── Fallback Model (optional) ──'));
  const fallbackModel = await text({
    message: `Fallback model ID (press Enter to skip, current: ${(currentConfig as any)[CONFIG_KEYS.OCO_FALLBACK_MODEL] ?? 'none'}):`,
    placeholder: 'e.g. anthropic/claude-haiku-4.5 or claude-3-5-haiku-20241022',
    defaultValue: (currentConfig as any)[CONFIG_KEYS.OCO_FALLBACK_MODEL] ?? ''
  });
  if (!isCancel(fallbackModel) && fallbackModel !== undefined) {
    (updates as any).OCO_FALLBACK_MODEL = fallbackModel;
  }

  if ((updates as any).OCO_FALLBACK_MODEL) {
    const fallbackProvider = await select({
      message: `Fallback provider (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_FALLBACK_PROVIDER] ?? 'same as primary'}):`,
      options: [
        { value: '', label: 'Same as primary provider' },
        ...Object.values(OCO_AI_PROVIDER_ENUM)
          .filter((p) => p !== 'test')
          .map((p) => ({ value: p, label: p }))
      ]
    });
    if (!isCancel(fallbackProvider))
      (updates as any).OCO_FALLBACK_PROVIDER = fallbackProvider;
  }

  // Debug
  console.log(chalk.bold('\n── Debug & Advanced ──'));
  const debugMode = await select({
    message: `Debug mode — write LLM prompts/responses to ~/.opencommitx-data/debug/ (current: ${(currentConfig as any)[CONFIG_KEYS.OCO_DEBUG] ?? false}):`,
    options: [
      { value: false, label: 'false' },
      { value: true, label: 'true (verbose debug output)' }
    ]
  });
  if (!isCancel(debugMode)) (updates as any).OCO_DEBUG = debugMode;

  // Save
  const newConfig = { ...currentConfig, ...updates };
  setGlobalConfig(newConfig as any);

  outro(
    `${chalk.green('✔')} Full configuration saved to ~/.opencommitx-data/config.ini\n\n  Run ${chalk.cyan('ocox')} to generate commit messages!`
  );
}

export const setupCommand = command(
  {
    name: COMMANDS.setup,
    parameters: ['[mode]'],
    help: {
      description: 'Interactive setup wizard for OpenCommitX',
      examples: [
        'Quick provider/model setup: ocox setup',
        'Full walkthrough of all settings: ocox setup full'
      ]
    }
  },
  async (argv) => {
    const mode = argv._.mode;
    if (mode === 'full' || mode === 'all' || mode === 'detailed') {
      await runFullSetup();
    } else {
      await runSetup();
    }
  }
);
