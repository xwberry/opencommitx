import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

const CUSTOM_MODELS_FILE = pathJoin(
  homedir(),
  '.opencommitx-custom-models.json'
);

type CustomModelStore = Record<string, string[]>;

function readCustomModels(): CustomModelStore {
  if (!existsSync(CUSTOM_MODELS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CUSTOM_MODELS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeCustomModels(store: CustomModelStore): void {
  try {
    writeFileSync(CUSTOM_MODELS_FILE, JSON.stringify(store, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
  } catch {
    // Best-effort persistence; keep CLI operations functional.
  }
}

export function getCustomModels(provider: string): string[] {
  const store = readCustomModels();
  return store[provider.toLowerCase()] || [];
}

export function getAllCustomModels(): CustomModelStore {
  return readCustomModels();
}

export function addCustomModel(provider: string, model: string): void {
  const store = readCustomModels();
  const key = provider.toLowerCase();
  if (!store[key]) store[key] = [];
  if (!store[key].includes(model)) {
    store[key].push(model);
    writeCustomModels(store);
  }
}

export function removeCustomModel(provider: string, model: string): boolean {
  const store = readCustomModels();
  const key = provider.toLowerCase();
  if (!store[key]) return false;
  const index = store[key].indexOf(model);
  if (index === -1) return false;
  store[key].splice(index, 1);
  if (store[key].length === 0) delete store[key];
  writeCustomModels(store);
  return true;
}

export function mergeWithCustomModels(
  builtIn: Record<string, string[]>
): Record<string, string[]> {
  const custom = readCustomModels();
  const merged = { ...builtIn };
  for (const [provider, models] of Object.entries(custom)) {
    if (!merged[provider]) merged[provider] = [];
    const toPrepend = models.filter(
      (model) => !merged[provider].includes(model)
    );
    merged[provider] = [...toPrepend, ...merged[provider]];
  }
  return merged;
}
