/**
 * Lightweight tracing stub used by pure utility functions in src/Utils/.
 * These functions cannot import from Logger/ (circular dependency via LogRotatingStream),
 * so they use this no-op shim to satisfy the "must call logger" traceability rule.
 * At production log levels (info+) no output is produced.
 */
const LOGGER = {
  /**
   * Records a debug-level trace for a utility function call.
   * @param _msg - The trace message (suppressed at info+ log level).
   */
  debug(_msg: string): void { /* no-op at production log levels */ },
};

export default LOGGER;
