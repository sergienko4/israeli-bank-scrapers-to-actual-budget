/**
 * File-backed store of the OTP delivery channel. The portal writes the channel
 * the user selects in the mobile app; the import child reads it to pick the OTP
 * prompter. Deliberately separate from the main config (and the config manifest)
 * so the web portal UI never surfaces the channel; it is intended to be set from
 * the mobile app. Both clients share the same portal API, so this is UI-level
 * scoping, not a separate authorization boundary. Defaults to `telegram` when
 * unset or unreadable.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { getLogger } from '../../Logger/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import resolveOtpSettingsPath from './OtpSettingsPath.js';

/** The OTP delivery channel: Telegram (default) or the mobile app. */
export type OtpChannel = 'telegram' | 'app';

/** The persisted OTP settings. */
export interface IOtpSettings {
  channel: OtpChannel;
}

/** Persists the OTP delivery channel to a JSON file on a shared volume. */
export default class OtpSettingsStore {
  /**
   * Creates a store backed by the given file.
   * @param filePath - Path to the OTP-settings JSON file.
   */
  constructor(private readonly filePath = resolveOtpSettingsPath()) {}

  /**
   * Reads the configured OTP settings.
   * @returns The settings, defaulting to the Telegram channel when unset.
   */
  public get(): IOtpSettings {
    if (!existsSync(this.filePath)) return { channel: 'telegram' };
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return { channel: OtpSettingsStore.readChannel(parsed) };
    } catch (error: unknown) {
      getLogger().warn(`Unreadable OTP settings; defaulting to telegram: ${errorMessage(error)}`);
      return { channel: 'telegram' };
    }
  }

  /**
   * Persists the OTP delivery channel atomically.
   * @param channel - The channel to store.
   */
  public set(channel: OtpChannel): void {
    const serialized = JSON.stringify({ channel }, null, 2);
    const token = randomUUID();
    const tempPath = `${this.filePath}.${token}.tmp`;
    writeFileSync(tempPath, serialized);
    renameSync(tempPath, this.filePath);
  }

  /**
   * Extracts a valid channel from parsed JSON, defaulting to Telegram.
   * @param parsed - The parsed settings JSON.
   * @returns The stored channel, or `telegram` when absent/invalid.
   */
  private static readChannel(parsed: unknown): OtpChannel {
    if (typeof parsed !== 'object' || parsed === null) {
      return 'telegram';
    }
    const channel = (parsed as Record<string, unknown>).channel;
    return channel === 'app' ? 'app' : 'telegram';
  }
}
