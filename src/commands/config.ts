import { intro, outro } from '@clack/prompts';
import chalk from 'chalk';
import { command } from 'cleye';
import * as dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse as iniParse, stringify as iniStringify } from 'ini';
import { homedir } from 'os';
import { dirname, join as pathJoin, resolve as pathResolve } from 'path';
import { COMMANDS } from './ENUMS';
import { TEST_MOCK_TYPES } from '../engine/testAi';
import { getI18nLocal, i18n } from '../i18n';

export enum CONFIG_KEYS {
  OCO_API_KEY = 'OCO_API_KEY',
  OCO_TOKENS_MAX_INPUT = 'OCO_TOKENS_MAX_INPUT',
  OCO_TOKENS_MAX_OUTPUT = 'OCO_TOKENS_MAX_OUTPUT',
  OCO_DESCRIPTION = 'OCO_DESCRIPTION',
  OCO_EMOJI = 'OCO_EMOJI',
  OCO_MODEL = 'OCO_MODEL',
  OCO_LANGUAGE = 'OCO_LANGUAGE',
  OCO_WHY = 'OCO_WHY',
  OCO_MESSAGE_TEMPLATE_PLACEHOLDER = 'OCO_MESSAGE_TEMPLATE_PLACEHOLDER',
  OCO_PROMPT_MODULE = 'OCO_PROMPT_MODULE',
  OCO_AI_PROVIDER = 'OCO_AI_PROVIDER',
  OCO_ONE_LINE_COMMIT = 'OCO_ONE_LINE_COMMIT',
  OCO_TEST_MOCK_TYPE = 'OCO_TEST_MOCK_TYPE',
  OCO_API_URL = 'OCO_API_URL',
  OCO_API_CUSTOM_HEADERS = 'OCO_API_CUSTOM_HEADERS',
  OCO_OMIT_SCOPE = 'OCO_OMIT_SCOPE',
  OCO_GITPUSH = 'OCO_GITPUSH', // todo: deprecate
  OCO_HOOK_AUTO_UNCOMMENT = 'OCO_HOOK_AUTO_UNCOMMENT',
  // Cache keys (Phase 2)
  OCO_CACHE_ENABLED = 'OCO_CACHE_ENABLED',
  OCO_CACHE_TTL_SECONDS = 'OCO_CACHE_TTL_SECONDS',
  // Diff routing keys (Phase 4)
  OCO_PER_FILE_THRESHOLD_LINES = 'OCO_PER_FILE_THRESHOLD_LINES',
  OCO_PER_FILE_COMMIT_MODE = 'OCO_PER_FILE_COMMIT_MODE',
  OCO_PYTHON_DOCSTRING_THRESHOLD = 'OCO_PYTHON_DOCSTRING_THRESHOLD',
  OCO_PYTHON_DOCSTRING_MODE = 'OCO_PYTHON_DOCSTRING_MODE',
  OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO = 'OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO',
  // Multi-commit strategy (Phase 5)
  OCO_MULTI_COMMIT_STRATEGY = 'OCO_MULTI_COMMIT_STRATEGY',
  // Debug mode
  OCO_DEBUG = 'OCO_DEBUG',
  // Diff routing extras
  OCO_MAX_FILES_PER_GROUP = 'OCO_MAX_FILES_PER_GROUP',
  OCO_MAX_LINES_PER_GROUP = 'OCO_MAX_LINES_PER_GROUP',
  // LLM generation
  OCO_TEMPERATURE = 'OCO_TEMPERATURE',
  OCO_COMMIT_DETAIL = 'OCO_COMMIT_DETAIL',
  OCO_GENERATION_TIMEOUT_SECONDS = 'OCO_GENERATION_TIMEOUT_SECONDS',
  // Fallback model
  OCO_FALLBACK_MODEL = 'OCO_FALLBACK_MODEL',
  OCO_FALLBACK_PROVIDER = 'OCO_FALLBACK_PROVIDER',
  // Per-provider API keys (Phase 6)
  OCO_OPENAI_KEY = 'OCO_OPENAI_KEY',
  OCO_ANTHROPIC_KEY = 'OCO_ANTHROPIC_KEY',
  OCO_OPENROUTER_KEY = 'OCO_OPENROUTER_KEY',
  OCO_GEMINI_KEY = 'OCO_GEMINI_KEY',
  OCO_GROQ_KEY = 'OCO_GROQ_KEY',
  OCO_MISTRAL_KEY = 'OCO_MISTRAL_KEY',
  OCO_DEEPSEEK_KEY = 'OCO_DEEPSEEK_KEY',
  OCO_AIMLAPI_KEY = 'OCO_AIMLAPI_KEY',
  OCO_AZURE_KEY = 'OCO_AZURE_KEY'
}

export enum CONFIG_MODES {
  get = 'get',
  set = 'set',
  describe = 'describe'
}

