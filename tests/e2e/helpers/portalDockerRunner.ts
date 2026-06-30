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
const PORTAL_READY_TIMEOUT_MS = 90_000;

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
  /** Retained for the existing caller; Docker now assigns the actual host port. */
  hostPort: number;
  mode: 'ro' | 'rw';
}

/**
 * Maps the container to the host user so it writes config files as that user.
 * The portal persists `credentials.json` at mode 0600; running as the host uid
 * lets the test process (same uid) both grant write access to the mounted dir
 * and read those secrets back when asserting persistence. POSIX-only: Windows
 * lacks getuid/getgid and Docker Desktop manages volume permissions itself, so
 * the mapping is omitted there.
 * @returns `['--user', 'uid:gid']` on POSIX hosts, otherwise an empty array.
 */
function hostUserArgs(): string[] {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) return [];
  return ['--user', `${String(uid)}:${String(gid)}`];
}

/**
 * Builds the Docker CLI arguments for a portal container.
 *
 * Publishes the container's portal port to an OS-assigned host port
 * ({@code 127.0.0.1::8080}) instead of a pre-chosen one, so concurrent E2E runs
 * cannot collide on a probed-then-released port; {@link startPortalContainer}
 * reads the bound port back afterwards.
 * @param opts - Host directory and mount permission mode.
 * @returns Argument array safe for {@link execFileSync}.
 */
function dockerArgs(opts: IStartPortalContainerOptions): string[] {
  const portSpec = '127.0.0.1::8080';
  const volumeSpec = `${opts.dir}:/app/config:${opts.mode}`;
  return [
    'run', '-d', ...hostUserArgs(), '-p', portSpec, '-v', volumeSpec,
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
 * Reads the host port Docker bound to the container's portal port.
 *
 * Pairs with the {@code 127.0.0.1::8080} publish in {@link dockerArgs}: Docker
 * owns the allocation and the binding is read back here, eliminating the
 * probe-then-reuse race that made parallel runs flaky. Throws when Docker
 * reports no usable mapping.
 * @param id - Docker container id.
 * @returns The bound host port number.
 */
function mappedHostPort(id: string): number {
  const env = dockerEnv();
  const output = execFileSync('docker', ['port', id, '8080/tcp'], { encoding: 'utf8', env });
  const mapping = output.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  const port = Number(mapping?.split(':').pop());
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`No host port mapped for the portal container: ${output.trim()}`);
  }
  return port;
}

/**
 * Starts the config portal in the E2E Docker image on a Docker-assigned port.
 * @param opts - Host directory and mount permission mode.
 * @returns Container id and host base URL for browser/API access.
 */
export function startPortalContainer(opts: IStartPortalContainerOptions): IPortalContainer {
  const args = dockerArgs(opts);
  const env = dockerEnv();
  const output = execFileSync('docker', args, { encoding: 'utf8', env });
  const id = output.trim();
  const hostPort = mappedHostPort(id);
  const baseUrl = `http://127.0.0.1:${String(hostPort)}`;
  return { id, baseUrl };
}

/**
 * Captures container state and recent logs to diagnose a failed portal start.
 * @param id - Docker container id.
 * @returns A diagnostic string with the container's state and tail logs.
 */
function portalDiagnostics(id: string): string {
  const env = dockerEnv();
  try {
    const fmt = '{{.State.Status}} exitCode={{.State.ExitCode}}';
    const state = execFileSync(
      'docker', ['inspect', '-f', fmt, id], { encoding: 'utf8', env, stdio: 'pipe' },
    ).trim();
    const logs = execFileSync(
      'docker', ['logs', '--tail', '50', id], { encoding: 'utf8', env, stdio: 'pipe' },
    );
    return `container ${state}\n--- docker logs (tail) ---\n${logs}`;
  } catch (error: unknown) {
    return `diagnostics unavailable: ${errorMessage(error)}`;
  }
}

/**
 * Reports whether the container has already exited (e.g. crashed on boot).
 * @param id - Docker container id.
 * @returns True when Docker reports the container as exited or dead.
 */
function hasExited(id: string): boolean {
  const env = dockerEnv();
  try {
    const status = execFileSync(
      'docker', ['inspect', '-f', '{{.State.Status}}', id], { encoding: 'utf8', env, stdio: 'pipe' },
    ).trim();
    return status === 'exited' || status === 'dead';
  } catch (error: unknown) {
    void errorMessage(error);
    return false;
  }
}

/**
 * Polls the portal once for its HTTP 200 login page.
 * @param baseUrl - Host URL for the portal.
 * @returns True when the portal answered with HTTP 200.
 */
async function portalServes(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(baseUrl);
    return response.status === 200;
  } catch (error: unknown) {
    void errorMessage(error);
    return false;
  }
}

/**
 * Waits until the Dockerized portal serves its login page, failing fast with
 * container logs if the container exits before becoming ready.
 * @param container - Running portal container (id + base URL).
 * @param timeoutMs - Maximum time to wait before failing.
 * @returns Resolves when the portal responds with HTTP 200.
 */
export async function waitForPortal(
  container: IPortalContainer, timeoutMs = PORTAL_READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portalServes(container.baseUrl)) return;
    if (hasExited(container.id)) {
      throw new Error(`Portal container exited before serving.\n${portalDiagnostics(container.id)}`);
    }
    // The portal is booting in another process; this bounded poll is the retry backoff.
    await setTimeout(PORTAL_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Portal did not become ready at ${container.baseUrl}.\n${portalDiagnostics(container.id)}`,
  );
}

/**
 * Stops and removes a Dockerized portal container as best-effort test cleanup.
 * @param id - Docker container id to remove.
 * @returns Nothing; teardown errors are intentionally swallowed.
 */
export function stopPortalContainer(id: string): void {
  try {
    const env = dockerEnv();
    execFileSync('docker', ['rm', '-f', id], { encoding: 'utf8', env, stdio: 'pipe' });
  } catch (error: unknown) {
    void errorMessage(error);
  }
}

/**
 * Allocates an unused host TCP port by briefly binding port 0.
 *
 * Retained for the existing caller; {@link startPortalContainer} no longer
 * binds to this number (Docker assigns the host port), so the prior
 * probe-then-reuse race no longer affects container startup.
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
