/**
 * File-backed registry of Expo push tokens. The portal writes tokens as devices
 * register; the importer's Expo push notifier reads them to broadcast import
 * results. Tokens are deduplicated and stored as a JSON string array.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import resolveDeviceTokensPath from './DeviceTokenPath.js';

/** Persists Expo push tokens to a JSON file on a shared volume. */
export default class DeviceTokenStore {
  /**
   * Creates a store backed by the given file.
   * @param filePath - Path to the device-tokens JSON file.
   */
  constructor(private readonly filePath = resolveDeviceTokensPath()) {}

  /**
   * Lists the registered push tokens.
   * @returns The stored tokens, or an empty array when absent/corrupt.
   */
  public list(): string[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * Registers a token (no-op when already present).
   * @param token - The Expo push token to add.
   */
  public add(token: string): void {
    const tokens = this.list();
    if (tokens.includes(token)) return;
    this.write([...tokens, token]);
  }

  /**
   * Unregisters a token.
   * @param token - The Expo push token to remove.
   */
  public remove(token: string): void {
    const tokens = this.list();
    const remaining = tokens.filter((existing) => existing !== token);
    this.write(remaining);
  }

  /**
   * Serialises and writes the token list.
   * @param tokens - The full token list to persist.
   */
  private write(tokens: string[]): void {
    const serialized = JSON.stringify(tokens, null, 2);
    writeFileSync(this.filePath, serialized);
  }
}