export const MODEL_LIST = {
  openai: [
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-instruct',
    'gpt-3.5-turbo-0613',
    'gpt-3.5-turbo-0301',
    'gpt-3.5-turbo-1106',
    'gpt-3.5-turbo-0125',
    'gpt-3.5-turbo-16k',
    'gpt-3.5-turbo-16k-0613',
    'gpt-3.5-turbo-16k-0301',
    'gpt-4',
    'gpt-4-0314',
    'gpt-4-0613',
    'gpt-4-1106-preview',
    'gpt-4-0125-preview',
    'gpt-4-turbo-preview',
    'gpt-4-vision-preview',
    'gpt-4-1106-vision-preview',
    'gpt-4-turbo',
    'gpt-4-turbo-2024-04-09',
    'gpt-4-32k',
    'gpt-4-32k-0314',
    'gpt-4-32k-0613',
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-mini-2024-07-18'
  ],

  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022'
  ],

  gemini: [
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.0-pro',
    'gemini-pro-vision',
    'text-embedding-004'
  ],

  groq: [
    'llama3-70b-8192', // Meta Llama 3 70B (default one, no daily token limit and 14 400 reqs/day)
    'llama3-8b-8192', // Meta Llama 3 8B
    'llama-guard-3-8b', // Llama Guard 3 8B
    'llama-3.1-8b-instant', // Llama 3.1 8B (Preview)
    'llama-3.1-70b-versatile', // Llama 3.1 70B (Preview)
    'gemma-7b-it', // Gemma 7B
    'gemma2-9b-it' // Gemma 2 9B
  ],

  mistral: [
    'ministral-3b-2410',
    'ministral-3b-latest',
    'ministral-8b-2410',
    'ministral-8b-latest',
    'open-mistral-7b',
    'mistral-tiny',
    'mistral-tiny-2312',
    'open-mistral-nemo',
    'open-mistral-nemo-2407',
    'mistral-tiny-2407',
    'mistral-tiny-latest',
    'open-mixtral-8x7b',
    'mistral-small',
    'mistral-small-2312',
    'open-mixtral-8x22b',
    'open-mixtral-8x22b-2404',
    'mistral-small-2402',
    'mistral-small-2409',
    'mistral-small-latest',
    'mistral-medium-2312',
    'mistral-medium',
    'mistral-medium-latest',
    'mistral-large-2402',
    'mistral-large-2407',
    'mistral-large-2411',
    'mistral-large-latest',
    'pixtral-large-2411',
    'pixtral-large-latest',
    'codestral-2405',
    'codestral-latest',
    'codestral-mamba-2407',
    'open-codestral-mamba',
    'codestral-mamba-latest',
    'pixtral-12b-2409',
    'pixtral-12b',
    'pixtral-12b-latest',
    'mistral-embed',
    'mistral-moderation-2411',
    'mistral-moderation-latest'
  ],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],

  // AI/ML API available chat-completion models
  // https://api.aimlapi.com/v1/models
  aimlapi: [
    'openai/gpt-4o',
    'gpt-4o-2024-08-06',
    'gpt-4o-2024-05-13',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    'chatgpt-4o-latest',
    'gpt-4-turbo',
    'gpt-4-turbo-2024-04-09',
    'gpt-4',
    'gpt-4-0125-preview',
    'gpt-4-1106-preview',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125',
    'gpt-3.5-turbo-1106',
    'o1-preview',
    'o1-preview-2024-09-12',
    'o1-mini',
    'o1-mini-2024-09-12',
    'o3-mini',
    'gpt-4o-audio-preview',
    'gpt-4o-mini-audio-preview',
    'gpt-4o-search-preview',
    'gpt-4o-mini-search-preview',
    'openai/gpt-4.1-2025-04-14',
    'openai/gpt-4.1-mini-2025-04-14',
    'openai/gpt-4.1-nano-2025-04-14',
    'openai/o4-mini-2025-04-16',
    'openai/o3-2025-04-16',
    'o1',
    'openai/o3-pro',
    'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
    'google/gemma-2-27b-it',
    'meta-llama/Llama-Vision-Free',
    'Qwen/Qwen2-72B-Instruct',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
    'nvidia/Llama-3.1-Nemotron-70B-Instruct-HF',
    'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO',
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Llama-3.2-3B-Instruct-Turbo',
    'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
    'meta-llama/Llama-Guard-3-11B-Vision-Turbo',
    'Qwen/Qwen2.5-7B-Instruct-Turbo',
    'Qwen/Qwen2.5-Coder-32B-Instruct',
    'meta-llama/Meta-Llama-3-8B-Instruct-Lite',
    'meta-llama/Llama-3-8b-chat-hf',
    'meta-llama/Llama-3-70b-chat-hf',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
    'Qwen/QwQ-32B',
    'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    'mistralai/Mistral-7B-Instruct-v0.2',
    'meta-llama/LlamaGuard-2-8b',
    'mistralai/Mistral-7B-Instruct-v0.1',
    'mistralai/Mistral-7B-Instruct-v0.3',
    'meta-llama/Meta-Llama-Guard-3-8B',
    'meta-llama/llama-4-scout',
    'meta-llama/llama-4-maverick',
    'Qwen/Qwen3-235B-A22B-fp8-tput',
    'claude-3-opus-20240229',
    'claude-3-haiku-20240307',
    'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-7-sonnet-20250219',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'google/gemini-2.0-flash-exp',
    'google/gemini-2.0-flash',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'deepseek-chat',
    'deepseek-reasoner',
    'qwen-max',
    'qwen-plus',
    'qwen-turbo',
    'qwen-max-2025-01-25',
    'mistralai/mistral-tiny',
    'mistralai/mistral-nemo',
    'anthracite-org/magnum-v4-72b',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'cohere/command-r-plus',
    'mistralai/codestral-2501',
    'google/gemma-3-4b-it',
    'google/gemma-3-12b-it',
    'google/gemma-3-27b-it',
    'google/gemini-2.5-flash-lite-preview',
    'deepseek/deepseek-prover-v2',
    'google/gemma-3n-e4b-it',
    'cohere/command-a',
    'MiniMax-Text-01',
    'abab6.5s-chat',
    'minimax/m1',
    'bagoodex/bagoodex-search-v1',
    'moonshot/kimi-k2-preview',
    'perplexity/sonar',
    'perplexity/sonar-pro',
    'x-ai/grok-4-07-09',
    'x-ai/grok-3-beta',
    'x-ai/grok-3-mini-beta'
  ],

  // OpenRouter available models
  // input_modalities: 'text'
  // output_modalities: 'text'
  // https://openrouter.ai/api/v1/models
  openrouter: [
    'openai/gpt-4o-mini', // used by default
    '01-ai/yi-large',
    'aetherwiing/mn-starcannon-12b',
    'agentica-org/deepcoder-14b-preview:free',
    'ai21/jamba-1.6-large',
    'ai21/jamba-1.6-mini',
    'aion-labs/aion-1.0',
    'aion-labs/aion-1.0-mini',
    'aion-labs/aion-rp-llama-3.1-8b',
    'alfredpros/codellama-7b-instruct-solidity',
    'all-hands/openhands-lm-32b-v0.1',
    'alpindale/goliath-120b',
    'alpindale/magnum-72b',
    'amazon/nova-lite-v1',
    'amazon/nova-micro-v1',
    'amazon/nova-pro-v1',
    'anthracite-org/magnum-v2-72b',
    'anthracite-org/magnum-v4-72b',
    'anthropic/claude-2',
    'anthropic/claude-2.0',
    'anthropic/claude-2.0:beta',
    'anthropic/claude-2.1',
    'anthropic/claude-2.1:beta',
    'anthropic/claude-2:beta',
    'anthropic/claude-3-haiku',
    'anthropic/claude-3-haiku:beta',
    'anthropic/claude-3-opus',
    'anthropic/claude-3-opus:beta',
    'anthropic/claude-3-sonnet',
    'anthropic/claude-3-sonnet:beta',
    'anthropic/claude-3.5-haiku',
    'anthropic/claude-3.5-haiku-20241022',
    'anthropic/claude-3.5-haiku-20241022:beta',
    'anthropic/claude-3.5-haiku:beta',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-sonnet-20240620',
    'anthropic/claude-3.5-sonnet-20240620:beta',
    'anthropic/claude-3.5-sonnet:beta',
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-3.7-sonnet:beta',
    'anthropic/claude-3.7-sonnet:thinking',
    'anthropic/claude-opus-4',
    'anthropic/claude-sonnet-4',
    'arcee-ai/arcee-blitz',
    'arcee-ai/caller-large',
    'arcee-ai/coder-large',
    'arcee-ai/maestro-reasoning',
    'arcee-ai/spotlight',
    'arcee-ai/virtuoso-large',
    'arcee-ai/virtuoso-medium-v2',
    'arliai/qwq-32b-arliai-rpr-v1:free',
    'cognitivecomputations/dolphin-mixtral-8x22b',
    'cognitivecomputations/dolphin3.0-mistral-24b:free',
    'cognitivecomputations/dolphin3.0-r1-mistral-24b:free',
    'cohere/command',
    'cohere/command-a',
    'cohere/command-r',
    'cohere/command-r-03-2024',
    'cohere/command-r-08-2024',
    'cohere/command-r-plus',
    'cohere/command-r-plus-04-2024',
    'cohere/command-r-plus-08-2024',
    'cohere/command-r7b-12-2024',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-chat-v3-0324',
    'deepseek/deepseek-chat-v3-0324:free',
    'deepseek/deepseek-chat:free',
    'deepseek/deepseek-prover-v2',
    'deepseek/deepseek-prover-v2:free',
    'deepseek/deepseek-r1',
    'deepseek/deepseek-r1-0528',
    'deepseek/deepseek-r1-0528-qwen3-8b',
    'deepseek/deepseek-r1-0528-qwen3-8b:free',
    'deepseek/deepseek-r1-0528:free',
    'deepseek/deepseek-r1-distill-llama-70b',
    'deepseek/deepseek-r1-distill-llama-70b:free',
    'deepseek/deepseek-r1-distill-llama-8b',
    'deepseek/deepseek-r1-distill-qwen-1.5b',
    'deepseek/deepseek-r1-distill-qwen-14b',
    'deepseek/deepseek-r1-distill-qwen-14b:free',
    'deepseek/deepseek-r1-distill-qwen-32b',
    'deepseek/deepseek-r1-distill-qwen-32b:free',
    'deepseek/deepseek-r1-distill-qwen-7b',
    'deepseek/deepseek-r1-zero:free',
    'deepseek/deepseek-r1:free',
    'deepseek/deepseek-v3-base:free',
    'eleutherai/llemma_7b',
    'eva-unit-01/eva-llama-3.33-70b',
    'eva-unit-01/eva-qwen-2.5-32b',
    'eva-unit-01/eva-qwen-2.5-72b',
    'featherless/qwerky-72b:free',
    'google/gemini-2.0-flash-001',
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-2.0-flash-lite-001',
    'google/gemini-2.5-flash-preview',
    'google/gemini-2.5-flash-preview-05-20',
    'google/gemini-2.5-flash-preview-05-20:thinking',
    'google/gemini-2.5-flash-preview:thinking',
    'google/gemini-2.5-pro-exp-03-25',
    'google/gemini-2.5-pro-preview',
    'google/gemini-2.5-pro-preview-05-06',
    'google/gemini-flash-1.5',
    'google/gemini-flash-1.5-8b',
    'google/gemini-pro-1.5',
    'google/gemma-2-27b-it',
    'google/gemma-2-9b-it',
    'google/gemma-2-9b-it:free',
    'google/gemma-3-12b-it',
    'google/gemma-3-12b-it:free',
    'google/gemma-3-1b-it:free',
    'google/gemma-3-27b-it',
    'google/gemma-3-27b-it:free',
    'google/gemma-3-4b-it',
    'google/gemma-3-4b-it:free',
    'google/gemma-3n-e4b-it:free',
    'gryphe/mythomax-l2-13b',
    'inception/mercury-coder-small-beta',
    'infermatic/mn-inferor-12b',
    'inflection/inflection-3-pi',
    'inflection/inflection-3-productivity',
    'liquid/lfm-3b',
    'liquid/lfm-40b',
    'liquid/lfm-7b',
    'mancer/weaver',
    'meta-llama/llama-2-70b-chat',
    'meta-llama/llama-3-70b-instruct',
    'meta-llama/llama-3-8b-instruct',
    'meta-llama/llama-3.1-405b',
    'meta-llama/llama-3.1-405b-instruct',
    'meta-llama/llama-3.1-405b:free',
    'meta-llama/llama-3.1-70b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.2-11b-vision-instruct',
    'meta-llama/llama-3.2-11b-vision-instruct:free',
    'meta-llama/llama-3.2-1b-instruct',
    'meta-llama/llama-3.2-1b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct',
    'meta-llama/llama-3.2-3b-instruct:free',
    'meta-llama/llama-3.2-90b-vision-instruct',
    'meta-llama/llama-3.3-70b-instruct',
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.3-8b-instruct:free',
    'meta-llama/llama-4-maverick',
    'meta-llama/llama-4-maverick:free',
    'meta-llama/llama-4-scout',
    'meta-llama/llama-4-scout:free',
    'meta-llama/llama-guard-2-8b',
    'meta-llama/llama-guard-3-8b',
    'meta-llama/llama-guard-4-12b',
    'microsoft/mai-ds-r1:free',
    'microsoft/phi-3-medium-128k-instruct',
    'microsoft/phi-3-mini-128k-instruct',
    'microsoft/phi-3.5-mini-128k-instruct',
    'microsoft/phi-4',
    'microsoft/phi-4-multimodal-instruct',
    'microsoft/phi-4-reasoning-plus',
    'microsoft/phi-4-reasoning-plus:free',
    'microsoft/phi-4-reasoning:free',
    'microsoft/wizardlm-2-8x22b',
    'minimax/minimax-01',
    'mistralai/codestral-2501',
    'mistralai/devstral-small',
    'mistralai/devstral-small:free',
    'mistralai/magistral-medium-2506',
    'mistralai/magistral-medium-2506:thinking',
    'mistralai/magistral-small-2506',
    'mistralai/ministral-3b',
    'mistralai/ministral-8b',
    'mistralai/mistral-7b-instruct',
    'mistralai/mistral-7b-instruct-v0.1',
    'mistralai/mistral-7b-instruct-v0.2',
    'mistralai/mistral-7b-instruct-v0.3',
    'mistralai/mistral-7b-instruct:free',
    'mistralai/mistral-large',
    'mistralai/mistral-large-2407',
    'mistralai/mistral-large-2411',
    'mistralai/mistral-medium',
    'mistralai/mistral-medium-3',
    'mistralai/mistral-nemo',
    'mistralai/mistral-nemo:free',
    'mistralai/mistral-saba',
    'mistralai/mistral-small',
    'mistralai/mistral-small-24b-instruct-2501',
    'mistralai/mistral-small-24b-instruct-2501:free',
    'mistralai/mistral-small-3.1-24b-instruct',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'mistralai/mistral-tiny',
    'mistralai/mixtral-8x22b-instruct',
    'mistralai/mixtral-8x7b-instruct',
    'mistralai/pixtral-12b',
    'mistralai/pixtral-large-2411',
    'moonshotai/kimi-vl-a3b-thinking:free',
    'moonshotai/moonlight-16b-a3b-instruct:free',
    'neversleep/llama-3-lumimaid-70b',
    'neversleep/llama-3-lumimaid-8b',
    'neversleep/llama-3.1-lumimaid-70b',
    'neversleep/llama-3.1-lumimaid-8b',
    'neversleep/noromaid-20b',
    'nothingiisreal/mn-celeste-12b',
    'nousresearch/deephermes-3-llama-3-8b-preview:free',
    'nousresearch/deephermes-3-mistral-24b-preview:free',
    'nousresearch/hermes-2-pro-llama-3-8b',
    'nousresearch/hermes-3-llama-3.1-405b',
    'nousresearch/hermes-3-llama-3.1-70b',
    'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
    'nvidia/llama-3.3-nemotron-super-49b-v1',
    'nvidia/llama-3.3-nemotron-super-49b-v1:free',
    'open-r1/olympiccoder-32b:free',
    'openai/chatgpt-4o-latest',
    'openai/codex-mini',
    'openai/gpt-3.5-turbo',
    'openai/gpt-3.5-turbo-0125',
    'openai/gpt-3.5-turbo-0613',
    'openai/gpt-3.5-turbo-1106',
    'openai/gpt-3.5-turbo-16k',
    'openai/gpt-3.5-turbo-instruct',
    'openai/gpt-4',
    'openai/gpt-4-0314',
    'openai/gpt-4-1106-preview',
    'openai/gpt-4-turbo',
    'openai/gpt-4-turbo-preview',
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
    'openai/gpt-4.1-nano',
    'openai/gpt-4.5-preview',
    'openai/gpt-4o',
    'openai/gpt-4o-2024-05-13',
    'openai/gpt-4o-2024-08-06',
    'openai/gpt-4o-2024-11-20',
    'openai/gpt-4o-mini-2024-07-18',
    'openai/gpt-4o-mini-search-preview',
    'openai/gpt-4o-search-preview',
    'openai/gpt-4o:extended',
    'openai/o1',
    'openai/o1-mini',
    'openai/o1-mini-2024-09-12',
    'openai/o1-preview',
    'openai/o1-preview-2024-09-12',
    'openai/o1-pro',
    'openai/o3',
    'openai/o3-mini',
    'openai/o3-mini-high',
    'openai/o3-pro',
    'openai/o4-mini',
    'openai/o4-mini-high',
    'opengvlab/internvl3-14b:free',
    'opengvlab/internvl3-2b:free',
    'openrouter/auto',
    'perplexity/llama-3.1-sonar-large-128k-online',
    'perplexity/llama-3.1-sonar-small-128k-online',
    'perplexity/r1-1776',
    'perplexity/sonar',
    'perplexity/sonar-deep-research',
    'perplexity/sonar-pro',
    'perplexity/sonar-reasoning',
    'perplexity/sonar-reasoning-pro',
    'pygmalionai/mythalion-13b',
    'qwen/qwen-2-72b-instruct',
    'qwen/qwen-2.5-72b-instruct',
    'qwen/qwen-2.5-72b-instruct:free',
    'qwen/qwen-2.5-7b-instruct',
    'qwen/qwen-2.5-7b-instruct:free',
    'qwen/qwen-2.5-coder-32b-instruct',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'qwen/qwen-2.5-vl-7b-instruct',
    'qwen/qwen-2.5-vl-7b-instruct:free',
    'qwen/qwen-max',
    'qwen/qwen-plus',
    'qwen/qwen-turbo',
    'qwen/qwen-vl-max',
    'qwen/qwen-vl-plus',
    'qwen/qwen2.5-vl-32b-instruct',
    'qwen/qwen2.5-vl-32b-instruct:free',
    'qwen/qwen2.5-vl-3b-instruct:free',
    'qwen/qwen2.5-vl-72b-instruct',
    'qwen/qwen2.5-vl-72b-instruct:free',
    'qwen/qwen3-14b',
    'qwen/qwen3-14b:free',
    'qwen/qwen3-235b-a22b',
    'qwen/qwen3-235b-a22b:free',
    'qwen/qwen3-30b-a3b',
    'qwen/qwen3-30b-a3b:free',
    'qwen/qwen3-32b',
    'qwen/qwen3-32b:free',
    'qwen/qwen3-8b',
    'qwen/qwen3-8b:free',
    'qwen/qwq-32b',
    'qwen/qwq-32b-preview',
    'qwen/qwq-32b:free',
    'raifle/sorcererlm-8x22b',
    'rekaai/reka-flash-3:free',
    'sao10k/fimbulvetr-11b-v2',
    'sao10k/l3-euryale-70b',
    'sao10k/l3-lunaris-8b',
    'sao10k/l3.1-euryale-70b',
    'sao10k/l3.3-euryale-70b',
    'sarvamai/sarvam-m:free',
    'scb10x/llama3.1-typhoon2-70b-instruct',
    'sentientagi/dobby-mini-unhinged-plus-llama-3.1-8b',
    'shisa-ai/shisa-v2-llama3.3-70b:free',
    'sophosympatheia/midnight-rose-70b',
    'thedrummer/anubis-pro-105b-v1',
    'thedrummer/rocinante-12b',
    'thedrummer/skyfall-36b-v2',
    'thedrummer/unslopnemo-12b',
    'thedrummer/valkyrie-49b-v1',
    'thudm/glm-4-32b',
    'thudm/glm-4-32b:free',
    'thudm/glm-z1-32b',
    'thudm/glm-z1-32b:free',
    'thudm/glm-z1-rumination-32b',
    'tngtech/deepseek-r1t-chimera:free',
    'undi95/remm-slerp-l2-13b',
    'undi95/toppy-m-7b',
    'x-ai/grok-2-1212',
    'x-ai/grok-2-vision-1212',
    'x-ai/grok-3-beta',
    'x-ai/grok-3-mini-beta',
    'x-ai/grok-beta',
    'x-ai/grok-vision-beta'
  ]
};

