/**
 * JSON config file reader with transparent decryption support.
 *
 * Reads a config.json (or credentials.json) from disk and returns it
 * as a parsed IImporterConfig. If the file payload matches the
 * IEncryptedConfig shape, it is decrypted in-flight using the
 * CREDENTIALS_ENCRYPTION_PASSWORD environment variable. The text is read
 * through {@link readConfigText}, so a FIFO, a directory, an oversized file
 * or bad UTF-8 is refused by name.
 */

import { ConfigurationError } from '../../Errors/ErrorTypes.js';
import { getLogger } from '../../Logger/Index.js';
import parseProtoFreeJson from '../../Storage/ProtoFreeJson.js';
import type { IImporterConfig, Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import {
  decryptConfig, getEncryptionPassword, isEncryptedConfig,
} from '../ConfigEncryption.js';
import readConfigText from './ConfigFileText.js';

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
  return parseProtoFreeJson(decrypted) as IImporterConfig;
}

/**
 * Parses config text, decrypting it first if needed.
 *
 * @param raw - The file's text.
 * @param filePath - File path used in log and error messages.
 * @returns The parsed IImporterConfig object.
 */
function parseConfig(raw: string, filePath: string): IImporterConfig {
  const parsed = parseProtoFreeJson(raw) as Record<string, string | number | boolean>;
  if (!isEncryptedConfig(parsed)) return parsed as unknown as IImporterConfig;
  return decryptFile(raw, filePath);
}

/**
 * Reads and parses a JSON config file, decrypting it first if needed.
 * Only a missing file is a failure; a file that is there but unusable throws.
 *
 * @param filePath - Absolute path to the JSON file to read.
 * @returns The parsed config, or a failure with status ENOENT when there is no file.
 * @throws ConfigurationError when the file cannot be read, or is encrypted
 *   but no password is set.
 */
export default function readJsonFile(filePath: string): Procedure<IImporterConfig> {
  const text = readConfigText(filePath);
  if (!text.success && text.status === 'ENOENT') return text;
  if (!text.success) throw new ConfigurationError(text.message);
  const config = parseConfig(text.data, filePath);
  return succeed(config);
}
