/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point — initializes services and runs the import pipeline.
 */

import { bootConfigAndLogger, handleValidateMode } from './Importer/ConfigBootstrap.js';
import { buildImporter } from './Importer/ImporterWiring.js';
import { buildProcessLifecycle } from './Importer/ProcessLifecycle.js';
import { buildResilienceComponents } from './Importer/ResilienceWiring.js';
import { getLogger } from './Logger/Index.js';
import { execute } from './Scrapers/Pipeline/Index.js';
import type { IImporterConfig, Procedure } from './Types/Index.js';
import { isFail } from './Types/Index.js';

// --validate mode: validate config and exit before full initialization
await handleValidateMode();

// Load configuration and initialize logger
const CONFIG: IImporterConfig = bootConfigAndLogger();
const LOGGER = getLogger();

// Initialize resilience components
const RESILIENCE = buildResilienceComponents();
const SHUTDOWN_HANDLER = RESILIENCE.shutdownHandler;

// Wire up services, scraper, and pipeline
const WIRING = buildImporter(CONFIG, RESILIENCE, LOGGER);
const PIPELINE = WIRING.pipeline;
const PIPELINE_CONTEXT = WIRING.pipelineContext;

// Bind process-lifecycle helpers to the shared dependencies
const LIFECYCLE = buildProcessLifecycle({
  logger: LOGGER,
  notificationService: WIRING.notificationService,
  errorFormatter: RESILIENCE.errorFormatter,
});

LOGGER.info('🚀 Starting Israeli Bank Importer for Actual Budget\n');
if (WIRING.isDryRun) LOGGER.info('🔍 DRY RUN MODE — no changes will be made to Actual Budget\n');
if (WIRING.hasProxy) LOGGER.info('🌐 Using configured proxy');

/**
 * Main entry point: registers shutdown handler, executes the pipeline, handles errors.
 * @returns Procedure indicating overall import result.
 */
async function main(): Promise<Procedure<{ status: string }>> {
  try {
    SHUTDOWN_HANDLER.onShutdown(LIFECYCLE.shutdownApiGracefully);
    const result = await execute(PIPELINE, PIPELINE_CONTEXT);
    if (isFail(result)) return await LIFECYCLE.handlePipelineFailure(result);
    const exitCode = (result.data.state.exitCode as number | undefined) ?? 0;
    process.exit(exitCode);
  } catch (error) {
    return await LIFECYCLE.handleFatalError(error);
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
