/**
 * Writes the importer configuration back to disk for the config portal.
 *
 * Splits the merged config into settings (config.json) + secrets
 * (credentials.json) and saves both through the {@link IFileSystem} port,
 * re-encrypting credentials.json when CREDENTIALS_ENCRYPTION_PASSWORD is set.
 * Each file is staged under an unpredictable name, created exclusively and
 * owner-only, so a symlink planted beside it is never followed. No plaintext
 * `.bak` copies are kept: the previous credentials are copied aside only for
 * the length of a save, so a failed config rename can put them back, and the
 * copy is removed once the save is done. A previously-unencrypted file (or an
 * inline-secret config.json) therefore never lingers in plaintext beside the
 * encrypted credentials.json.
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
import CredentialsBackup from './CredentialsBackup.js';
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

/** The two files a save writes, credentials first. */
interface IPair<T> {
  readonly credentials: T;
  readonly config: T;
}

/**
 * Stages both files before any rename, so a failed or short stage never
 * leaves config.json secret-stripped while credentials.json lacks the same
 * secrets. The credentials, already staged, are removed on failure.
 * @param fileSystem - Filesystem to stage on.
 * @param pending - The two payloads.
 * @returns Both staged files, or the failure that stopped staging.
 */
function stagePair(
  fileSystem: IFileSystem,
  pending: IPair<IPendingWrite>,
): Procedure<IPair<IStagedWrite>> {
  const credentials = stageOne(fileSystem, pending.credentials);
  if (!credentials.success) return credentials;
  const config = stageOne(fileSystem, pending.config);
  if (!config.success) return abandon(fileSystem, [credentials.data], config);
  return succeed({ credentials: credentials.data, config: config.data });
}

/**
 * Renames the credentials, then the config, into place. When the config
 * rename fails the previous credentials are put back, so the pair on disk
 * stays the previous save's. A crash between the two renames can still leave
 * one file from each save: the renames are two steps, not one transaction.
 * @param fileSystem - Filesystem the files were staged on.
 * @param staged - Both files, staged in full.
 * @param backup - The credentials as they stood before the save.
 * @returns Success, or the failed rename.
 */
function publishPair(
  fileSystem: IFileSystem,
  staged: IPair<IStagedWrite>,
  backup: CredentialsBackup,
): Procedure<{ written: true }> {
  const both = [staged.credentials, staged.config];
  const credentials = fileSystem.rename(staged.credentials.stagedPath, staged.credentials.path);
  if (!credentials.success) {
    backup.discard();
    return abandon(fileSystem, both, credentials);
  }
  const config = fileSystem.rename(staged.config.stagedPath, staged.config.path);
  if (!config.success) {
    const reported = backup.restoreAfter(config);
    return abandon(fileSystem, both, reported);
  }
  backup.discard();
  return succeed({ written: true as const });
}

/**
 * Stages both files, copies the current credentials aside, then publishes.
 * @param fileSystem - Filesystem to save on.
 * @param pending - The two payloads.
 * @returns Success, or the failure that stopped the save.
 */
function commitPair(
  fileSystem: IFileSystem,
  pending: IPair<IPendingWrite>,
): Procedure<{ written: true }> {
  const staged = stagePair(fileSystem, pending);
  if (!staged.success) return staged;
  const backup = CredentialsBackup.take(fileSystem, pending.credentials.path);
  if (!backup.success) {
    const both = [staged.data.credentials, staged.data.config];
    return abandon(fileSystem, both, backup);
  }
  return publishPair(fileSystem, staged.data, backup.data);
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
      const pending = this.pendingWrites(config);
      const committed = commitPair(this._fileSystem, pending);
      if (committed.success) return committed;
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
   * @returns The credentials file and config.json.
   */
  private pendingWrites(config: IImporterConfig): IPair<IPendingWrite> {
    registerConfigSecrets(config);
    const { settings, secrets } = splitSecrets(config);
    const [credPath, configPath] = this.savedPaths();
    const credJson = maybeEncrypt(secrets);
    const settingsJson = JSON.stringify(settings, null, 2);
    return {
      credentials: { path: credPath, json: credJson },
      config: { path: configPath, json: settingsJson },
    };
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
