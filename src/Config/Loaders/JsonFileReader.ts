/**
 * JSON config file reader with transparent decryption support.
 *
 * Reads a config.json (or credentials.json) from disk and returns it
 * as a parsed IImporterConfig. If the file payload matches the
 * IEncryptedConfig shape, it is decrypted in-flight using the
 * CREDENTIALS_ENCRYPTION_PASSWORD environment variable.
 */

import { readFileSync } from 'node:fs';

import { ConfigurationError } from '../../Errors/ErrorTypes.js';
import { getLogger } from '../../Logger/Index.js';
import type { IImporterConfig } from '../../Types/Index.js';
import {
  decryptConfig, getEncryptionPassword, isEncryptedConfig,
} from '../ConfigEncryption.js';

/**
 * Resolves the config encryption password or throws when it is missing.
 *
 * @param filePath - File path used in the error message.
 * @returns The encryption password resolved from the environment.
 * @throws ConfigurationError when CREDENTIALS_ENCRYPTION_PASSWORD is not set.
 */
function requirePassword(filePath: string): string {
  const password = getEncryptionPassword();
  if (!password) {
    throw new ConfigurationError(
      `🔐 ${filePath} is encrypted. Set CREDENTIALS_ENCRYPTION_PASSWORD env var.`,
    );
  }
  return password;
}

/**
 * Decrypts an encrypted config payload using the environment password.
 *
 * @param raw - Raw JSON string of the encrypted payload.
 * @param filePath - File path used in error messages.
 * @returns The decrypted IImporterConfig object.
 * @throws ConfigurationError when CREDENTIALS_ENCRYPTION_PASSWORD is not set.
 */
function decryptFile(raw: string, filePath: string): IImporterConfig {
  const password = requirePassword(filePath);
  getLogger().info(`🔐 Decrypting ${filePath}...`);
  const decrypted = decryptConfig(raw, password);
  return JSON.parse(decrypted) as IImporterConfig;
}

/**
 * Reads and parses a JSON config file, decrypting it first if needed.
 *
 * @param filePath - Absolute path to the JSON file to read.
 * @returns The parsed IImporterConfig object.
 * @throws ConfigurationError when the file is encrypted but no password is set.
 */
export default function readJsonFile(filePath: string): IImporterConfig {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, string | number | boolean>;
  if (!isEncryptedConfig(parsed)) return parsed as unknown as IImporterConfig;
  return decryptFile(raw, filePath);
}
