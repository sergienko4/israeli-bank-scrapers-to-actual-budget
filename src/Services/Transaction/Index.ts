/**
 * Barrel re-export for the TransactionService sub-modules.
 *
 * Four focused helpers, each owning a single concern previously
 * carried inline in TransactionService: imported_id construction
 * (pure / no I/O), dedup query (single Actual AQL wrapper),
 * account resolution (Procedure pattern + name-fallback),
 * and the dedup-aware import loop. Re-exported here for cohesive
 * imports.
 */
export { default as AccountResolver } from './AccountResolver.js';
export { default as DedupQuery } from './DedupQuery.js';
export {
  buildImportedId,
  buildImportedIdLegacy,
  parseTransaction,
} from './ImportedIdBuilder.js';
export {
  type IBatchOpts,
  type IBatchOutcome,
  default as TransactionBatchImporter,
} from './TransactionBatchImporter.js';