const getDefaultModel = (provider: string | undefined): string => {
  switch (provider) {
    case 'ollama':
      return '';
    case 'mlx':
      return '';
    case 'anthropic':
      return MODEL_LIST.anthropic[0];
    case 'gemini':
      return MODEL_LIST.gemini[0];
    case 'groq':
      return MODEL_LIST.groq[0];
    case 'mistral':
      return MODEL_LIST.mistral[0];
    case 'deepseek':
      return MODEL_LIST.deepseek[0];
    case 'aimlapi':
      return MODEL_LIST.aimlapi[0];
    case 'openrouter':
      return MODEL_LIST.openrouter[0];
    default:
      return MODEL_LIST.openai[0];
  }
};

export enum DEFAULT_TOKEN_LIMITS {
  DEFAULT_MAX_TOKENS_INPUT = 4096,
  DEFAULT_MAX_TOKENS_OUTPUT = 500
}

const validateConfig = (
  key: string,
  condition: any,
  validationMessage: string
) => {
  if (!condition) {
    outro(`${chalk.red('✖')} wrong value for ${key}: ${validationMessage}.`);

    outro(
      'For more help refer to docs https://github.com/xwberry/opencommitx'
    );

    process.exit(1);
  }
};

export const configValidators = {
  [CONFIG_KEYS.OCO_API_KEY](value: any, config: any = {}) {
    if (config.OCO_AI_PROVIDER !== 'openai') return value;

    validateConfig(
      'OCO_API_KEY',
      typeof value === 'string' && value.length > 0,
      'Empty value is not allowed'
    );

    validateConfig(
      'OCO_API_KEY',
      value,
      'You need to provide the OCO_API_KEY when OCO_AI_PROVIDER set to "openai" (default) or "ollama" or "mlx" or "azure" or "gemini" or "flowise" or "anthropic" or "deepseek". Run `oco config set OCO_API_KEY=your_key OCO_AI_PROVIDER=openai`'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_DESCRIPTION](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_DESCRIPTION,
      typeof value === 'boolean',
      'Must be boolean: true or false'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_API_CUSTOM_HEADERS](value) {
    try {
      // Custom headers must be a valid JSON string
      if (typeof value === 'string') {
        JSON.parse(value);
      }
      return value;
    } catch (error) {
      validateConfig(
        CONFIG_KEYS.OCO_API_CUSTOM_HEADERS,
        false,
        'Must be a valid JSON string of headers'
      );
    }
  },

  [CONFIG_KEYS.OCO_TOKENS_MAX_INPUT](value: any) {
    value = parseInt(value);
    validateConfig(
      CONFIG_KEYS.OCO_TOKENS_MAX_INPUT,
      !isNaN(value),
      'Must be a number'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT](value: any) {
    value = parseInt(value);
    validateConfig(
      CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT,
      !isNaN(value),
      'Must be a number'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_EMOJI](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_EMOJI,
      typeof value === 'boolean',
      'Must be boolean: true or false'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_OMIT_SCOPE](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_OMIT_SCOPE,
      typeof value === 'boolean',
      'Must be boolean: true or false'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_LANGUAGE](value: any) {
    const supportedLanguages = Object.keys(i18n);

    validateConfig(
      CONFIG_KEYS.OCO_LANGUAGE,
      getI18nLocal(value),
      `${value} is not supported yet. Supported languages: ${supportedLanguages}`
    );

    return getI18nLocal(value);
  },

  [CONFIG_KEYS.OCO_API_URL](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_API_URL,
      typeof value === 'string',
      `${value} is not a valid URL. It should start with 'http://' or 'https://'.`
    );
    return value;
  },

  [CONFIG_KEYS.OCO_MODEL](value: any, config: any = {}) {
    validateConfig(
      CONFIG_KEYS.OCO_MODEL,
      typeof value === 'string',
      `${value} is not supported yet, use:\n\n ${[
        ...MODEL_LIST.openai,
        ...MODEL_LIST.anthropic,
        ...MODEL_LIST.gemini
      ].join('\n')}`
    );
    return value;
  },

  [CONFIG_KEYS.OCO_MESSAGE_TEMPLATE_PLACEHOLDER](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_MESSAGE_TEMPLATE_PLACEHOLDER,
      value.startsWith('$'),
      `${value} must start with $, for example: '$msg'`
    );
    return value;
  },

  [CONFIG_KEYS.OCO_PROMPT_MODULE](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_PROMPT_MODULE,
      ['conventional-commit', '@commitlint'].includes(value),
      `${value} is not supported yet, use '@commitlint' or 'conventional-commit' (default)`
    );
    return value;
  },

  // todo: deprecate
  [CONFIG_KEYS.OCO_GITPUSH](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_GITPUSH,
      typeof value === 'boolean',
      'Must be true or false'
    );
    return value;
  },

  [CONFIG_KEYS.OCO_AI_PROVIDER](value: any) {
    if (!value) value = 'openai';

    validateConfig(
      CONFIG_KEYS.OCO_AI_PROVIDER,
      [
        'openai',
        'mistral',
        'anthropic',
        'gemini',
        'azure',
        'test',
        'flowise',
        'groq',
        'deepseek',
        'aimlapi',
        'openrouter',
        'mlx'
      ].includes(value) || value.startsWith('ollama'),
      `${value} is not supported yet, use 'ollama', 'mlx', 'anthropic', 'azure', 'gemini', 'flowise', 'mistral', 'deepseek', 'aimlapi' or 'openai' (default)`
    );

    return value;
  },

  [CONFIG_KEYS.OCO_ONE_LINE_COMMIT](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_ONE_LINE_COMMIT,
      typeof value === 'boolean',
      'Must be true or false'
    );

    return value;
  },

  [CONFIG_KEYS.OCO_TEST_MOCK_TYPE](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_TEST_MOCK_TYPE,
      TEST_MOCK_TYPES.includes(value),
      `${value} is not supported yet, use ${TEST_MOCK_TYPES.map(
        (t) => `'${t}'`
      ).join(', ')}`
    );
    return value;
  },

  [CONFIG_KEYS.OCO_WHY](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_WHY,
      typeof value === 'boolean',
      'Must be true or false'
    );
    return value;
  },

  [CONFIG_KEYS.OCO_HOOK_AUTO_UNCOMMENT](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_HOOK_AUTO_UNCOMMENT,
      typeof value === 'boolean',
      'Must be true or false'
    );
    return value;
  },

  [CONFIG_KEYS.OCO_CACHE_ENABLED](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_CACHE_ENABLED,
      typeof value === 'boolean',
      'Must be true or false'
    );
    return value;
  },

  [CONFIG_KEYS.OCO_CACHE_TTL_SECONDS](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_CACHE_TTL_SECONDS,
      !isNaN(value) && Number(value) > 0,
      'Must be a positive number (seconds)'
    );
    return Number(value);
  },

  [CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES,
      !isNaN(value) && Number(value) > 0,
      'Must be a positive number'
    );
    return Number(value);
  },

  [CONFIG_KEYS.OCO_PER_FILE_COMMIT_MODE](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_PER_FILE_COMMIT_MODE,
      ['auto', 'always', 'never'].includes(value),
      "Must be 'auto', 'always', or 'never'"
    );
    return value;
  },

  [CONFIG_KEYS.OCO_PYTHON_DOCSTRING_THRESHOLD](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_PYTHON_DOCSTRING_THRESHOLD,
      !isNaN(value) && Number(value) > 0,
      'Must be a positive number'
    );
    return Number(value);
  },

  [CONFIG_KEYS.OCO_PYTHON_DOCSTRING_MODE](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_PYTHON_DOCSTRING_MODE,
      ['auto', 'always', 'never'].includes(value),
      "Must be 'auto', 'always', or 'never'"
    );
    return value;
  },

  [CONFIG_KEYS.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO](value: any) {
    const n = Number(value);
    validateConfig(
      CONFIG_KEYS.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO,
      !isNaN(n) && n >= 0 && n <= 1,
      'Must be a number between 0 and 1 (e.g. 0.9)'
    );
    return n;
  },

  [CONFIG_KEYS.OCO_MULTI_COMMIT_STRATEGY](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_MULTI_COMMIT_STRATEGY,
      ['single', 'sequential'].includes(value),
      "Must be 'single' or 'sequential'"
    );
    return value;
  },

  [CONFIG_KEYS.OCO_DEBUG](value: any) {
    if (typeof value === 'boolean') return value;
    const str = String(value).toLowerCase().trim();
    validateConfig(
      CONFIG_KEYS.OCO_DEBUG,
      ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(str),
      'Must be a boolean (true/false/1/0/yes/no)'
    );
    return ['true', '1', 'yes', 'on'].includes(str);
  },

  [CONFIG_KEYS.OCO_OPENAI_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_OPENAI_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_ANTHROPIC_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_ANTHROPIC_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_OPENROUTER_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_OPENROUTER_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_GEMINI_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_GEMINI_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_GROQ_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_GROQ_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_MISTRAL_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_MISTRAL_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_DEEPSEEK_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_DEEPSEEK_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_AIMLAPI_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_AIMLAPI_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_AZURE_KEY](value: any) {
    validateConfig(CONFIG_KEYS.OCO_AZURE_KEY, typeof value === 'string', 'Must be a string');
    return value;
  },

  [CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP](value: any) {
    const n = Number(value);
    validateConfig(
      CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP,
      Number.isInteger(n) && n >= 1,
      'Must be a positive integer (minimum 1)'
    );
    return n;
  },

  [CONFIG_KEYS.OCO_MAX_LINES_PER_GROUP](value: any) {
    const n = Number(value);
    validateConfig(
      CONFIG_KEYS.OCO_MAX_LINES_PER_GROUP,
      Number.isInteger(n) && n >= 1,
      'Must be a positive integer (minimum 1)'
    );
    return n;
  },

  [CONFIG_KEYS.OCO_TEMPERATURE](value: any) {
    const n = Number(value);
    validateConfig(
      CONFIG_KEYS.OCO_TEMPERATURE,
      !isNaN(n) && n >= 0 && n <= 2,
      'Must be a number between 0 and 2'
    );
    return n;
  },

  [CONFIG_KEYS.OCO_COMMIT_DETAIL](value: any) {
    validateConfig(
      CONFIG_KEYS.OCO_COMMIT_DETAIL,
      ['concise', 'normal', 'detailed'].includes(value),
      "Must be 'concise', 'normal', or 'detailed'"
    );
    return value;
  },

  [CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS](value: any) {
    const n = Number(value);
    validateConfig(
      CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS,
      !isNaN(n) && n >= 10,
      'Must be a positive integer >= 10 (seconds)'
    );
    return n;
  },

  [CONFIG_KEYS.OCO_FALLBACK_MODEL](value: any) {
    return typeof value === 'string' ? value : '';
  },

  [CONFIG_KEYS.OCO_FALLBACK_PROVIDER](value: any) {
    return typeof value === 'string' ? value : '';
  }
};

