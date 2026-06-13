/**
 * Importer entry-point composition.
 *
 * Wires config + logger + resilience + services + pipeline + lifecycle
 * into a single boot sequence. This is the only Importer module that
 * calls process.exit, that runs the LOGGER.info startup banner, and
 * that registers the graceful-shutdown handler.
 *
 * src/Index.ts is now a thin barrel + Node-entry guard that delegates
 * to bootImporter() exactly like src/Scheduler.ts delegates to
 * bootScheduler().
 */

import { getLogger } from '../Logger/Index.js';
import { execute } from '../Scrapers/Pipeline/Index.js';
import type { IImporterConfig, IProcedureSuccess } from '../Types/Index.js';
import { isFail, succeed } from '../Types/Index.js';
import { bootConfigAndLogger, handleValidateMode } from './ConfigBootstrap.js';
import type { IImporterWiring } from './ImporterWiring.js';
import { buildImporter } from './ImporterWiring.js';
import type { IProcessLifecycle } from './ProcessLifecycle.js';
import { buildProcessLifecycle } from './ProcessLifecycle.js';
import type { IResilienceComponents } from './ResilienceWiring.js';
import { buildResilienceComponents } from './ResilienceWiring.js';

/**
 * Frozen bundle of every primitive bootImporter assembles. Returned by
 * the composition root so tests can inspect or replace any layer.
 */
export interface IImporterBootHandle {
  readonly config: IImporterConfig;
  readonly resilience: IResilienceComponents;
  readonly wiring: IImporterWiring;
  readonly lifecycle: IProcessLifecycle;
}

/**
 * Prints the startup banner (dry-run + proxy notes when applicable).
 *
 * @param wiring - The completed importer wiring handle.
 * @returns Procedure indicating banner emission.
 */
function emitStartupBanner(wiring: IImporterWiring): IProcedureSuccess<{ status: string }> {
  const logger = getLogger();
  logger.info('🚀 Starting Israeli Bank Importer for Actual Budget\n');
  if (wiring.isDryRun) {
    logger.info('🔍 DRY RUN MODE — no changes will be made to Actual Budget\n');
  }
  if (wiring.hasProxy) logger.info('🌐 Using configured proxy');
  return succeed({ status: 'banner-emitted' });
}

/**
 * Assembles every importer layer in dependency order.
 *
 * @returns Frozen IImporterBootHandle bundling config + resilience + wiring + lifecycle.
 */
export function buildImporterBootHandle(): IImporterBootHandle {
  const config = bootConfigAndLogger();
  const logger = getLogger();
  const resilience = buildResilienceComponents();
  const wiring = buildImporter(config, resilience, logger);
  const lifecycle = buildProcessLifecycle({
    logger,
    notificationService: wiring.notificationService,
    errorFormatter: resilience.errorFormatter,
  });
  return Object.freeze({ config, resilience, wiring, lifecycle });
}

/**
 * Runs the import pipeline and resolves to the exit code (defaults to 0).
 *
 * The try/catch wraps ONLY the pipeline execute() call so the terminal
 * lifecycle handlers (handlePipelineFailure / handleFatalError) run
 * outside any catch — they are themselves process.exit sites and a
 * surrounding catch would swallow that termination in tests and mask
 * the real exit code.
 *
 * @param handle - The completed boot handle.
 * @returns Exit code resolved from the pipeline or the lifecycle handlers.
 */
async function resolvePipelineExitCode(handle: IImporterBootHandle): Promise<number> {
  let result: Awaited<ReturnType<typeof execute>>;
  try {
    result = await execute(handle.wiring.pipeline, handle.wiring.pipelineContext);
  } catch (error: unknown) {
    return await handle.lifecycle.handleFatalError(error);
  }
  if (isFail(result)) return await handle.lifecycle.handlePipelineFailure(result);
  return (result.data.state.exitCode as number | undefined) ?? 0;
}

/**
 * Registers the shutdown handler and runs the pipeline to completion.
 *
 * @param handle - The completed boot handle.
 * @returns Promise that never returns (process exits at the end).
 */
async function runImporter(handle: IImporterBootHandle): Promise<never> {
  handle.resilience.shutdownHandler.onShutdown(handle.lifecycle.shutdownApiGracefully);
  const exitCode = await resolvePipelineExitCode(handle);
  process.exit(exitCode);
}

/**
 * Top-level entry: short-circuits on --validate, otherwise assembles
 * everything and runs the importer pipeline to completion.
 *
 * @returns Promise that never resolves on the main path (process
 *   exits before resolution). Only awaits on the validate-mode
 *   short-circuit, which itself terminates the process before return.
 */
export async function bootImporter(): Promise<never> {
  // --validate mode: validator runs and calls process.exit; returns 'skipped' otherwise
  await handleValidateMode();
  const handle = buildImporterBootHandle();
  emitStartupBanner(handle.wiring);
  return await runImporter(handle);
}
