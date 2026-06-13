/**
 * File reader for optionally-encrypted JSON config files.
 *
 * Isolated from {@link ConfigBootstrap} to keep `node:fs` and encryption
 * helpers off the bootstrap module's cross-layer dependency footprint.
 *
 * Each helper performs ONE responsibility (read / parse / decrypt) so the
 * top-level orchestrator stays ≤10 LoC per the project's SRP convention.
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  decryptConfig,
  getEncryptionPassword,
  isEncryptedConfig,
} from '../../Config/ConfigEncryption.js';
import type { Procedure } from '../../Types/Index.js';
import { fail, isFail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';

/**
 * Reads UTF-8 file contents, or fails if absent / unreadable.
 *
 * @param filePath - Absolute path of the file to read.
 * @returns Procedure with raw UTF-8 contents, or failure.
 */
function readRawFile(filePath: string): Procedure<string> {
  if (!existsSync(filePath)) return fail(`File not found: ${filePath}`);
  try {
    const contents = readFileSync(filePath, 'utf8');
    return succeed(contents);
  } catch (error: unknown) {
    return fail(`Failed to read ${filePath}: ${errorMessage(error)}`);
  }
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
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
