/**
 * Spawns the import child process and reports its exit code.
 *
 * The child entry path is configurable via IMPORT_CHILD_ENTRY (defaults to
 * the Docker container layout '/app/dist/Index.js'), so the scheduler can be
 * exercised in tests and local runs without a packaged build.
 *
 * The child node binary is resolved via process.execPath (absolute path) so
 * the spawn does not rely on PATH lookup. The child still inherits PATH so
 * downstream tools (e.g. the Camoufox browser launcher) can locate Firefox.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import { getLogger } from '../Logger/Index.js';
import type { IProcedureSuccess } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';

const DEFAULT_IMPORT_CHILD_ENTRY = '/app/dist/Index.js';

/**
 * Resolves the path to the import child entry script.
 *
 * @returns Path to the compiled import entry script.
 */
function resolveChildEntry(): string {
  return process.env.IMPORT_CHILD_ENTRY ?? DEFAULT_IMPORT_CHILD_ENTRY;
}

/**
 * Builds the env object passed to the child, merging extras over process.env.
 *
 * @param extraEnv - Additional environment variables to inject into the child.
 * @returns The env object to pass to spawn (reuses process.env when no extras).
 */
function buildChildEnv(extraEnv: Record<string, string>): NodeJS.ProcessEnv {
  if (Object.keys(extraEnv).length === 0) return process.env;
  return { ...process.env, ...extraEnv };
}

/**
 * Attaches the exit and error listeners that resolve the spawn promise.
 *
 * @param child - The spawned child process to listen on.
 * @param startTime - The Date when the import started (for duration logging).
 * @param resolve - Callback invoked with the child's effective exit code.
 * @returns Procedure indicating the listeners were attached.
 */
function attachChildListeners(
  child: ChildProcess, startTime: Date, resolve: (code: number) => unknown
): IProcedureSuccess<{ status: string }> {
  const logger = getLogger();
  child.on('exit', (exitCode, signal) => {
    const code = exitCode ?? (signal ? 1 : 0);
    if (signal) logger.warn(`Import killed by signal: ${signal}`);
    logImportResult(code, startTime);
    resolve(code);
  });
  child.on('error', (err) => {
    logger.error(`❌ Failed to start import: ${err.message}`);
    logImportResult(1, startTime);
    resolve(1);
  });
  return succeed({ status: 'listeners-attached' });
}

/**
 * Spawns the import child process and resolves with its exit code.
 *
 * @param extraEnv - Additional environment variables to inject into the child.
 * @returns Promise resolving to the child process exit code (0 = success).
 */
export function spawnImport(extraEnv: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const startTime = new Date();
    getLogger().info(`\n⏰ ${startTime.toISOString()}: Starting import...`);
    const env = buildChildEnv(extraEnv);
    const child: ChildProcess = spawn(
      process.execPath, [resolveChildEntry()], { stdio: 'inherit', env }
    );
    attachChildListeners(child, startTime, resolve);
  });
}

/**
 * Logs the result of a completed import child process.
 *
 * @param code - Exit code from the child process (0 if terminated by signal).
 * @param startTime - The Date when the import started, used to compute duration.
 * @returns A successful Procedure indicating the result was logged.
 */
export function logImportResult(
  code: number, startTime: Date
): IProcedureSuccess<{ status: string }> {
  const logger = getLogger();
  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const time = new Date().toISOString();
  if (code === 0) {
    logger.info(`✅ ${time}: Import completed successfully (took ${String(duration)}s)`);
  } else {
    logger.error(
      `❌ ${time}: Import failed with exit code ${String(code)} (took ${String(duration)}s)`
    );
  }
  return succeed({ status: 'logged' });
}
