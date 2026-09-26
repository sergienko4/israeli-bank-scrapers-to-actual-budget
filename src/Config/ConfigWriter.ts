/**
 * Writes the importer configuration back to disk for the config portal.
 *
 * Splits the merged config into settings (config.json) + secrets
 * (credentials.json) and saves both through the {@link IFileSystem} port,
 * re-encrypting credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set.
 * Each file is staged under an unpredictable name, created exclusively and
 * owner-only, so a symlink planted beside it is never followed. No plaintext
 * `.bak` copies are kept: the encrypted credentials.json is the only
 * persisted secret artifact, so a previously-unencrypted file (or an
 * inline-secret config.json) can never linger in plaintext beside it.
 *
 * It uses the port rather than SecureJsonStore: the two files are saved as
 * one unit, and config needs no quarantine because the portal refuses to
 * start on a config that does not load.
 */

import { dirname, join } from 'node:path';

import type { IFileSystem } from '../Storage/FileSystemPort.js';
import { stagingPathFor } from '../Storage/StagingPaths.js';
import sweepStaged, { sweepLegacyStaging, sweepReportOf } from '../Storage/StagingSweep.js';
import { checkWholeWrite } from '../Storage/StoreRecords.js';
import type { ISweepReport } from '../Storage/StoreTypes.js';
import type { IImporterConfig, IProcedureFailure, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { encryptConfig, getEncryptionPassword } from './ConfigEncryption.js';
import registerConfigSecrets from './ConfigSecretValues.js';
import splitSecrets from './SecretSplitter.js';

/** A pending file write: destination path + serialized JSON payload. */
interface IPendingWrite {
  readonly path: string;
  readonly json: string;
}

/** A payload staged in full, awaiting its rename into place. */
interface IStagedWrite {
  readonly path: string;
  readonly stagedPath: string;
}

/**
 * Removes staged files best-effort after a failed save, so no partial (and
 * possibly secret-bearing) file is left behind. A path already renamed into
 * place is absent by then, and removing it is a no-op.
 * @param fileSystem - Filesystem the files were staged on.
 * @param staged - Files this save staged.
 * @param failure - What stopped the save.
 * @returns The original failure, never the cleanup's own.
 */
function abandon(
  fileSystem: IFileSystem,
  staged: readonly IStagedWrite[],
  failure: IProcedureFailure,
): IProcedureFailure {
  for (const entry of staged) fileSystem.remove(entry.stagedPath);
  return failure;
}

/**
 * Stages one payload exclusively under a fresh name and checks it is whole.
 * A failed create removes nothing: the name may belong to someone else.
 * @param fileSystem - Filesystem to stage on.
 * @param item - Destination path and JSON payload.
 * @returns The staged file, or why it could not be staged in full.
 */
function stageOne(fileSystem: IFileSystem, item: IPendingWrite): Procedure<IStagedWrite> {
  const entry: IStagedWrite = { path: item.path, stagedPath: stagingPathFor(item.path) };
  const created = fileSystem.createExclusive(entry.stagedPath, item.json);
  if (!created.success) return created;
  const expected = Buffer.byteLength(item.json, 'utf8');
  const whole = checkWholeWrite(created.data.bytesWritten, expected);
  if (!whole.success) return abandon(fileSystem, [entry], whole);
  return succeed(entry);
}

/**
 * Stages every file before any rename, so a failed or short stage never
 * leaves config.json secret-stripped while credentials.json lacks the same
 * secrets. Anything already staged is removed on failure.
 * @param fileSystem - Filesystem to stage on.
 * @param items - Files to save together (secrets-superset file first).
 * @returns The staged files, or the failure that stopped staging.
 */
function stageAll(
  fileSystem: IFileSystem,
  items: readonly IPendingWrite[],
): Procedure<readonly IStagedWrite[]> {
  const staged: IStagedWrite[] = [];
  for (const item of items) {
    const one = stageOne(fileSystem, item);
    if (!one.success) return abandon(fileSystem, staged, one);
    staged.push(one.data);
  }
  return succeed(staged);
}

/**
 * Renames each staged file into place, in order. The two renames are not a
 * single atomic transaction: a crash between them can leave one file from
 * this save and the other from the previous one.
 * @param fileSystem - Filesystem the files were staged on.
 * @param staged - Files staged in full.
 * @returns How many files were committed, or the failed rename.
 */
function publishAll(
  fileSystem: IFileSystem,
  staged: readonly IStagedWrite[],
): Procedure<{ committed: number }> {
  for (const entry of staged) {
    const moved = fileSystem.rename(entry.stagedPath, entry.path);
    if (!moved.success) return abandon(fileSystem, staged, moved);
  }
  return succeed({ committed: staged.length });
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
  private readonly _fileSystem: IFileSystem;

  private readonly _configPath: string;

  /**
   * Creates a writer targeting the same paths the loader reads.
   * @param fileSystem - Filesystem the two files are saved on.
   * @param configPath - Absolute path to config.json.
   */
  constructor(fileSystem: IFileSystem, configPath: string) {
    this._fileSystem = fileSystem;
    this._configPath = configPath;
  }

  /**
   * Splits and writes the full config; secrets are encrypted when configured.
   * The secret values are registered with the value masker first, so a new
   * credential saved from the portal is hidden from every output at once.
   * @param config - The merged importer config to persist.
   * @returns Procedure resolving when both files are written, or failure.
   */
  public write(config: IImporterConfig): Procedure<{ written: true }> {
    try {
      const items = this.pendingWrites(config);
      const staged = stageAll(this._fileSystem, items);
      const committed = staged.success ? publishAll(this._fileSystem, staged.data) : staged;
      if (committed.success) return succeed({ written: true as const });
      const reason = `Failed to write config: ${committed.message}`;
      return fail(reason, { status: committed.status });
    } catch (error: unknown) {
      return fail(`Failed to write config: ${errorMessage(error)}`);
    }
  }

  /**
   * Deletes the staged files a save killed mid-way left beside either file,
   * including the fixed-name `.tmp` files older releases staged at.
   *
   * <p>A save removes what it staged when it fails, but not when the process
   * is killed. Whoever owns the process lifecycle calls this after startup.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    let removedCount = 0;
    for (const filePath of this.savedPaths()) {
      const swept = sweepStaged(this._fileSystem, filePath);
      if (!swept.success) return swept;
      const wasLegacyRemoved = sweepLegacyStaging(this._fileSystem, filePath);
      removedCount += swept.data.removedCount + (wasLegacyRemoved ? 1 : 0);
    }
    const report = sweepReportOf(removedCount);
    return succeed(report);
  }

  /**
   * Serialises the two files a save writes, credentials first.
   * @param config - The merged importer config to persist.
   * @returns The credentials file, then config.json.
   */
  private pendingWrites(config: IImporterConfig): readonly IPendingWrite[] {
    registerConfigSecrets(config);
    const { settings, secrets } = splitSecrets(config);
    const [credPath, configPath] = this.savedPaths();
    const credJson = maybeEncrypt(secrets);
    const settingsJson = JSON.stringify(settings, null, 2);
    return [
      { path: credPath, json: credJson },
      { path: configPath, json: settingsJson },
    ];
  }

  /**
   * Names the two files a save writes, in the order it writes them.
   * @returns credentials.json beside the config, then config.json.
   */
  private savedPaths(): readonly [string, string] {
    const configDir = dirname(this._configPath);
    const credPath = join(configDir, 'credentials.json');
    return [credPath, this._configPath];
  }
}
