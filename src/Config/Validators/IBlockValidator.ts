/**
 * IBlockValidator — Open/Closed Principle contract for config validation.
 *
 * Replaces `if (config.X) validateX()` chains in `ConfigLoader` and
 * `ConfigLoaderValidator` with a registry of self-describing validators.
 * Adding a new optional config block / notification channel = registering
 * one new entry; the dispatching code never changes.
 *
 * @template T - The config shape this validator inspects.
 */
import type { Procedure } from '../../Types/Index.js';

export interface IBlockValidator<T> {
  /** Stable name for logging and error attribution (e.g. "notifications"). */
  readonly name: string;

  /**
   * Predicate that decides whether this validator should run for the given config.
   * @param config - The parent config block.
   * @returns True if the validator's target sub-block is present.
   */
  applies(config: T): boolean;

  /**
   * Runs the validator. Only called when {@link IBlockValidator.applies} returns true.
   * @param config - The parent config block (the validator extracts its own slice).
   * @returns Procedure success when the block is valid, or failure with a message.
   */
  validate(config: T): Procedure<{ valid: true }>;
}