export enum OCO_AI_PROVIDER_ENUM {
  OLLAMA = 'ollama',
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  AZURE = 'azure',
  TEST = 'test',
  FLOWISE = 'flowise',
  GROQ = 'groq',
  MISTRAL = 'mistral',
  MLX = 'mlx',
  DEEPSEEK = 'deepseek',
  AIMLAPI = 'aimlapi',
  OPENROUTER = 'openrouter'
}

export const PROVIDER_API_KEY_URLS: Record<string, string | null> = {
  [OCO_AI_PROVIDER_ENUM.OPENAI]: 'https://platform.openai.com/api-keys',
  [OCO_AI_PROVIDER_ENUM.ANTHROPIC]: 'https://console.anthropic.com/settings/keys',
  [OCO_AI_PROVIDER_ENUM.GEMINI]: 'https://aistudio.google.com/app/apikey',
  [OCO_AI_PROVIDER_ENUM.GROQ]: 'https://console.groq.com/keys',
  [OCO_AI_PROVIDER_ENUM.MISTRAL]: 'https://console.mistral.ai/api-keys/',
  [OCO_AI_PROVIDER_ENUM.DEEPSEEK]: 'https://platform.deepseek.com/api_keys',
  [OCO_AI_PROVIDER_ENUM.OPENROUTER]: 'https://openrouter.ai/keys',
  [OCO_AI_PROVIDER_ENUM.AIMLAPI]: 'https://aimlapi.com/app/keys',
  [OCO_AI_PROVIDER_ENUM.AZURE]: 'https://portal.azure.com/',
  [OCO_AI_PROVIDER_ENUM.OLLAMA]: null,
  [OCO_AI_PROVIDER_ENUM.MLX]: null,
  [OCO_AI_PROVIDER_ENUM.FLOWISE]: null,
  [OCO_AI_PROVIDER_ENUM.TEST]: null
};

