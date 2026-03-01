import { getProviderApiKey } from '../../src/utils/providerKeys';
import type { ConfigType } from '../../src/commands/config';

describe('getProviderApiKey', () => {
  const baseConfig: Partial<ConfigType> = {
    OCO_API_KEY: 'generic-key'
  } as any;

  it('returns generic key when no provider-specific key is set', () => {
    const config = { ...baseConfig } as any;
    expect(getProviderApiKey(config, 'openai')).toBe('generic-key');
  });

  it('prefers OCO_OPENAI_KEY over OCO_API_KEY', () => {
    const config = { ...baseConfig, OCO_OPENAI_KEY: 'openai-specific' } as any;
    expect(getProviderApiKey(config, 'openai')).toBe('openai-specific');
  });

  it('prefers OCO_ANTHROPIC_KEY for anthropic provider', () => {
    const config = { ...baseConfig, OCO_ANTHROPIC_KEY: 'anthropic-specific' } as any;
    expect(getProviderApiKey(config, 'anthropic')).toBe('anthropic-specific');
  });

  it('prefers OCO_OPENROUTER_KEY for openrouter provider', () => {
    const config = { ...baseConfig, OCO_OPENROUTER_KEY: 'or-key' } as any;
    expect(getProviderApiKey(config, 'openrouter')).toBe('or-key');
  });

  it('prefers OCO_GEMINI_KEY for gemini provider', () => {
    const config = { ...baseConfig, OCO_GEMINI_KEY: 'gemini-key' } as any;
    expect(getProviderApiKey(config, 'gemini')).toBe('gemini-key');
  });

  it('falls back to generic key for unknown provider', () => {
    const config = { ...baseConfig } as any;
    expect(getProviderApiKey(config, 'flowise')).toBe('generic-key');
  });

  it('returns empty string when neither provider key nor generic key is set', () => {
    const config = {} as any;
    expect(getProviderApiKey(config, 'openai')).toBe('');
  });

  it('does not use another provider key for a different provider', () => {
    const config = {
      OCO_OPENAI_KEY: 'openai-key',
      OCO_ANTHROPIC_KEY: 'anthropic-key'
    } as any;
    expect(getProviderApiKey(config, 'anthropic')).toBe('anthropic-key');
    expect(getProviderApiKey(config, 'openai')).toBe('openai-key');
    expect(getProviderApiKey(config, 'gemini')).toBe('');
  });
});
