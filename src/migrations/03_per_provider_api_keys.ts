import {
  getConfig,
  getGlobalConfig,
  setGlobalConfig
} from '../commands/config';

/**
 * Migration 03: Copy OCO_API_KEY to the provider-specific key if the
 * provider-specific key is not already set.
 */
export default function migration03() {
  const config = getConfig();
  const provider = config.OCO_AI_PROVIDER;

  if (!provider || !config.OCO_API_KEY) return;

  const providerKeyName = `OCO_${provider.toUpperCase()}_KEY`;

  if (config[providerKeyName as keyof typeof config]) return;

  const globalConfig = getGlobalConfig();

  setGlobalConfig({
    ...globalConfig,
    [providerKeyName]: config.OCO_API_KEY
  } as any);
}