export const RECOMMENDED_MODELS: Record<string, string> = {
  [OCO_AI_PROVIDER_ENUM.OPENAI]: 'gpt-4o-mini',
  [OCO_AI_PROVIDER_ENUM.ANTHROPIC]: 'claude-sonnet-4-20250514',
  [OCO_AI_PROVIDER_ENUM.GEMINI]: 'gemini-1.5-flash',
  [OCO_AI_PROVIDER_ENUM.GROQ]: 'llama3-70b-8192',
  [OCO_AI_PROVIDER_ENUM.MISTRAL]: 'mistral-small-latest',
  [OCO_AI_PROVIDER_ENUM.DEEPSEEK]: 'deepseek-chat',
  [OCO_AI_PROVIDER_ENUM.OPENROUTER]: 'openai/gpt-4o-mini',
  [OCO_AI_PROVIDER_ENUM.AIMLAPI]: 'gpt-4o-mini'
}

export type ConfigType = {
  [CONFIG_KEYS.OCO_API_KEY]?: string;
  [CONFIG_KEYS.OCO_TOKENS_MAX_INPUT]: number;
  [CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT]: number;
  [CONFIG_KEYS.OCO_API_URL]?: string;
  [CONFIG_KEYS.OCO_API_CUSTOM_HEADERS]?: string;
  [CONFIG_KEYS.OCO_DESCRIPTION]: boolean;
  [CONFIG_KEYS.OCO_EMOJI]: boolean;
  [CONFIG_KEYS.OCO_WHY]: boolean;
  [CONFIG_KEYS.OCO_MODEL]: string;
  [CONFIG_KEYS.OCO_LANGUAGE]: string;
  [CONFIG_KEYS.OCO_MESSAGE_TEMPLATE_PLACEHOLDER]: string;
  [CONFIG_KEYS.OCO_PROMPT_MODULE]: OCO_PROMPT_MODULE_ENUM;
  [CONFIG_KEYS.OCO_AI_PROVIDER]: OCO_AI_PROVIDER_ENUM;
  [CONFIG_KEYS.OCO_GITPUSH]: boolean;
  [CONFIG_KEYS.OCO_ONE_LINE_COMMIT]: boolean;
  [CONFIG_KEYS.OCO_OMIT_SCOPE]: boolean;
  [CONFIG_KEYS.OCO_TEST_MOCK_TYPE]: string;
  [CONFIG_KEYS.OCO_HOOK_AUTO_UNCOMMENT]: boolean;
  // Cache
  [CONFIG_KEYS.OCO_CACHE_ENABLED]: boolean;
  [CONFIG_KEYS.OCO_CACHE_TTL_SECONDS]: number;
  // Diff routing
  [CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES]: number;
  [CONFIG_KEYS.OCO_PER_FILE_COMMIT_MODE]: string;
  [CONFIG_KEYS.OCO_PYTHON_DOCSTRING_THRESHOLD]: number;
  [CONFIG_KEYS.OCO_PYTHON_DOCSTRING_MODE]: string;
  [CONFIG_KEYS.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO]: number;
  // Multi-commit
  [CONFIG_KEYS.OCO_MULTI_COMMIT_STRATEGY]: string;
  // Debug
  [CONFIG_KEYS.OCO_DEBUG]: boolean;
  // Diff routing extras
  [CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP]: number;
  [CONFIG_KEYS.OCO_MAX_LINES_PER_GROUP]: number;
  // LLM generation
  [CONFIG_KEYS.OCO_TEMPERATURE]: number;
  [CONFIG_KEYS.OCO_COMMIT_DETAIL]: string;
  [CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS]: number;
  // Fallback model
  [CONFIG_KEYS.OCO_FALLBACK_MODEL]?: string;
  [CONFIG_KEYS.OCO_FALLBACK_PROVIDER]?: string;
  // Per-provider keys
  [CONFIG_KEYS.OCO_OPENAI_KEY]?: string;
  [CONFIG_KEYS.OCO_ANTHROPIC_KEY]?: string;
  [CONFIG_KEYS.OCO_OPENROUTER_KEY]?: string;
  [CONFIG_KEYS.OCO_GEMINI_KEY]?: string;
  [CONFIG_KEYS.OCO_GROQ_KEY]?: string;
  [CONFIG_KEYS.OCO_MISTRAL_KEY]?: string;
  [CONFIG_KEYS.OCO_DEEPSEEK_KEY]?: string;
  [CONFIG_KEYS.OCO_AIMLAPI_KEY]?: string;
  [CONFIG_KEYS.OCO_AZURE_KEY]?: string;
};

/** Preferred config location inside the data directory. */
export const defaultConfigPath = pathJoin(homedir(), '.opencommitx-data', 'config.ini');
/** Legacy config location — kept for backward-compat read fallback. */
export const legacyConfigPath = pathJoin(homedir(), '.opencommitx');
export const defaultEnvPath = pathResolve(process.cwd(), '.env');

const assertConfigsAreValid = (config: Record<string, any>) => {
  for (const [key, value] of Object.entries(config)) {
    if (!value) continue;

    if (typeof value === 'string' && ['null', 'undefined'].includes(value)) {
      config[key] = undefined;
      continue;
    }

    try {
      const validate = configValidators[key as CONFIG_KEYS];
      validate(value, config);
    } catch (error) {
      outro(`Unknown '${key}' config option or missing validator.`);
      outro(
        `Manually fix the '.env' file or global '~/.opencommitx' config file.`
      );

      process.exit(1);
    }
  }
};

enum OCO_PROMPT_MODULE_ENUM {
  CONVENTIONAL_COMMIT = 'conventional-commit',
  COMMITLINT = '@commitlint'
}

export const DEFAULT_CONFIG = {
  OCO_TOKENS_MAX_INPUT: DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_INPUT,
  OCO_TOKENS_MAX_OUTPUT: DEFAULT_TOKEN_LIMITS.DEFAULT_MAX_TOKENS_OUTPUT,
  OCO_DESCRIPTION: false,
  OCO_EMOJI: false,
  OCO_MODEL: getDefaultModel('openai'),
  OCO_LANGUAGE: 'en',
  OCO_MESSAGE_TEMPLATE_PLACEHOLDER: '$msg',
  OCO_PROMPT_MODULE: OCO_PROMPT_MODULE_ENUM.CONVENTIONAL_COMMIT,
  OCO_AI_PROVIDER: OCO_AI_PROVIDER_ENUM.OPENAI,
  OCO_ONE_LINE_COMMIT: false,
  OCO_TEST_MOCK_TYPE: 'commit-message',
  OCO_WHY: false,
  OCO_OMIT_SCOPE: false,
  OCO_GITPUSH: true, // todo: deprecate
  OCO_HOOK_AUTO_UNCOMMENT: false,
  // Cache defaults
  OCO_CACHE_ENABLED: true,
  OCO_CACHE_TTL_SECONDS: 3600,
  // Diff routing defaults
  OCO_PER_FILE_THRESHOLD_LINES: 300,
  OCO_PER_FILE_COMMIT_MODE: 'auto',
  OCO_PYTHON_DOCSTRING_THRESHOLD: 500,
  OCO_PYTHON_DOCSTRING_MODE: 'auto',
  // Only use docstrings when diff covers at least this fraction of the file.
  // Prevents extracting docstrings on partial refactors (use the real diff instead).
  OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO: 0.9,
  // Multi-commit default
  OCO_MULTI_COMMIT_STRATEGY: 'single',
  // Debug mode (off by default)
  OCO_DEBUG: false,
  // Diff routing extras
  OCO_MAX_FILES_PER_GROUP: 10,
  OCO_MAX_LINES_PER_GROUP: 1500,
  // LLM generation
  OCO_TEMPERATURE: 0,
  OCO_COMMIT_DETAIL: 'normal',
  OCO_GENERATION_TIMEOUT_SECONDS: 90,
  // Fallback model (empty = disabled)
  OCO_FALLBACK_MODEL: '',
  OCO_FALLBACK_PROVIDER: ''
};

