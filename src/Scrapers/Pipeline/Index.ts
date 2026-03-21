/**
 * Pipeline barrel exports.
 */
export { default as ChainBuilder } from './Builder/ChainBuilder.js';
export { default as execute } from './Runner/PipelineRunner.js';
export type { IPipelineContext, IPipelineState, IServiceContainer } from './Types/PipelineContext.js';
export type { INamedStep, IStepMeta, PipelineStep } from './Types/PipelineStep.js';

// Re-export Result Pattern types so Steps/Strategies can import without deep paths
export type { IProcedureFailure,IProcedureSuccess, Procedure } from '../../Types/Index.js';
export { fail, isFail,isSuccess, succeed } from '../../Types/Index.js';
