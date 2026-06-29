/**
 * Writes the importer configuration back to disk for the config portal.
 *
 * Splits the merged config into settings (config.json) + secrets
 * (credentials.json), writes each atomically with a .bak backup, and
 * re-encrypts credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set.
 */

import { copyFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { IImporterConfig, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { encryptConfig, getEncryptionPassword } from './ConfigEncryption.js';
import splitSecrets from './SecretSplitter.js';

/**
 * Serialises content and writes it atomically, backing up any existing file.
 * @param path - Destination file path.
 * @param json - Pretty-printed JSON string to persist.
 * @returns Confirmation flag once the file is in place.
 */
function atomicWrite(path: string, json: string): { written: true } {
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  return { written: true };
}

/**
 * Encrypts JSON when a password is set, otherwise returns it pretty-printed.
 * @param value - Object to serialise.
 * @returns Encrypted payload or plain JSON string.
 */
function maybeEncrypt(value: object): string {
  const plain = JSON.stringify(value, null, 2);
  const password = getEncryptionPassword();
  return password ? encryptConfig(plain, password) : plain;
}

/** Persists merged config to config.json + credentials.json. */
export default class ConfigWriter {
  private readonly _configPath: string;

  /**
   * Creates a writer targeting the same paths the loader reads.
   * @param configPath - Absolute path to config.json (default /app/config.json).
   */
  constructor(configPath = '/app/config.json') {
    this._configPath = configPath;
  }

  /**
   * Splits and writes the full config; secrets are encrypted when configured.
   * @param config - The merged importer config to persist.
   * @returns Procedure resolving when both files are written, or failure.
   */
  public write(config: IImporterConfig): Procedure<{ written: true }> {
    try {
      const { settings, secrets } = splitSecrets(config);
      const settingsJson = JSON.stringify(settings, null, 2);
      atomicWrite(this._configPath, settingsJson);
      const configDir = dirname(this._configPath);
      const credPath = join(configDir, 'credentials.json');
      const credJson = maybeEncrypt(secrets);
      atomicWrite(credPath, credJson);
      return succeed({ written: true as const });
    } catch (error: unknown) {
      return fail(`Failed to write config: ${errorMessage(error)}`);
    }
  }
}
