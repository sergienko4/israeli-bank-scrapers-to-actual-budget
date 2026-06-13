/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point — initializes services and runs the import pipeline.
 */

import api from '@actual-app/api';

import { bootConfigAndLogger, handleValidateMode } from './Importer/ConfigBootstrap.js';
import { buildImporter } from './Importer/ImporterWiring.js';
import { buildResilienceComponents } from './Importer/ResilienceWiring.js';
import { getLogger } from './Logger/Index.js';
import { execute } from './Scrapers/Pipeline/Index.js';
import type { IImporterConfig, Procedure } from './Types/Index.js';
import { isFail, succeed } from './Types/Index.js';
import { errorMessage } from './Utils/Index.js';

// --validate mode: validate config and exit before full initialization
await handleValidateMode();

// Load configuration and initialize logger
const CONFIG: IImporterConfig = bootConfigAndLogger();
const LOGGER = getLogger();

// Initialize resilience components
const RESILIENCE = buildResilienceComponents();
const SHUTDOWN_HANDLER = RESILIENCE.shutdownHandler;
const ERROR_FORMATTER = RESILIENCE.errorFormatter;

// Wire up services, scraper, and pipeline
const WIRING = buildImporter(CONFIG, RESILIENCE, LOGGER);
const NOTIFICATION_SERVICE = WIRING.notificationService;
const PIPELINE = WIRING.pipeline;
const PIPELINE_CONTEXT = WIRING.pipelineContext;

LOGGER.info('🚀 Starting Israeli Bank Importer for Actual Budget\n');
if (WIRING.isDryRun) LOGGER.info('🔍 DRY RUN MODE — no changes will be made to Actual Budget\n');
if (WIRING.hasProxy) LOGGER.info('🌐 Using configured proxy');

/**
 * Best-effort Actual API shutdown that never throws.
 * Catches any error, logs it via the project's `errorMessage()` utility,
 * and returns. Used by both fatal-error and pipeline-failure paths to
 * release the Actual API connection so the Node event loop can exit.
 * @returns Procedure indicating whether shutdown was clean or recovered.
 */
async function safeShutdown(): Promise<Procedure<{ status: string }>> {
  try { await api.shutdown(); }
  catch (error: unknown) {
    LOGGER.error(`Error during API shutdown: ${errorMessage(error)}`);
    return succeed({ status: 'api-shutdown-error' });
  }
  return succeed({ status: 'api-shutdown' });
}

/**
 * Handles an unrecoverable error: logs it, sends a Telegram notification, and exits.
 * @param error - The unknown error caught at the top level.
 * @returns Never — always exits the process with code 1.
 */
async function handleFatalError(error: unknown): Promise<never> {
  const err = error instanceof Error ? error : new Error(String(error));
  const formattedError = ERROR_FORMATTER.format(err);
  LOGGER.error(`\n${formattedError}`);
  if (error instanceof Error) LOGGER.error(`Stack trace: ${error.stack ?? 'N/A'}`);
  await NOTIFICATION_SERVICE.sendError(formattedError);
  await safeShutdown();
  process.exit(1);
}

/**
 * Handles a pipeline-level failure (e.g. all-banks-failed): notifies and exits.
 * Mirrors handleFatalError but for non-throw failures returned by steps so the
 * Docker container shuts down the Actual API and the webhook receives the
 * error event instead of hanging on a live API connection.
 * @param failure - Pipeline failure carrying the user-facing message.
 * @param failure.message - Human-readable pipeline failure message.
 * @returns Never — always exits the process with code 1.
 */
async function handlePipelineFailure(
  failure: { readonly message: string },
): Promise<never> {
  LOGGER.error(`Pipeline failed: ${failure.message}`);
  await NOTIFICATION_SERVICE.sendError(failure.message);
  await safeShutdown();
  process.exit(1);
}

/**
 * Gracefully shuts down the Actual Budget API during process termination.
 * @returns Procedure indicating shutdown result.
 */
async function shutdownApiGracefully(): Promise<Procedure<{ status: string }>> {
  LOGGER.info('🔌 Shutting down Actual Budget API...');
  return await safeShutdown();
}

/**
 * Main entry point: registers shutdown handler, executes the pipeline, handles errors.
 * @returns Procedure indicating overall import result.
 */
async function main(): Promise<Procedure<{ status: string }>> {
  try {
    SHUTDOWN_HANDLER.onShutdown(shutdownApiGracefully);
    const result = await execute(PIPELINE, PIPELINE_CONTEXT);
    if (isFail(result)) return await handlePipelineFailure(result);
    const exitCode = (result.data.state.exitCode as number | undefined) ?? 0;
    process.exit(exitCode);
  } catch (error) {
    return await handleFatalError(error);
  }
}

// Run if executed directly (resolve paths for Docker compatibility)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_PATH = fileURLToPath(import.meta.url);
const CURRENT_FILE = resolve(CURRENT_PATH);
const INVOKED_FILE = resolve(process.argv[1]);
if (CURRENT_FILE === INVOKED_FILE) {
  await main();
}
