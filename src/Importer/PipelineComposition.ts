/**
 * Importer pipeline composition.
 *
 * Sibling of ImporterWiring.ts. Owns the runtime-shape decisions for
 * the pipeline graph:
 *   - scrape strategy selection (mock vs live by env)
 *   - spending-watch service selection (live vs no-op)
 *   - ChainBuilder step composition
 *
 * Kept in its own file so ImporterWiring.ts stays under the
 * max-dependencies cap and so the strategy/step decisions are
 * unit-testable in isolation.
 */

import api from '@actual-app/api';

import type { ILogger } from '../Logger/ILogger.js';
import type { IBankScrapeStrategy } from '../Scraper/Strategies/IBankScrapeStrategy.js';
import { LiveScrapeStrategy } from '../Scraper/Strategies/LiveScrapeStrategy.js';
import { MockScrapeStrategy } from '../Scraper/Strategies/MockScrapeStrategy.js';
import { ChainBuilder } from '../Scrapers/Pipeline/Index.js';
import createEvaluateSpendingWatchStep from '../Scrapers/Pipeline/Steps/EvaluateSpendingWatchStep.js';
import createFinalizeImportStep from '../Scrapers/Pipeline/Steps/FinalizeImportStep.js';
import createInitializeApiStep from '../Scrapers/Pipeline/Steps/InitializeApiStep.js';
import createInitializeCategoryResolverStep from '../Scrapers/Pipeline/Steps/InitializeCategoryResolverStep.js';
import createProcessAllBanksStep from '../Scrapers/Pipeline/Steps/ProcessAllBanksStep.js';
import type { INamedStep } from '../Scrapers/Pipeline/Types/PipelineStep.js';
import SpendingWatchService from '../Services/SpendingWatchService.js';
import type { IImporterConfig, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { ICoreServices } from './CoreServicesWiring.js';
import type { IResilienceComponents } from './ResilienceWiring.js';

/**
 * Bundle the scrape-strategy selector needs — keeps the helper at 1 param.
 */
export interface IScrapeStrategyInputs {
  readonly config: IImporterConfig;
  readonly resilience: IResilienceComponents;
  readonly services: ICoreServices;
  readonly logger: ILogger;
}

/**
 * No-op spending-watch used when the user has not configured any spending rules.
 *
 * Exported so the {@link EffectiveWatchService} union type can reference
 * its inferred shape from outside this module — TypeDoc requires every
 * symbol referenced by an exported alias to itself be documented.
 */
export const NO_OP_WATCH = {
  /**
   * Returns a no-alerts result — no spending rules configured.
   * @returns Procedure with noAlerts flag.
   */
  evaluate: (): Promise<Procedure<{ noAlerts: true }>> => {
    const noAlertsResult = succeed({ noAlerts: true as const }, 'no-rules');
    return Promise.resolve(noAlertsResult);
  },
};

/**
 * The watch-service shape accepted by the spending-watch step.
 */
export type EffectiveWatchService = SpendingWatchService | typeof NO_OP_WATCH;

/**
 * Selects the scrape strategy by env: mock when E2E vars are set, live otherwise.
 *
 * @param inputs - The shared wiring inputs (config, resilience, services, logger).
 * @returns The IBankScrapeStrategy chosen for this run.
 */
export function buildScrapeStrategy(inputs: IScrapeStrategyInputs): IBankScrapeStrategy {
  const { config, resilience, services, logger } = inputs;
  const mockDir = process.env.E2E_MOCK_SCRAPER_DIR;
  const mockFile = process.env.E2E_MOCK_SCRAPER_FILE;
  if (mockDir || mockFile) {
    return new MockScrapeStrategy({ mockDir, mockFile, logger });
  }
  return new LiveScrapeStrategy({
    config,
    retryStrategy: resilience.retryStrategy,
    noRetryStrategy: resilience.noRetryStrategy,
    timeoutWrapper: resilience.timeoutWrapper,
    twoFactorPrompter: services.twoFactorPrompter,
    notificationService: services.notificationService,
  });
}

/**
 * Resolves the effective spending-watch implementation for this run.
 *
 * @param config - The IImporterConfig containing optional spendingWatch rules.
 * @returns A live SpendingWatchService when rules are configured; the no-op otherwise.
 */
export function resolveWatchService(config: IImporterConfig): EffectiveWatchService {
  if (!config.spendingWatch?.length) return NO_OP_WATCH;
  return new SpendingWatchService(config.spendingWatch, api);
}

/**
 * Builds the ChainBuilder-composed pipeline step graph.
 *
 * Step factories are pre-assigned to descriptive variables (no nested
 * calls in the .add() chain) so error stack traces point to a named
 * binding when a step constructor throws.
 *
 * @param watchService - The effective spending-watch implementation.
 * @returns The readonly array of named pipeline steps.
 */
export function buildPipeline(watchService: EffectiveWatchService): readonly INamedStep[] {
  const initApiStep = createInitializeApiStep(api);
  const initResolverStep = createInitializeCategoryResolverStep();
  const processBanksStep = createProcessAllBanksStep();
  const spendingWatchStep = createEvaluateSpendingWatchStep(watchService);
  const finalizeStep = createFinalizeImportStep(api);
  return new ChainBuilder()
    .add(initApiStep, { name: 'init-api', description: 'Connect to Actual Budget' })
    .add(initResolverStep, { name: 'init-resolver', description: 'Load category resolver' })
    .add(processBanksStep, { name: 'process-banks', description: 'Scrape and import all banks' })
    .add(spendingWatchStep, { name: 'spending-watch', description: 'Check spending rules' })
    .add(finalizeStep, { name: 'finalize', description: 'Print summary and notify' })
    .build();
}
