/**
 * Config bootstrap helpers used by the scheduler entry point.
 *
 * Reads optionally-encrypted JSON config files and exposes typed loaders
 * for the merged importer config and the derived log config.
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  decryptConfig,
  getEncryptionPassword,
  isEncryptedConfig,
} from '../Config/ConfigEncryption.js';
import { ConfigLoader } from '../Config/ConfigLoader.js';
import { deriveLogFormat } from '../Logger/Index.js';
import type {
  IImporterConfig,
  ILogConfig,
  Procedure,
} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const DEFAULT_LOG_DIR = './logs';

/**
 * Reads a JSON file, decrypting it first if it is an IEncryptedConfig.
 *
 * @param filePath - Absolute path to the JSON file to read.
 * @returns Procedure with parsed object, or failure if file is absent.
 */
export function readJsonOrEncrypted(
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

/**
 * Loads and deep-merges config.json with credentials.json at startup.
 *
 * Delegates to ConfigLoader.loadRaw() which handles proper deep-merge of
 * nested objects.
 *
 * @returns Procedure with the merged IImporterConfig, or failure if absent.
 */
export function loadFullConfig(): Procedure<IImporterConfig> {
  try {
    const loader = new ConfigLoader();
    return loader.loadRaw();
  } catch (error: unknown) {
    return fail(`Failed to load config: ${errorMessage(error)}`);
  }
}

/**
 * Derives the ILogConfig from the full config, applying format and logDir defaults.
 *
 * @returns Procedure with ILogConfig, or failure if config cannot be loaded.
 */
export function loadLogConfig(): Procedure<ILogConfig> {
  const configResult = loadFullConfig();
  if (isFail(configResult)) return fail('Cannot derive log config');
  const config = configResult.data;
  const tg = config.notifications?.telegram;
  const hasBot = tg?.listenForCommands === true;
  const format = config.logConfig?.format ?? deriveLogFormat(tg?.messageFormat, hasBot);
  const logDir = config.logConfig?.logDir ?? DEFAULT_LOG_DIR;
  return succeed({ ...config.logConfig, format, maxBufferSize: 0, logDir });
}
