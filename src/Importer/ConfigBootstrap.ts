/**
 * Importer config + logger bootstrap.
 *
 * First seam extracted from src/Index.ts during the composition-root
 * decoupling refactor. Owns three responsibilities the importer entry
 * point used to perform inline:
 *   - `--validate` CLI short-circuit (dynamic import + process.exit)
 *   - `--cleanup-card-refunds` CLI short-circuit (8.6.7 sign migration)
 *   - ConfigLoader.load() with stderr+exit on failure
 *   - createLogger() initialisation (logger remains a module singleton
 *     accessed via getLogger() throughout the codebase)
 *
 * Preserves the original exit-on-failure contract — both validate-mode
 * and config-load-failure paths terminate the process with the same
 * exit codes the original Index.ts used.
 */

import { ConfigLoader } from '../Config/ConfigLoader.js';
import { resolveConfigPath } from '../Config/ConfigPath.js';
import { createLogger, deriveLogFormat } from '../Logger/Index.js';
import { applyConfiguredLogLevel } from '../Logger/LoggerOptions.js';
import type { IImporterConfig, IProcedureSuccess } from '../Types/Index.js';
import { isFail, succeed } from '../Types/Index.js';

/**
 * Short-circuits the process when `--validate` is present in argv.
 *
 * Dynamically imports the validator (kept lazy so the validator's
 * dependency graph is not paid for during normal startup) and exits
 * with the validator's status code. Returns a skipped status when
 * --validate is absent so callers can chain into normal boot.
 *
 * @returns Procedure indicating the validate phase was skipped (or never returns).
 */
export async function handleValidateMode(): Promise<IProcedureSuccess<{ status: string }>> {
  if (!process.argv.includes('--validate')) return succeed({ status: 'skipped' });
  const { runValidateMode } = await import('../Config/ConfigValidator.js');
  process.exit(await runValidateMode());
}

/**
 * Short-circuits the process when `--cleanup-card-refunds` is present in argv.
 *
 * One-off migration for the israeli-bank-scrapers 8.6.7 upgrade: removes
 * credit-card refund rows this importer wrote with an inverted sign while
 * `signPolicy: 'flip-credit'` was still in force. Reports by default and
 * only deletes when `--confirm` is also supplied. Boots config and the
 * logger first so the command reports through the operator's configured
 * sink, then injects the config — keeping the Actual Budget client lazy
 * for the same reason as {@link handleValidateMode}.
 *
 * @returns Procedure indicating the cleanup phase was skipped (or never returns).
 */
export async function handleCardRefundCleanupMode(): Promise<
  IProcedureSuccess<{ status: string }>
> {
  if (!process.argv.includes('--cleanup-card-refunds')) return succeed({ status: 'skipped' });
  const config = bootConfigAndLogger();
  const { default: runCardRefundCleanup } = await import(
    '../Services/Transaction/CardRefundCleanup.js'
  );
  process.exit(await runCardRefundCleanup(config));
}

/**
 * Loads the importer config and initialises the logger singleton.
 *
 * Exits the process with code 1 (writing the error to stderr) when
 * config loading fails — mirrors the original Index.ts behavior so
 * existing operator tooling sees identical stderr+exit semantics.
 *
 * @returns The fully-loaded IImporterConfig.
 */
export function bootConfigAndLogger(): IImporterConfig {
  const loader = new ConfigLoader(resolveConfigPath());
  const result = loader.load();
  if (isFail(result)) {
    process.stderr.write(`Fatal: ${result.message}\n`);
    process.exit(1);
  }
  const config = result.data;
  applyConfiguredLogLevel(config);
  const telegram = config.notifications?.telegram;
  const derivedFormat = deriveLogFormat(telegram?.messageFormat, telegram?.listenForCommands);
  createLogger({
    ...config.logConfig,
    format: config.logConfig?.format ?? derivedFormat,
    logDir: config.logConfig?.logDir ?? './logs',
  });
  return config;
}
