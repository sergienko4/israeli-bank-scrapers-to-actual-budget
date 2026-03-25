/**
 * ReceiptApiAdapter — lazily connects to Actual Budget API for receipt imports.
 */

import { ConfigLoader } from '../Config/ConfigLoader.js';
import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type { IImporterConfig } from '../Types/Index.js';
import type { IReceiptActualApi } from './ReceiptImportHandler.js';

/**
 * Creates a connected IReceiptActualApi adapter.
 * @returns A connected Actual Budget API matching the receipt handler contract.
 */
export default async function createReceiptApi(): Promise<IReceiptActualApi> {
  const cfg = loadConfig();
  const apiModule = await import('@actual-app/api');
  const api = apiModule.default;
  getLogger().info('Connecting to Actual Budget for receipt import...');
  await api.init({
    dataDir: cfg.actual.init.dataDir,
    serverURL: cfg.actual.init.serverURL,
    password: cfg.actual.init.password,
  });
  const budgetPw = cfg.actual.budget.password ?? undefined;
  await api.downloadBudget(cfg.actual.budget.syncId, { password: budgetPw });
  return adaptApi(api);
}

/**
 * Loads and validates the importer configuration.
 * @returns The validated config data.
 */
function loadConfig(): IImporterConfig {
  const loader = new ConfigLoader();
  const result = loader.loadRaw();
  if (!result.success) throw new ConfigurationError(result.message);
  return result.data;
}

/**
 * Adapts the Actual Budget API to the IReceiptActualApi interface.
 * The cast at the boundary is intentional — the Actual API shape matches.
 * @param rawApi - The initialized @actual-app/api default export.
 * @returns An adapter matching the receipt handler contract.
 */
function adaptApi(rawApi: unknown): IReceiptActualApi {
  return rawApi as IReceiptActualApi;
}
