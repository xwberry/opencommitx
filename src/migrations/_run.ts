import fs from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';
import { migrations } from './_migrations';
import { outro } from '@clack/prompts';
import chalk from 'chalk';
import {
  getConfig,
  getIsGlobalConfigFileExist,
  OCO_AI_PROVIDER_ENUM
} from '../commands/config';

/** New migrations tracking file — uses the opencommitx name. */
const migrationsFile = pathJoin(homedir(), '.opencommitx_migrations');
/** Legacy tracking file from the upstream opencommit project. */
const legacyMigrationsFile = pathJoin(homedir(), '.opencommit_migrations');

/**
 * On first run with the new tracking file, migrate the legacy file.
 * Rules:
 *   1. If new file does not exist AND legacy file exists: copy legacy entries
 *      to new file, then delete the legacy file.
 *   2. If new file already exists: delete legacy file if it still exists.
 *   3. If neither exists: no-op (new install, starts fresh).
 */
const migrateLegacyMigrationsFile = (): void => {
  const newExists = fs.existsSync(migrationsFile);
  const oldExists = fs.existsSync(legacyMigrationsFile);

  if (!newExists && oldExists) {
    // Copy old entries to new file so previously-run migrations aren't re-run.
    const data = fs.readFileSync(legacyMigrationsFile, 'utf-8');
    fs.writeFileSync(migrationsFile, data);
  }

  // Always clean up the legacy file to avoid confusion.
  if (oldExists) {
    try { fs.unlinkSync(legacyMigrationsFile); } catch { /* non-fatal */ }
  }
};

const getCompletedMigrations = (): string[] => {
  if (!fs.existsSync(migrationsFile)) {
    return [];
  }
  const data = fs.readFileSync(migrationsFile, 'utf-8');
  return data ? JSON.parse(data) : [];
};

const saveCompletedMigration = (migrationName: string) => {
  const completedMigrations = getCompletedMigrations();
  completedMigrations.push(migrationName);
  fs.writeFileSync(
    migrationsFile,
    JSON.stringify(completedMigrations, null, 2)
  );
};

/** Providers that had no OCO_API_KEY / OCO_API_URL in migration00 and should skip it. */
const SKIP_MIGRATION00_PROVIDERS = new Set([
  OCO_AI_PROVIDER_ENUM.DEEPSEEK,
  OCO_AI_PROVIDER_ENUM.GROQ,
  OCO_AI_PROVIDER_ENUM.MISTRAL,
  OCO_AI_PROVIDER_ENUM.MLX,
  OCO_AI_PROVIDER_ENUM.OPENROUTER
]);

export const runMigrations = async () => {
  // if no config file, we assume it's a new installation and no migrations are needed
  if (!getIsGlobalConfigFileExist()) return;

  const config = getConfig();
  if (config.OCO_AI_PROVIDER === OCO_AI_PROVIDER_ENUM.TEST) return;

  // Migrate legacy tracking file before checking completed migrations.
  migrateLegacyMigrationsFile();

  const completedMigrations = getCompletedMigrations();
  const skipMigration00 = SKIP_MIGRATION00_PROVIDERS.has(config.OCO_AI_PROVIDER);

  let isMigrated = false;

  for (const migration of migrations) {
    // migration00 was not written for certain providers — skip only it for them.
    if (migration.name === '00_use_single_api_key_and_url' && skipMigration00) {
      if (!completedMigrations.includes(migration.name)) {
        // Mark as completed so it never fires for this install.
        saveCompletedMigration(migration.name);
      }
      continue;
    }

    if (!completedMigrations.includes(migration.name)) {
      try {
        console.log('Applying migration', migration.name);
        migration.run();
        console.log('Migration applied successfully', migration.name);
        saveCompletedMigration(migration.name);
      } catch (error) {
        outro(
          `${chalk.red('Failed to apply migration')} ${
            migration.name
          }: ${error}`
        );
        process.exit(1);
      }

      isMigrated = true;
    }
  }

  if (isMigrated) {
    outro(
      `${chalk.green(
        '✔'
      )} Migrations to your config were applied successfully. Please rerun.`
    );
    process.exit(0);
  }
};
