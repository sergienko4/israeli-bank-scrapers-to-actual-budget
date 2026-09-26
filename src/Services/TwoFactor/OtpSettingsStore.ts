/**
 * File-backed store of the OTP delivery channel. The portal writes the channel
 * the user selects in the mobile app; the import child reads it to pick the OTP
 * prompter. Deliberately separate from the main config (and the config manifest)
 * so the web portal UI never surfaces the channel; it is intended to be set from
 * the mobile app. Both clients share the same portal API, so this is UI-level
 * scoping, not a separate authorization boundary. Defaults to `telegram` when
 * unset or unreadable.
 *
 * <p>The file sits on {@link SecureJsonStore}: it is owner-only, a write
 * replaces it whole, and a file holding anything this store would not write
 * back is moved aside on the next write instead of being overwritten.
 */
import StorageError from '../../Errors/StorageError.js';
import { getLogger } from '../../Logger/Index.js';
import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { IStoreSnapshot } from '../../Storage/StoreTypes.js';
import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/ProcedureHelpers.js';

/** The OTP delivery channel: Telegram (default) or the mobile app. */
export type OtpChannel = 'telegram' | 'app';

/** The persisted OTP settings. */
export interface IOtpSettings {
  channel: OtpChannel;
}

/** The settings as read, and whether the file holds only what this store writes. */
interface ILoadedSettings {
  readonly settings: IOtpSettings;
  readonly isIntact: boolean;
  readonly isDamaged: boolean;
  readonly summary: string;
}

/**
 * Reads a stored channel value, defaulting to Telegram.
 * @param value - The stored `channel` record.
 * @returns The channel, or `telegram` when absent or unknown.
 */
function toChannel(value: unknown): OtpChannel {
  return value === 'app' ? 'app' : 'telegram';
}

/**
 * Reports whether a snapshot holds exactly what this store writes.
 *
 * <p>An absent file is intact: there is nothing to preserve, so the next
 * write does not look for something to move aside.
 * @param snapshot - The store's snapshot.
 * @returns True when the file is absent, or holds only a known channel.
 */
function isIntactSnapshot(snapshot: IStoreSnapshot): boolean {
  if (snapshot.state !== 'healthy') return snapshot.state === 'absent';
  const { records } = snapshot;
  const isKnown = records.channel === 'app' || records.channel === 'telegram';
  return isKnown && Object.keys(records).length === 1;
}

/** Persists the OTP delivery channel to a JSON file on a shared volume. */
export default class OtpSettingsStore {
  private readonly _store: SecureJsonStore;

  /**
   * Binds the store to one path on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param filePath - Absolute path of the OTP-settings JSON file.
   */
  constructor(fileSystem: IFileSystem, filePath: string) {
    this._store = new SecureJsonStore(fileSystem, filePath);
  }

  /**
   * Reads the configured OTP settings.
   * @returns The settings, defaulting to the Telegram channel when unset or unreadable.
   */
  public get(): IOtpSettings {
    const loaded = this.load();
    if (!loaded.success) return OtpSettingsStore.warnDefault(loaded.message);
    if (loaded.data.isDamaged) return OtpSettingsStore.warnDefault(loaded.data.summary);
    return loaded.data.settings;
  }

  /**
   * Persists the OTP delivery channel atomically.
   * @param channel - The channel to store.
   * @throws StorageError when the current file cannot be read or the new one saved.
   */
  public set(channel: OtpChannel): void {
    const loaded = this.load();
    if (!loaded.success) {
      throw new StorageError(`Could not read the OTP settings before saving: ${loaded.message}`);
    }
    const request = { records: { channel }, shouldQuarantine: !loaded.data.isIntact };
    const committed = this._store.commit(request);
    if (!committed.success) {
      throw new StorageError(`Could not save the OTP settings: ${committed.message}`);
    }
  }

  /**
   * Reads the file once: the settings, and whether it holds only what this store writes.
   * @returns The loaded settings, or why the file could not be assessed.
   */
  private load(): Procedure<ILoadedSettings> {
    const snapshot = this._store.read();
    if (!snapshot.success) return snapshot;
    const { state, records, summary } = snapshot.data;
    const settings: IOtpSettings = { channel: toChannel(records.channel) };
    const isIntact = isIntactSnapshot(snapshot.data);
    return succeed({ settings, isIntact, isDamaged: state === 'damaged', summary });
  }

  /**
   * Warns that the settings could not be used, and falls back to Telegram.
   * @param reason - Why the settings could not be used.
   * @returns The default settings.
   */
  private static warnDefault(reason: string): IOtpSettings {
    getLogger().warn(`Unreadable OTP settings; defaulting to telegram: ${reason}`);
    const settings: IOtpSettings = { channel: 'telegram' };
    return settings;
  }
}
