/**
 * Pipeline step type definitions.
 * A step is a function that transforms context and returns a Procedure.
 */

import type { Procedure } from '../../../Types/Index.js';
import type { IPipelineContext } from './PipelineContext.js';

/** A single pipeline step: receives context, returns new context or failure. */
export type PipelineStep = (ctx: IPipelineContext) => Promise<Procedure<IPipelineContext>>;

/** Metadata describing a pipeline step for logging and debugging. */
export interface IStepMeta {
  readonly name: string;
  readonly description: string;
}

/** A pipeline step decorated with metadata. */
export interface INamedStep {
  readonly execute: PipelineStep;
  readonly meta: IStepMeta;
}
