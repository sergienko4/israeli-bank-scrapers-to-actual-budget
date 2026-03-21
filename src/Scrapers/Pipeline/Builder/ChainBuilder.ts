/**
 * ChainBuilder — type-safe builder for composing pipeline steps.
 * Immutable: each .add() returns the same builder with an extended internal list.
 */

import type { INamedStep, IStepMeta, PipelineStep } from '../Types/PipelineStep.js';

/** Builds an ordered list of named pipeline steps. */
export default class ChainBuilder {
  private readonly _steps: INamedStep[];

  /** Creates an empty ChainBuilder. */
  constructor() {
    this._steps = [];
  }

  /**
   * Appends a step with metadata to the pipeline.
   * @param step - The step function to add.
   * @param meta - Name and description for logging.
   * @returns This builder for chaining.
   */
  public add(step: PipelineStep, meta: IStepMeta): this {
    const frozenStep = Object.freeze({ execute: step, meta });
    this._steps.push(frozenStep);
    return this;
  }

  /**
   * Builds the final frozen array of named steps.
   * @returns Immutable array of INamedStep objects.
   */
  public build(): readonly INamedStep[] {
    return Object.freeze([...this._steps]);
  }
}