const initGlobalConfig = (configPath: string = defaultConfigPath) => {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, iniStringify(DEFAULT_CONFIG), 'utf8');
  return DEFAULT_CONFIG;
};

const parseConfigVarValue = (value?: any) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
};

const getEnvConfig = (envPath: string) => {
  dotenv.config({ path: envPath });

  return {
    OCO_MODEL: process.env.OCO_MODEL,
    OCO_API_URL: process.env.OCO_API_URL,
    OCO_API_KEY: process.env.OCO_API_KEY,
    OCO_API_CUSTOM_HEADERS: process.env.OCO_API_CUSTOM_HEADERS,
    OCO_AI_PROVIDER: process.env.OCO_AI_PROVIDER as OCO_AI_PROVIDER_ENUM,

    OCO_TOKENS_MAX_INPUT: parseConfigVarValue(process.env.OCO_TOKENS_MAX_INPUT),
    OCO_TOKENS_MAX_OUTPUT: parseConfigVarValue(
      process.env.OCO_TOKENS_MAX_OUTPUT
    ),

    OCO_DESCRIPTION: parseConfigVarValue(process.env.OCO_DESCRIPTION),
    OCO_EMOJI: parseConfigVarValue(process.env.OCO_EMOJI),
    OCO_LANGUAGE: process.env.OCO_LANGUAGE,
    OCO_MESSAGE_TEMPLATE_PLACEHOLDER:
      process.env.OCO_MESSAGE_TEMPLATE_PLACEHOLDER,
    OCO_PROMPT_MODULE: process.env.OCO_PROMPT_MODULE as OCO_PROMPT_MODULE_ENUM,
    OCO_ONE_LINE_COMMIT: parseConfigVarValue(process.env.OCO_ONE_LINE_COMMIT),
    OCO_TEST_MOCK_TYPE: process.env.OCO_TEST_MOCK_TYPE,
    OCO_OMIT_SCOPE: parseConfigVarValue(process.env.OCO_OMIT_SCOPE),

    OCO_GITPUSH: parseConfigVarValue(process.env.OCO_GITPUSH), // todo: deprecate
    // Cache
    OCO_CACHE_ENABLED: parseConfigVarValue(process.env.OCO_CACHE_ENABLED),
    OCO_CACHE_TTL_SECONDS: parseConfigVarValue(process.env.OCO_CACHE_TTL_SECONDS),
    // Diff routing
    OCO_PER_FILE_THRESHOLD_LINES: parseConfigVarValue(process.env.OCO_PER_FILE_THRESHOLD_LINES),
    OCO_PER_FILE_COMMIT_MODE: process.env.OCO_PER_FILE_COMMIT_MODE,
    OCO_PYTHON_DOCSTRING_THRESHOLD: parseConfigVarValue(process.env.OCO_PYTHON_DOCSTRING_THRESHOLD),
    OCO_PYTHON_DOCSTRING_MODE: process.env.OCO_PYTHON_DOCSTRING_MODE,
    OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO: parseConfigVarValue(
      process.env.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO
    ),
    // Multi-commit
    OCO_MULTI_COMMIT_STRATEGY: process.env.OCO_MULTI_COMMIT_STRATEGY,
    // Debug
    OCO_DEBUG: parseConfigVarValue(process.env.OCO_DEBUG),
    // Per-provider keys
    OCO_OPENAI_KEY: process.env.OCO_OPENAI_KEY,
    OCO_ANTHROPIC_KEY: process.env.OCO_ANTHROPIC_KEY,
    OCO_OPENROUTER_KEY: process.env.OCO_OPENROUTER_KEY,
    OCO_GEMINI_KEY: process.env.OCO_GEMINI_KEY,
    OCO_GROQ_KEY: process.env.OCO_GROQ_KEY,
    OCO_MISTRAL_KEY: process.env.OCO_MISTRAL_KEY,
    OCO_DEEPSEEK_KEY: process.env.OCO_DEEPSEEK_KEY,
    OCO_AIMLAPI_KEY: process.env.OCO_AIMLAPI_KEY,
    OCO_AZURE_KEY: process.env.OCO_AZURE_KEY,
    // Diff routing extras
    OCO_MAX_FILES_PER_GROUP: parseConfigVarValue(process.env.OCO_MAX_FILES_PER_GROUP),
    OCO_MAX_LINES_PER_GROUP: parseConfigVarValue(process.env.OCO_MAX_LINES_PER_GROUP),
    // LLM generation
    OCO_TEMPERATURE: parseConfigVarValue(process.env.OCO_TEMPERATURE),
    OCO_COMMIT_DETAIL: process.env.OCO_COMMIT_DETAIL,
    OCO_GENERATION_TIMEOUT_SECONDS: parseConfigVarValue(process.env.OCO_GENERATION_TIMEOUT_SECONDS),
    // Fallback model
    OCO_FALLBACK_MODEL: process.env.OCO_FALLBACK_MODEL,
    OCO_FALLBACK_PROVIDER: process.env.OCO_FALLBACK_PROVIDER
  };
};

export const setGlobalConfig = (
  config: ConfigType,
  configPath: string = defaultConfigPath
) => {
  // Ensure the parent directory exists (e.g. ~/.opencommitx-data/).
  try { mkdirSync(dirname(configPath), { recursive: true }); } catch { /* ignore */ }
  writeFileSync(configPath, iniStringify(config), 'utf8');
};

/**
 * Check if a config file exists.
 * When called with the default (production) path, also checks the legacy
 * path (~/.opencommitx) so existing installs work before migration runs.
 * When called with an explicit custom path (e.g. test temp dirs), only
 * checks that specific path to avoid false positives.
 */
export const getIsGlobalConfigFileExist = (
  configPath: string = defaultConfigPath
) => {
  if (existsSync(configPath)) return true;
  // Only fall back to the legacy path when the caller is using the default location.
  if (configPath === defaultConfigPath) return existsSync(legacyConfigPath);
  return false;
};

/**
 * Read the global config. When called with the default path, falls back to the
 * legacy path (~/.opencommitx) so existing installs work before migration.
 * When called with an explicit custom path (e.g. test temp dirs), only reads
 * that specific path — no legacy fallback.
 */
export const getGlobalConfig = (configPath: string = defaultConfigPath) => {
  // Only check the legacy path when using the default production location.
  const resolvedPath = existsSync(configPath)
    ? configPath
    : (configPath === defaultConfigPath && existsSync(legacyConfigPath))
      ? legacyConfigPath
      : configPath;

  let globalConfig: ConfigType;

  if (!existsSync(resolvedPath)) {
    globalConfig = initGlobalConfig(configPath);
  } else {
    const configFile = readFileSync(resolvedPath, 'utf8');
    globalConfig = iniParse(configFile) as ConfigType;
  }

  return globalConfig;
};

/**
 * Merges two configs.
 * Env config takes precedence over global ~/.opencommitx config file
 * @param main - env config
 * @param fallback - global ~/.opencommitx config file
 * @returns merged config
 */
const mergeConfigs = (main: Partial<ConfigType>, fallback: ConfigType) => {
  const allKeys = new Set([...Object.keys(main), ...Object.keys(fallback)]);
  return Array.from(allKeys).reduce((acc, key) => {
    acc[key] = parseConfigVarValue(main[key] ?? fallback[key]);
    return acc;
  }, {} as ConfigType);
};

interface GetConfigOptions {
  globalPath?: string;
  envPath?: string;
  setDefaultValues?: boolean;
}

const cleanUndefinedValues = (config: ConfigType) => {
  return Object.fromEntries(
    Object.entries(config).map(([_, v]) => {
      try {
        if (typeof v === 'string') {
          if (v === 'undefined') return [_, undefined];
          if (v === 'null') return [_, null];

          const parsedValue = JSON.parse(v);
          return [_, parsedValue];
        }
        return [_, v];
      } catch (error) {
        return [_, v];
      }
    })
  );
};

export const getConfig = ({
  envPath = defaultEnvPath,
  globalPath = defaultConfigPath
}: GetConfigOptions = {}): ConfigType => {
  const envConfig = getEnvConfig(envPath);
  const globalConfig = getGlobalConfig(globalPath);

  const config = mergeConfigs(envConfig, globalConfig);

  const cleanConfig = cleanUndefinedValues(config);

  return cleanConfig as ConfigType;
};

