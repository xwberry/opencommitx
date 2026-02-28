import { getConfig, OCO_AI_PROVIDER_ENUM } from '../commands/config';
import { AnthropicEngine } from '../engine/anthropic';
import { AzureEngine } from '../engine/azure';
import { AiEngine } from '../engine/Engine';
import { FlowiseEngine } from '../engine/flowise';
import { GeminiEngine } from '../engine/gemini';
import { OllamaEngine } from '../engine/ollama';
import { OpenAiEngine } from '../engine/openAi';
import { MistralAiEngine } from '../engine/mistral';
import { TestAi, TestMockType } from '../engine/testAi';
import { GroqEngine } from '../engine/groq';
import { MLXEngine } from '../engine/mlx';
import { DeepseekEngine } from '../engine/deepseek';
import { AimlApiEngine } from '../engine/aimlapi';
import { OpenRouterEngine } from '../engine/openrouter';

export function parseCustomHeaders(headers: any): Record<string, string> {
  let parsedHeaders = {};

  if (!headers) {
    return parsedHeaders;
  }

  try {
    if (typeof headers === 'object' && !Array.isArray(headers)) {
      parsedHeaders = headers;
    } else {
      parsedHeaders = JSON.parse(headers);
    }
  } catch (error) {
    console.warn(
      'Invalid OCO_API_CUSTOM_HEADERS format, ignoring custom headers'
    );
  }

  return parsedHeaders;
}

/**
 * Returns the API key for the given provider, preferring the provider-specific
 * key (OCO_<PROVIDER>_KEY) over the generic OCO_API_KEY.
 */
export function getProviderApiKey(
  config: ReturnType<typeof getConfig>,
  provider: string
): string {
  const providerKeyMap: Record<string, string | undefined> = {
    openai: config.OCO_OPENAI_KEY,
    anthropic: config.OCO_ANTHROPIC_KEY,
    openrouter: config.OCO_OPENROUTER_KEY,
    gemini: config.OCO_GEMINI_KEY,
    groq: config.OCO_GROQ_KEY,
    mistral: config.OCO_MISTRAL_KEY,
    deepseek: config.OCO_DEEPSEEK_KEY,
    aimlapi: config.OCO_AIMLAPI_KEY,
    azure: config.OCO_AZURE_KEY
  };

  return providerKeyMap[provider] || config.OCO_API_KEY || '';
}

export function getEngine(): AiEngine {
  const config = getConfig();
  const provider = config.OCO_AI_PROVIDER;

  const customHeaders = parseCustomHeaders(config.OCO_API_CUSTOM_HEADERS);

  const apiKey = getProviderApiKey(config, provider);

  const DEFAULT_CONFIG = {
    model: config.OCO_MODEL!,
    maxTokensOutput: config.OCO_TOKENS_MAX_OUTPUT!,
    maxTokensInput: config.OCO_TOKENS_MAX_INPUT!,
    baseURL: config.OCO_API_URL!,
    apiKey,
    customHeaders
  };

  switch (provider) {
    case OCO_AI_PROVIDER_ENUM.OLLAMA:
      return new OllamaEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.ANTHROPIC:
      return new AnthropicEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.TEST:
      return new TestAi(config.OCO_TEST_MOCK_TYPE as TestMockType);

    case OCO_AI_PROVIDER_ENUM.GEMINI:
      return new GeminiEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.AZURE:
      return new AzureEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.FLOWISE:
      return new FlowiseEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.GROQ:
      return new GroqEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.MISTRAL:
      return new MistralAiEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.MLX:
      return new MLXEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.DEEPSEEK:
      return new DeepseekEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.AIMLAPI:
      return new AimlApiEngine(DEFAULT_CONFIG);

    case OCO_AI_PROVIDER_ENUM.OPENROUTER:
      return new OpenRouterEngine(DEFAULT_CONFIG);

    default:
      return new OpenAiEngine(DEFAULT_CONFIG);
  }
}
