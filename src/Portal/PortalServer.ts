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
import Fastify, { type FastifyInstance } from 'fastify';

import { getLogger } from '../Logger/Index.js';
import registerApiRoutes from './PortalApiRoutes.js';
import { registerAuthRoutes } from './PortalAuthRoutes.js';
import PortalConfigStore from './PortalConfigStore.js';
import type { IPortalRuntime } from './PortalRuntime.js';

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
  registerApiRoutes(app, store, rt.authMode);
  app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
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
  return app;
}
