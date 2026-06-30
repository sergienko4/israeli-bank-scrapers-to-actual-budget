/**
 * Builds and starts the Fastify portal server: cookie + static plugins, auth
 * routes, REST API, and a SPA fallback. Binds host/port from the runtime.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { getLogger } from '../Logger/Index.js';
import registerApiRoutes from './PortalApiRoutes.js';
import { registerAuthRoutes } from './PortalAuthRoutes.js';
import PortalConfigStore from './PortalConfigStore.js';
import { type IPortalRuntime, isNonLoopbackHost } from './PortalRuntime.js';

/**
 * Resolves the static UI directory (compiled dist or source fallback).
 * @returns Absolute path to the portal public assets.
 */
function publicDir(): string {
  const file = fileURLToPath(import.meta.url);
  const here = dirname(file);
  const local = join(here, 'Public');
  return existsSync(local) ? local : join(here, '..', '..', 'src', 'Portal', 'Public');
}

/**
 * Whether an unmatched request should fall through to the SPA shell.
 *
 * Only GET navigations to non-API, non-auth, extension-less paths are genuine
 * front-end routes. The query string is ignored so a deep link such as
 * `/report?ref=a.b` is still served the shell instead of being mistaken for a
 * static asset. Missing `/api/*` or `/auth/*` endpoints (and absent static
 * assets) must surface as a JSON 404 rather than be masked by index.html, which
 * would hide routing bugs and break the API contract.
 * @param req - The unmatched incoming request.
 * @returns True when index.html should be served for this request.
 */
function isSpaShellRequest(req: FastifyRequest): boolean {
  const [path] = req.url.split('?');
  return req.method === 'GET'
    && path !== '/api'
    && !path.startsWith('/api/')
    && path !== '/auth'
    && !path.startsWith('/auth/')
    && !path.includes('.');
}

/**
 * Assembles the Fastify app with plugins, routes, and SPA fallback.
 * @param rt - Resolved portal runtime.
 * @param store - Config store backing the API.
 * @returns Configured Fastify instance.
 */
export async function buildPortal(
  rt: IPortalRuntime, store: PortalConfigStore,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(cookie, { secret: rt.sessionSecret });
  await app.register(fstatic, { root: publicDir() });
  registerAuthRoutes(app, rt);
  registerApiRoutes(app, store);
  app.setNotFoundHandler((req, reply) => (
    isSpaShellRequest(req) ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found' })
  ));
  return await app;
}

/**
 * Builds and starts the portal server, logging the bind address.
 * @param rt - Resolved portal runtime.
 * @param configPath - Path to config.json for the store.
 * @returns The listening Fastify instance.
 */
export async function startPortal(
  rt: IPortalRuntime, configPath: string,
): Promise<FastifyInstance> {
  const app = await buildPortal(rt, new PortalConfigStore(configPath));
  await app.listen({ host: rt.host, port: rt.port });
  const url = `http://${rt.host}:${String(rt.port)}`;
  getLogger().info(`🖥️  Config portal on ${url} (auth: ${rt.authMode})`);
  if (isNonLoopbackHost(rt.host)) {
    getLogger().warn(
      `⚠️  Portal is bound to non-loopback host ${rt.host} and reachable from the network. `
      + 'Put it behind a TLS reverse proxy and set PORTAL_SECURE_COOKIES=true so cookies '
      + 'and secrets are never sent over plain HTTP.',
    );
  }
  return app;
}
