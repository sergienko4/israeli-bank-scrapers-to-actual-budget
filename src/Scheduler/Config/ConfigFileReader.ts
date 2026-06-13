/**
 * File reader for optionally-encrypted JSON config files.
 *
 * Isolated from {@link ConfigBootstrap} to keep `node:fs` and encryption
 * helpers off the bootstrap module's cross-layer dependency footprint.
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  decryptConfig,
  getEncryptionPassword,
  isEncryptedConfig,
} from '../../Config/ConfigEncryption.js';
import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';

/**
 * Reads a JSON file, decrypting it first if it is an IEncryptedConfig.
 *
 * @param filePath - Absolute path to the JSON file to read.
 * @returns Procedure with parsed object, or failure if file is absent
 *   or cannot be decrypted with the available password.
 */
export default function readJsonOrEncrypted(
  filePath: string
): Procedure<Record<string, unknown>> {
  if (!existsSync(filePath)) return fail(`File not found: ${filePath}`);
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const guard = parsed as Record<string, string | number | boolean>;
    if (!isEncryptedConfig(guard)) return succeed(parsed);
    const password = getEncryptionPassword();
    if (!password) return fail('Encryption password required');
    const decryptedJson = decryptConfig(raw, password);
    return succeed(JSON.parse(decryptedJson) as Record<string, unknown>);
  } catch (error: unknown) {
    return fail(`Failed to read ${filePath}: ${errorMessage(error)}`);
  }
}
