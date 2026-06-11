/**
 * Barrel re-export for the ImportMediator sub-modules.
 *
 * Four focused helpers, each owning a single concern previously
 * carried inline in ImportMediator: pure batch/job construction
 * (BatchFactory), notification dispatch (BatchSummaryNotifier),
 * poller pause/resume state machine (PollerLifecycle), and the
 * per-job spawn-collect loop (JobProcessor). Re-exported here for
 * cohesive imports.
 */
export {
  buildBatchResult,
  buildDeferredPromise,
  createJob,
  createTracker,
  type IBatchTracker,
  type IDeferredBatchPromise,
  toJobResult,
} from './BatchFactory.js';
export { default as BatchSummaryNotifier } from './BatchSummaryNotifier.js';
export {
  type BatchFinalizedCallback,
  type IJobProcessorOptions,
  type ITrackerStore,
  default as JobProcessor,
  type SpawnImport,
} from './JobProcessor.js';
export { default as PollerLifecycle } from './PollerLifecycle.js';
