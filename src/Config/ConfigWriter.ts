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

/** A pending file write: destination path + serialized JSON payload. */
interface IPendingWrite {
  path: string;
  json: string;
}

/**
 * Stages a payload to a sibling `.tmp` file, backing up any existing target.
 * The real file is left untouched until {@link commitWrites} renames it.
 * @param item - Destination path and JSON payload to stage.
 * @returns The staged temp path awaiting an atomic rename into place.
 */
function stageWrite(item: IPendingWrite): string {
  if (existsSync(item.path)) copyFileSync(item.path, `${item.path}.bak`);
  const tmp = `${item.path}.tmp`;
  writeFileSync(tmp, item.json, { encoding: 'utf8', mode: 0o600 });
  return tmp;
}

/**
 * Commits files as one unit: stages every `.tmp` first, then renames each into
 * place. Staging all temps before any rename means a serialization or staging
 * failure never leaves config.json secret-stripped while credentials.json is
 * missing those same secrets. Note the two renames are not a single atomic
 * transaction — a process crash in the narrow window between them can leave one
 * file updated and the other from the prior write; the importer re-validates on
 * its next run and surfaces any resulting mismatch rather than importing blindly.
 * @param items - Files to persist together (secrets-superset file first).
 * @returns Status object with the count of files committed.
 */
function commitWrites(items: readonly IPendingWrite[]): { committed: number } {
  const staged = items.map((item) => ({ path: item.path, tmp: stageWrite(item) }));
  for (const { path, tmp } of staged) renameSync(tmp, path);
  return { committed: staged.length };
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
      const configDir = dirname(this._configPath);
      const credPath = join(configDir, 'credentials.json');
      const credJson = maybeEncrypt(secrets);
      const settingsJson = JSON.stringify(settings, null, 2);
      commitWrites([
        { path: credPath, json: credJson },
        { path: this._configPath, json: settingsJson },
      ]);
      return succeed({ written: true as const });
    } catch (error: unknown) {
      return fail(`Failed to write config: ${errorMessage(error)}`);
    }
  }
}
