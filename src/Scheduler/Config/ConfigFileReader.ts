/**
 * File reader for optionally-encrypted JSON config files.
 *
 * Isolated from {@link ConfigBootstrap} to keep file reading and encryption
 * helpers off the bootstrap module's cross-layer dependency footprint. The
 * text is read through {@link readConfigText}, so a FIFO, a directory, an
 * oversized file or bad UTF-8 is refused by name.
 *
 * Each helper performs ONE responsibility (read / parse / decrypt) so the
 * top-level orchestrator stays ≤10 LoC per the project's SRP convention.
 */

import {
  decryptConfig,
  getEncryptionPassword,
  isEncryptedConfig,
} from '../../Config/ConfigEncryption.js';
import readConfigText from '../../Config/Loaders/ConfigFileText.js';
import parseProtoFreeJson from '../../Storage/ProtoFreeJson.js';
import type { Procedure } from '../../Types/Index.js';
import { fail, isFail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';

/**
 * Reads UTF-8 file contents, or fails if absent / unreadable. Only a missing
 * file reads as "File not found"; any other failure names its cause.
 *
 * @param filePath - Absolute path of the file to read.
 * @returns Procedure with raw UTF-8 contents, or failure.
 */
function readRawFile(filePath: string): Procedure<string> {
  const text = readConfigText(filePath);
  if (!text.success && text.status === 'ENOENT') return fail(`File not found: ${filePath}`);
  return text;
}

/**
 * Parses a JSON string into a plain object.
 *
 * @param raw - The JSON string to parse.
 * @param filePath - Source file path used for error reporting context.
 * @returns Procedure with the parsed object, or failure with contextual error.
 */
function parseJsonObject(raw: string, filePath: string): Procedure<Record<string, unknown>> {
  try {
    const parsed = parseProtoFreeJson(raw) as Record<string, unknown>;
    return succeed(parsed);
  } catch (error: unknown) {
    return fail(`Failed to read ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * Decrypts an encrypted config payload using the configured password.
 *
 * @param raw - The encrypted raw file contents.
 * @param filePath - Source file path used for error reporting context.
 * @returns Procedure with the decrypted+parsed object, or failure if the
 *   password is missing or decryption fails.
 */
function decryptPayload(raw: string, filePath: string): Procedure<Record<string, unknown>> {
  const password = getEncryptionPassword();
  if (!password) return fail('Encryption password required');
  try {
    const decryptedJson = decryptConfig(raw, password);
    return parseJsonObject(decryptedJson, filePath);
  } catch (error: unknown) {
    return fail(`Failed to read ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * Reads a JSON file, decrypting it first if it is an IEncryptedConfig.
 *
 * @param filePath - Absolute path to the JSON file to read.
 * @returns Procedure with parsed object, or failure if file is absent
 *   or cannot be decrypted with the available password.
 */
export default function readJsonOrEncrypted(filePath: string): Procedure<Record<string, unknown>> {
  const raw = readRawFile(filePath);
  if (isFail(raw)) return raw;
  const parsed = parseJsonObject(raw.data, filePath);
  if (isFail(parsed)) return parsed;
  const guard = parsed.data as Record<string, string | number | boolean>;
  if (!isEncryptedConfig(guard)) return parsed;
  return decryptPayload(raw.data, filePath);
}
