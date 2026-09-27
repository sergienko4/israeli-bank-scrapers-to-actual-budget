/**
 * Times a scan against a limit without failing on a busy machine.
 *
 * <p>Other work on the machine can only slow a run, so one slow run is noise,
 * while a quadratic scan is slow every time.
 */

/** How many times a scan may run before its time counts. */
const ATTEMPTS = 3;

/**
 * Times a scan, trying up to three times until one finishes within the limit.
 * @param scan - The scan to time.
 * @param limitMs - The time a run must finish within, in milliseconds.
 * @returns The fastest run's time, in milliseconds.
 */
export default function fastestRunMs(scan: () => unknown, limitMs: number): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < ATTEMPTS && fastest >= limitMs; attempt++) {
    const started = performance.now();
    scan();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}
