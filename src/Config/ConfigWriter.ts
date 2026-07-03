/**
 * Writes the importer configuration back to disk for the config portal.
 *
 * Splits the merged config into settings (config.json) + secrets
 * (credentials.json) and writes each atomically via a temp file + rename,
 * re-encrypting credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set.
 * No plaintext `.bak` copies are kept: the encrypted credentials.json is the
 * only persisted secret artifact, so a previously-unencrypted file (or an
 * inline-secret config.json) can never linger in plaintext beside it.
 */

import { renameSync, rmSync, writeFileSync } from 'node:fs';
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
 * Stages a payload to a sibling `.tmp` file (owner-only mode) without touching
 * the real target, which {@link commitWrites} renames into place atomically.
 * No plaintext backup of the prior file is made, so an earlier unencrypted
 * credentials.json or inline-secret config.json is never duplicated on disk.
 * @param item - Destination path and JSON payload to stage.
 * @returns The staged temp path awaiting an atomic rename into place.
 */
function stageWrite(item: IPendingWrite): string {
  const tmp = `${item.path}.tmp`;
  writeFileSync(tmp, item.json, { encoding: 'utf8', mode: 0o600 });
  return tmp;
}

/**
 * Removes one staged temp file best-effort, swallowing any error so the
 * original write failure still propagates to the caller.
 * @param tmp - Temp path to remove; an already-renamed or missing path is a no-op.
 * @returns True when the file was removed, false when the removal was swallowed.
 */
function removeTemp(tmp: string): boolean {
  try {
    rmSync(tmp, { force: true });
    return true;
  } catch {
    // Best-effort cleanup: ignore so the original write error still propagates.
    return false;
  }
}

/**
 * Deletes staged temp files best-effort after a failed commit so no
 * partially-written (and possibly secret-bearing) artifact is left behind.
 * @param tmps - Temp paths to remove; already-renamed or missing paths are ignored.
 * @returns Status object with the count of temp files removed.
 */
function cleanupTemps(tmps: readonly string[]): { removed: number } {
  let removed = 0;
  for (const tmp of tmps) {
    if (removeTemp(tmp)) removed += 1;
  }
  return { removed };
}

/**
 * Commits files as one unit: stages every `.tmp` first, then renames each into
 * place. Staging all temps before any rename means a serialization or staging
 * failure never leaves config.json secret-stripped while credentials.json is
 * missing those same secrets; any staged temp is removed on failure. Note the
 * two renames are not a single atomic transaction — a process crash in the
 * narrow window between them can leave one file updated and the other from the
 * prior write; the importer re-validates on its next run and surfaces any
 * resulting mismatch rather than importing blindly.
 * @param items - Files to persist together (secrets-superset file first).
 * @returns Status object with the count of files committed.
 */
function commitWrites(items: readonly IPendingWrite[]): { committed: number } {
  const staged: { path: string; tmp: string }[] = [];
  try {
    for (const item of items) staged.push({ path: item.path, tmp: stageWrite(item) });
    for (const { path, tmp } of staged) renameSync(tmp, path);
    return { committed: staged.length };
  } catch (error: unknown) {
    const tmps = staged.map(entry => entry.tmp);
    cleanupTemps(tmps);
    throw error;
  }
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