export const setConfig = (
  keyValues: [key: string, value: string | boolean | number | null][],
  globalConfigPath: string = defaultConfigPath
) => {
  const config = getConfig({
    globalPath: globalConfigPath
  });

  const configToSet = {};

  for (let [key, value] of keyValues) {
    if (!configValidators.hasOwnProperty(key)) {
      const supportedKeys = Object.keys(configValidators).join('\n');
      throw new Error(
        `Unsupported config key: ${key}. Expected keys are:\n\n${supportedKeys}.\n\nFor more help refer to our docs: https://github.com/xwberry/opencommitx`
      );
    }

    let parsedConfigValue;

    try {
      if (typeof value === 'string') parsedConfigValue = JSON.parse(value);
      else parsedConfigValue = value;
    } catch (error) {
      parsedConfigValue = value;
    }

    const validValue = configValidators[key as CONFIG_KEYS](
      parsedConfigValue,
      config
    );

    configToSet[key] = validValue;
  }

  setGlobalConfig(mergeConfigs(configToSet, config), globalConfigPath);

  outro(`${chalk.green('✔')} config successfully set`);
};

// --- HELP MESSAGE GENERATION ---
function getConfigKeyDetails(key) {
  switch (key) {
    case CONFIG_KEYS.OCO_MODEL:
      return {
        description: 'The AI model to use for generating commit messages',
        values: MODEL_LIST
      };
    case CONFIG_KEYS.OCO_AI_PROVIDER:
      return {
        description: 'The AI provider to use',
        values: Object.values(OCO_AI_PROVIDER_ENUM)
      };
    case CONFIG_KEYS.OCO_PROMPT_MODULE:
      return {
        description: 'The prompt module to use for commit message generation',
        values: Object.values(OCO_PROMPT_MODULE_ENUM)
      };
    case CONFIG_KEYS.OCO_LANGUAGE:
      return {
        description: 'The locale to use for commit messages',
        values: Object.keys(i18n)
      };
    case CONFIG_KEYS.OCO_TEST_MOCK_TYPE:
      return {
        description: 'The type of test mock to use',
        values: ['commit-message', 'prompt-module-commitlint-config']
      };
    case CONFIG_KEYS.OCO_ONE_LINE_COMMIT:
      return {
        description: 'One line commit message',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_DESCRIPTION:
      return {
        description:
          'Postface a message with ~3 sentences description of the changes',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_EMOJI:
      return {
        description: 'Preface a message with GitMoji',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_WHY:
      return {
        description:
          'Output a short description of why the changes were done after the commit message (default: false)',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_OMIT_SCOPE:
      return {
        description: 'Do not include a scope in the commit message',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_GITPUSH:
      return {
        description:
          'Push to git after commit (deprecated). If false, oco will exit after committing',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_TOKENS_MAX_INPUT:
      return {
        description: 'Max model token limit',
        values: ['Any positive integer']
      };
    case CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT:
      return {
        description: 'Max response tokens',
        values: ['Any positive integer']
      };
    case CONFIG_KEYS.OCO_API_KEY:
      return {
        description: 'API key for the selected provider',
        values: ['String (required for most providers)']
      };
    case CONFIG_KEYS.OCO_API_URL:
      return {
        description:
          'Custom API URL - may be used to set proxy path to OpenAI API',
        values: ["URL string (must start with 'http://' or 'https://')"]
      };
    case CONFIG_KEYS.OCO_MESSAGE_TEMPLATE_PLACEHOLDER:
      return {
        description: 'Message template placeholder',
        values: ['String (must start with $)']
      };
    case CONFIG_KEYS.OCO_HOOK_AUTO_UNCOMMENT:
      return {
        description: 'Automatically uncomment the commit message in the hook',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_CACHE_ENABLED:
      return {
        description: 'Cache LLM commit message results to avoid re-generating on pre-commit hook failures',
        values: ['true', 'false']
      };
    case CONFIG_KEYS.OCO_CACHE_TTL_SECONDS:
      return {
        description: 'How long (in seconds) to keep cached commit messages before expiring',
        values: ['Any positive integer (default: 3600)']
      };
    case CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES:
      return {
        description: 'Line change threshold above which a file gets its own separate commit message',
        values: ['Any positive integer (default: 300)']
      };
    case CONFIG_KEYS.OCO_PER_FILE_COMMIT_MODE:
      return {
        description: 'Controls whether files are committed individually or aggregated',
        values: ['auto (smart routing)', 'always (always per-file)', 'never (always aggregate)']
      };
    case CONFIG_KEYS.OCO_PYTHON_DOCSTRING_THRESHOLD:
      return {
        description: 'For Python files: line change count above which only docstrings are extracted instead of full diff',
        values: ['Any positive integer (default: 500)']
      };
    case CONFIG_KEYS.OCO_PYTHON_DOCSTRING_MODE:
      return {
        description: 'Controls docstring-only extraction for large Python files',
        values: ['auto', 'always', 'never']
      };
    case CONFIG_KEYS.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO:
      return {
        description:
          'For Python docstring mode: minimum changed-lines/file-lines ratio required in auto mode to activate docstring extraction',
        values: ['Number between 0 and 1 (default: 0.9)']
      };
    case CONFIG_KEYS.OCO_MULTI_COMMIT_STRATEGY:
      return {
        description: 'When multiple commit messages are generated, controls how they are committed',
        values: ['single (join all into one commit)', 'sequential (one commit per message)']
      };
    case CONFIG_KEYS.OCO_DEBUG:
      return {
        description: 'Write full prompts and LLM responses to ~/.opencommitx-data/debug/ for troubleshooting',
        values: ['true', 'false (default)']
      };
    case CONFIG_KEYS.OCO_OPENAI_KEY:
      return { description: 'API key for OpenAI (overrides OCO_API_KEY when provider is openai)', values: ['sk-...'] };
    case CONFIG_KEYS.OCO_ANTHROPIC_KEY:
      return { description: 'API key for Anthropic (overrides OCO_API_KEY when provider is anthropic)', values: ['sk-ant-...'] };
    case CONFIG_KEYS.OCO_OPENROUTER_KEY:
      return { description: 'API key for OpenRouter (overrides OCO_API_KEY when provider is openrouter)', values: ['sk-or-...'] };
    case CONFIG_KEYS.OCO_GEMINI_KEY:
      return { description: 'API key for Google Gemini (overrides OCO_API_KEY when provider is gemini)', values: ['String'] };
    case CONFIG_KEYS.OCO_GROQ_KEY:
      return { description: 'API key for Groq (overrides OCO_API_KEY when provider is groq)', values: ['gsk_...'] };
    case CONFIG_KEYS.OCO_MISTRAL_KEY:
      return { description: 'API key for Mistral AI (overrides OCO_API_KEY when provider is mistral)', values: ['String'] };
    case CONFIG_KEYS.OCO_DEEPSEEK_KEY:
      return { description: 'API key for DeepSeek (overrides OCO_API_KEY when provider is deepseek)', values: ['String'] };
    case CONFIG_KEYS.OCO_AIMLAPI_KEY:
      return { description: 'API key for AI/ML API (overrides OCO_API_KEY when provider is aimlapi)', values: ['String'] };
    case CONFIG_KEYS.OCO_AZURE_KEY:
      return { description: 'API key for Azure OpenAI (overrides OCO_API_KEY when provider is azure)', values: ['String'] };
    case CONFIG_KEYS.OCO_TEMPERATURE:
      return {
        description: 'LLM sampling temperature. 0 = deterministic; higher = more creative (0–2)',
        values: ['Number 0.0–2.0 (default: 0)']
      };
    case CONFIG_KEYS.OCO_COMMIT_DETAIL:
      return {
        description: 'Controls prompt verbosity: concise forces a one-liner, detailed asks for description + reasoning',
        values: ['concise', 'normal (default)', 'detailed']
      };
    case CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS:
      return {
        description: 'Per-group LLM generation timeout. Increase for slow models or networks',
        values: ['Positive integer ≥ 10 (default: 90)']
      };
    case CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP:
      return {
        description: 'Maximum number of files in a single commit group (auto mode)',
        values: ['Positive integer (default: 10)']
      };
    case CONFIG_KEYS.OCO_MAX_LINES_PER_GROUP:
      return {
        description: 'Maximum total changed lines (added+deleted) in a single commit group (auto mode). Prevents oversized groups when many small files are staged.',
        values: ['Positive integer (default: 1500)']
      };
    case CONFIG_KEYS.OCO_FALLBACK_MODEL:
      return {
        description: 'Model to retry with on rate-limit or unavailability errors. Leave empty to disable fallback.',
        values: ['Model ID string (e.g. anthropic/claude-3-5-haiku or claude-3-5-haiku-20241022)']
      };
    case CONFIG_KEYS.OCO_FALLBACK_PROVIDER:
      return {
        description: 'Provider for OCO_FALLBACK_MODEL. Needed when the fallback model naming convention differs from the primary provider (e.g. OpenRouter uses "provider/model").',
        values: Object.values(OCO_AI_PROVIDER_ENUM)
      };
    default:
      return {
        description: 'String value',
        values: ['Any string']
      };
  }
}

function printConfigKeyHelp(param) {
  if (!Object.values(CONFIG_KEYS).includes(param)) {
    console.log(chalk.red(`Unknown config parameter: ${param}`));
    return;
  }

  const details = getConfigKeyDetails(param as CONFIG_KEYS);
  const currentConfig = getGlobalConfig();

  let desc = details.description;
  let defaultValue = undefined;
  if (param in DEFAULT_CONFIG) {
    defaultValue = DEFAULT_CONFIG[param];
  }

  const currentValue = currentConfig[param as keyof typeof currentConfig];

  console.log(chalk.bold(`\n${param}:`));
  console.log(chalk.gray(`  Description: ${desc}`));
  if (defaultValue !== undefined) {
    console.log(chalk.gray(`  Default: ${defaultValue}`));
  }

  if (currentValue !== undefined && currentValue !== null) {
    const source = getIsGlobalConfigFileExist() ? '~/.opencommitx-data/config.ini' : '.env';
    console.log(chalk.cyan(`  Current: ${currentValue}`) + chalk.dim(` (from ${source})`));
  } else {
    console.log(chalk.dim('  Current: (not set)'));
  }

  if (Array.isArray(details.values)) {
    console.log(chalk.gray('  Accepted values:'));
    details.values.forEach((value) => {
      console.log(chalk.gray(`    - ${value}`));
    });
  } else {
    console.log(chalk.gray('  Accepted values by provider:'));
    Object.entries(details.values).forEach(([provider, values]) => {
      console.log(chalk.gray(`    ${provider}:`));
      (values as string[]).forEach((value) => {
        console.log(chalk.gray(`      - ${value}`));
      });
    });
  }
}

/** Thematic display order for `ocox config describe`. */
const THEMATIC_KEY_ORDER: CONFIG_KEYS[] = [
  // Provider & Model
  CONFIG_KEYS.OCO_AI_PROVIDER,
  CONFIG_KEYS.OCO_MODEL,
  CONFIG_KEYS.OCO_API_KEY,
  CONFIG_KEYS.OCO_API_URL,
  CONFIG_KEYS.OCO_API_CUSTOM_HEADERS,
  CONFIG_KEYS.OCO_OPENAI_KEY,
  CONFIG_KEYS.OCO_ANTHROPIC_KEY,
  CONFIG_KEYS.OCO_OPENROUTER_KEY,
  CONFIG_KEYS.OCO_GEMINI_KEY,
  CONFIG_KEYS.OCO_GROQ_KEY,
  CONFIG_KEYS.OCO_MISTRAL_KEY,
  CONFIG_KEYS.OCO_DEEPSEEK_KEY,
  CONFIG_KEYS.OCO_AIMLAPI_KEY,
  CONFIG_KEYS.OCO_AZURE_KEY,
  // Fallback
  CONFIG_KEYS.OCO_FALLBACK_MODEL,
  CONFIG_KEYS.OCO_FALLBACK_PROVIDER,
  // Token limits
  CONFIG_KEYS.OCO_TOKENS_MAX_INPUT,
  CONFIG_KEYS.OCO_TOKENS_MAX_OUTPUT,
  // Generation
  CONFIG_KEYS.OCO_TEMPERATURE,
  CONFIG_KEYS.OCO_COMMIT_DETAIL,
  CONFIG_KEYS.OCO_GENERATION_TIMEOUT_SECONDS,
  // Commit format
  CONFIG_KEYS.OCO_PROMPT_MODULE,
  CONFIG_KEYS.OCO_DESCRIPTION,
  CONFIG_KEYS.OCO_WHY,
  CONFIG_KEYS.OCO_EMOJI,
  CONFIG_KEYS.OCO_ONE_LINE_COMMIT,
  CONFIG_KEYS.OCO_OMIT_SCOPE,
  CONFIG_KEYS.OCO_LANGUAGE,
  CONFIG_KEYS.OCO_MESSAGE_TEMPLATE_PLACEHOLDER,
  // Diff routing
  CONFIG_KEYS.OCO_PER_FILE_COMMIT_MODE,
  CONFIG_KEYS.OCO_PER_FILE_THRESHOLD_LINES,
  CONFIG_KEYS.OCO_MAX_FILES_PER_GROUP,
  CONFIG_KEYS.OCO_MAX_LINES_PER_GROUP,
  // Multi-commit
  CONFIG_KEYS.OCO_MULTI_COMMIT_STRATEGY,
  // Python docstrings
  CONFIG_KEYS.OCO_PYTHON_DOCSTRING_MODE,
  CONFIG_KEYS.OCO_PYTHON_DOCSTRING_THRESHOLD,
  CONFIG_KEYS.OCO_PYTHON_DOCSTRING_WHOLE_FILE_RATIO,
  // Cache
  CONFIG_KEYS.OCO_CACHE_ENABLED,
  CONFIG_KEYS.OCO_CACHE_TTL_SECONDS,
  // Debug & Advanced
  CONFIG_KEYS.OCO_DEBUG,
  CONFIG_KEYS.OCO_HOOK_AUTO_UNCOMMENT,
  CONFIG_KEYS.OCO_GITPUSH,
  CONFIG_KEYS.OCO_TEST_MOCK_TYPE,
];

function printAllConfigHelp() {
  const currentConfig = getIsGlobalConfigFileExist() ? getGlobalConfig() : {} as any;
  const configFileSource = getIsGlobalConfigFileExist() ? '~/.opencommitx-data/config.ini' : '(no config file)';

  console.log(chalk.bold('Available config parameters:'));
  console.log(chalk.dim(`  Current values loaded from: ${configFileSource}\n`));

  // Use thematic order, then append any keys not yet in the list.
  const allKeys = new Set(Object.values(CONFIG_KEYS));
  const orderedKeys = [
    ...THEMATIC_KEY_ORDER.filter((k) => allKeys.has(k)),
    ...Object.values(CONFIG_KEYS).filter((k) => !THEMATIC_KEY_ORDER.includes(k)).sort()
  ];

  for (const key of orderedKeys) {
    const details = getConfigKeyDetails(key);
    let defaultValue = undefined;
    if (key in DEFAULT_CONFIG) {
      defaultValue = DEFAULT_CONFIG[key];
    }

    const currentValue = currentConfig[key as keyof typeof currentConfig];

    console.log(chalk.bold(`\n${key}:`));
    console.log(chalk.gray(`  Description: ${details.description}`));
    if (defaultValue !== undefined) {
      console.log(chalk.gray(`  Default: ${defaultValue}`));
    }
    if (currentValue !== undefined && currentValue !== null) {
      console.log(chalk.cyan(`  Current: ${currentValue}`));
    }
  }
  console.log(
    chalk.yellow(
      '\nUse "ocox config describe [PARAMETER]" to see accepted values and more details for a specific config parameter.'
    )
  );
}

export const configCommand = command(
  {
    name: COMMANDS.config,
    parameters: ['<mode>', '[key=values...]'],
    help: {
      description: 'Configure opencommit settings',
      examples: [
        'Describe all config parameters: ocox config describe',
        'Describe a specific parameter: ocox config describe OCO_MODEL',
        'Get a config value: ocox config get OCO_MODEL',
        'Set a config value: ocox config set OCO_MODEL=gpt-4 (or: ocox config set OCO_MODEL gpt-4)'
      ]
    }
  },
  async (argv) => {
    try {
      const { mode, keyValues } = argv._;
      intro(`COMMAND: config ${mode} ${keyValues}`);

      if (mode === CONFIG_MODES.describe) {
        if (!keyValues || keyValues.length === 0) {
          printAllConfigHelp();
        } else {
          for (const key of keyValues) {
            printConfigKeyHelp(key);
          }
        }
        process.exit(0);
      } else if (mode === CONFIG_MODES.get) {
        if (!keyValues || keyValues.length === 0) {
          throw new Error('No config keys specified for get mode');
        }
        const config = getConfig() || {};
        for (const key of keyValues) {
          outro(`${key}=${config[key as keyof typeof config]}`);
        }
      } else if (mode === CONFIG_MODES.set) {
        if (!keyValues || keyValues.length === 0) {
          throw new Error('No config keys specified for set mode');
        }
        // Normalise both "KEY=VALUE" and "KEY VALUE" (space-separated) styles.
        const normalized: string[] = [];
        for (let i = 0; i < keyValues.length; i++) {
          if (!keyValues[i].includes('=') && i + 1 < keyValues.length) {
            normalized.push(`${keyValues[i]}=${keyValues[i + 1]}`);
            i++;
          } else {
            normalized.push(keyValues[i]);
          }
        }
        await setConfig(
          normalized.map((kv) => {
            const eqIdx = kv.indexOf('=');
            return eqIdx === -1
              ? ([kv, ''] as [string, string])
              : ([kv.slice(0, eqIdx), kv.slice(eqIdx + 1)] as [string, string]);
          })
        );
      } else {
        throw new Error(
          `Unsupported mode: ${mode}. Valid modes are: "set", "get", and "describe"`
        );
      }
    } catch (error) {
      outro(`${chalk.red('✖')} ${error}`);
      process.exit(1);
    }
  }
);
