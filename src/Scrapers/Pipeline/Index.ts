/**
 * Pipeline barrel exports.
 */
export { default as ChainBuilder } from './Builder/ChainBuilder.js';
export { default as execute } from './Runner/PipelineRunner.js';
export type {
  IPipelineConfig, IPipelineContext, IPipelineState, IServiceContainer,
} from './Types/PipelineContext.js';
export type { INamedStep, IStepMeta, PipelineStep } from './Types/PipelineStep.js';

// Re-export Result Pattern types so Steps/Strategies can import without deep paths
export type { IProcedureFailure,IProcedureSuccess, Procedure } from '../../Types/Index.js';
export { fail, fromPromise, isFail,isSuccess, succeed } from '../../Types/Index.js';

// Re-export shared domain + pipeline types used by Steps/Reducers
export type { IBankConfig, ICanonicalScrapeResult, ISignPolicy } from '../../Types/Index.js';
export type {
  IBankFilter, IBankMetricsDelta, IBankQuarantineEntry,
  IBankQuarantineStage, IBankResult, IBankResultsState,
} from '../../Types/Pipeline/Index.js';
