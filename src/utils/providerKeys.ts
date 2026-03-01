import type { ConfigType } from '../commands/config';

/**
 * Returns the API key for the given provider, preferring the provider-specific
 * key (OCO_<PROVIDER>_KEY) over the generic OCO_API_KEY.
 */
export function getProviderApiKey(
  config: Partial<ConfigType>,
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
