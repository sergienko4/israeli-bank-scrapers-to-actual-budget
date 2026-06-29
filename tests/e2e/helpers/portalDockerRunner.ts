/**
 * Docker helpers for running the config portal against a mounted config folder.
 */

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';

import { errorMessage } from '../../../src/Utils/Index.js';

const DOCKER_IMAGE = 'israeli-bank-importer:e2e';
const CONTAINER_CONFIG_PATH = '/app/config/config.json';
const PORTAL_POLL_INTERVAL_MS = 500;

/** A running Dockerized portal reachable from the host. */
export interface IPortalContainer {
  /** Docker container id printed by {@code docker run -d}. */
  id: string;
  /** Host URL bound to the container's portal port. */
  baseUrl: string;
}

/** Options for starting the Dockerized portal. */
interface IStartPortalContainerOptions {
  dir: string;
  hostPort: number;
  mode: 'ro' | 'rw';
}

/**
 * Builds the Docker CLI arguments for a portal container.
 * @param opts - Host directory, host port, and mount permission mode.
 * @returns Argument array safe for {@link execFileSync}.
 */
function dockerArgs(opts: IStartPortalContainerOptions): string[] {
  const portSpec = `127.0.0.1:${String(opts.hostPort)}:8080`;
  const volumeSpec = `${opts.dir}:/app/config:${opts.mode}`;
  return [
    'run', '-d', '--rm', '-p', portSpec, '-v', volumeSpec,
    '-e', 'PORTAL_ENABLED=true', '-e', 'PORTAL_HOST=0.0.0.0',
    '-e', `PORTAL_CONFIG_PATH=${CONTAINER_CONFIG_PATH}`,
    '-e', `CONFIG_PATH=${CONTAINER_CONFIG_PATH}`,
    DOCKER_IMAGE, 'node', 'dist/Portal.js',
  ];
}

/**
 * Provides Docker environment variables that preserve Windows volume paths.
 * @returns Process environment for Docker CLI invocations.
 */
function dockerEnv(): NodeJS.ProcessEnv {
  return { ...process.env, MSYS_NO_PATHCONV: '1' };
}

/**
 * Starts the config portal in the E2E Docker image.
 * @param opts - Host directory, host port, and mount permission mode.
 * @returns Container id and host base URL for browser/API access.
 */
export function startPortalContainer(opts: IStartPortalContainerOptions): IPortalContainer {
  const args = dockerArgs(opts);
  const env = dockerEnv();
  const output = execFileSync('docker', args, { encoding: 'utf8', env });
  const id = output.trim();
  const baseUrl = `http://127.0.0.1:${String(opts.hostPort)}`;
  return { id, baseUrl };
}

/**
 * Waits until the Dockerized portal serves its login page.
 * @param baseUrl - Host URL for the portal.
 * @param timeoutMs - Maximum time to wait before failing.
 * @returns Resolves when the portal responds with HTTP 200.
 */
export async function waitForPortal(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.status === 200) return;
    } catch (error: unknown) {
      void errorMessage(error);
    }
    // The portal is booting in another process; this bounded poll is the retry backoff.
    await setTimeout(PORTAL_POLL_INTERVAL_MS);
  }
  throw new Error(`Portal did not become ready at ${baseUrl}`);
}

/**
 * Stops a Dockerized portal container as best-effort test cleanup.
 * @param id - Docker container id to stop.
 * @returns Nothing; teardown errors are intentionally swallowed.
 */
export function stopPortalContainer(id: string): void {
  try {
    const env = dockerEnv();
    execFileSync('docker', ['stop', id], { encoding: 'utf8', env, stdio: 'pipe' });
  } catch (error: unknown) {
    void errorMessage(error);
  }
}

/**
 * Allocates an unused host TCP port for an isolated portal container.
 * @returns A port number that was free when probed.
 */
export async function freeHostPort(): Promise<number> {
  const server = createServer();
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => { resolve(port); });
    });
  });
}
