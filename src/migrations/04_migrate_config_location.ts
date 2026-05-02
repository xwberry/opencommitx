import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';

const OLD_CONFIG_PATH = pathJoin(homedir(), '.opencommitx');
const NEW_CONFIG_DIR = pathJoin(homedir(), '.opencommitx-data');
const NEW_CONFIG_PATH = pathJoin(NEW_CONFIG_DIR, 'config.ini');

export default function migration04(): void {
  if (!existsSync(OLD_CONFIG_PATH)) return;
  if (existsSync(NEW_CONFIG_PATH)) return;

  try {
    mkdirSync(NEW_CONFIG_DIR, { recursive: true });

    // Copy rather than rename so the old file remains as a backup.
    const content = readFileSync(OLD_CONFIG_PATH, 'utf8');
    writeFileSync(NEW_CONFIG_PATH, content, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    console.error(
      `Migration 04 failed: could not migrate config to ${NEW_CONFIG_PATH}`,
      err
    );
  }
}
