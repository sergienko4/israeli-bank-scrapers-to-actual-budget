/**
 * Config bootstrap helpers used by the scheduler entry point.
 *
 * Reads optionally-encrypted JSON config files and exposes typed loaders
 * for the merged importer config and the derived log config.
 */

import { deriveLogFormat } from '../Logger/Index.js';
import type {
  IImporterConfig,
  ILogConfig,
  Procedure,
} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import loadRawConfig from './Config/ConfigLoaderFactory.js';

export { default as readJsonOrEncrypted } from './Config/ConfigFileReader.js';

const DEFAULT_LOG_DIR = './logs';

/**
 * Loads and deep-merges config.json with credentials.json at startup.
 *
 * Delegates to a pluggable loader (default = the production ConfigLoader-
 * backed factory exported by `./Config/ConfigLoaderFactory.js`) so tests
 * can swap the implementation without touching the public surface.
 *
 * @param load - Optional loader override used by unit tests; defaults to
 *   the production ConfigLoader-backed implementation.
 * @returns Procedure with the merged IImporterConfig, or failure if absent.
 */
export function loadFullConfig(
  load: () => Procedure<IImporterConfig> = loadRawConfig
): Procedure<IImporterConfig> {
  try {
    return load();
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
