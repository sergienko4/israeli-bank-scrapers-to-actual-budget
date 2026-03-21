/**
 * Pipeline step: Initialize the Actual Budget API connection.
 * Connects in local mode (E2E) or server mode based on environment.
 */

import type { IPipelineContext, PipelineStep, Procedure } from '../Index.js';
import { fail, succeed } from '../Index.js';

/**
 * Opaque result type for Actual API calls whose return value is discarded.
 * The type alias hides `void` from ESLint function-type selectors.
 */
export type ApiSideEffect = Promise<void>;

/** Shape of the Actual API init/load dependency. */
export interface IActualApiLocal {
  readonly init: (
    opts: Record<string, string>
  ) => Promise<object>;
  readonly loadBudget: (
    id: string
  ) => ApiSideEffect;
}

/** Shape of the Actual API for server mode with download. */
export interface IActualApiServer extends IActualApiLocal {
  readonly downloadBudget: (
    id: string,
    opts?: { password?: string }
  ) => ApiSideEffect;
}

/**
 * Creates a step that initializes the Actual Budget API.
 * @param actualApi - The actual-app/api module.
 * @param actualApi.init - Initializes the API connection.
 * @param actualApi.downloadBudget - Downloads the budget.
 * @param actualApi.loadBudget - Loads a local budget by ID.
 * @returns PipelineStep that connects to the API.
 */
export default function createInitializeApiStep(
  actualApi: IActualApiServer
): PipelineStep {
  /**
   * Inner step that initializes the API connection.
   * @param ctx - Pipeline context for this step.
   * @returns Procedure with API initialized state.
   */
  return async (ctx: IPipelineContext): ReturnType<PipelineStep> => {
    const envRecord = process.env;
    const localBudgetId = envRecord.E2E_LOCAL_BUDGET_ID ?? '';

    if (localBudgetId) {
      return initLocal(ctx, actualApi, localBudgetId);
    }

    return initServer(ctx, actualApi);
  };
}

/**
 * Wraps a caught value into a proper Error instance.
 * @param err - The caught value from a try/catch.
 * @returns An Error instance.
 */
function toError(err: globalThis.Error | string): Error {
  if (err instanceof Error) return err;
  const message: string = err;
  return new Error(message);
}

/**
 * Builds a success result with apiInitialized = true.
 * @param ctx - Pipeline context to extend.
 * @returns Procedure with updated state.
 */
function apiInitialized(
  ctx: IPipelineContext
): Procedure<IPipelineContext> {
  return succeed({
    ...ctx,
    state: { ...ctx.state, apiInitialized: true },
  });
}

/**
 * Initializes in local mode for E2E testing.
 * @param ctx - Pipeline context.
 * @param api - Actual API module.
 * @param budgetId - Local budget ID.
 * @returns Updated context with API initialized.
 */
async function initLocal(
  ctx: Parameters<PipelineStep>[0],
  api: IActualApiLocal,
  budgetId: string
): ReturnType<PipelineStep> {
  try {
    ctx.logger.info(
      'Initializing Actual Budget (local mode)...'
    );
    await api.init({ dataDir: ctx.config.actual.init.dataDir });
    await api.loadBudget(budgetId);
    return apiInitialized(ctx);
  } catch (err) {
    return fail('Failed to initialize local API', {
      status: 'api-init-failed',
      error: toError(err as Error),
    });
  }
}

/**
 * Initializes in server mode connecting to Actual Budget server.
 * @param ctx - Pipeline context.
 * @param api - Actual API module.
 * @returns Updated context with API initialized.
 */
async function initServer(
  ctx: Parameters<PipelineStep>[0],
  api: IActualApiServer
): ReturnType<PipelineStep> {
  try {
    await connectAndDownload(ctx, api);
    return apiInitialized(ctx);
  } catch (err) {
    return fail('Failed to initialize server API', {
      status: 'api-init-failed',
      error: toError(err as Error),
    });
  }
}

/**
 * Connects to the Actual server and downloads the budget.
 * @param ctx - Pipeline context with config.
 * @param api - Actual API module with init and downloadBudget.
 * @returns True when the connection and download succeed.
 */
async function connectAndDownload(
  ctx: IPipelineContext,
  api: IActualApiServer
): Promise<boolean> {
  const { dataDir, serverURL, password } =
    ctx.config.actual.init;
  ctx.logger.info('Connecting to Actual Budget...');
  await api.init({ dataDir, serverURL, password });
  const downloadOpts: { password?: string } = {};
  const budgetPw = ctx.config.actual.budget.password;
  if (budgetPw) { downloadOpts.password = budgetPw; }
  await api.downloadBudget(
    ctx.config.actual.budget.syncId,
    downloadOpts
  );
  return true;
}
