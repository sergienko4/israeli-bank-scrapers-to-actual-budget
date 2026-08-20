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
import { type IPortalRuntime, isLegacyProxyHopCount, isNonLoopbackHost } from './PortalRuntime.js';
import { handlePortalError } from './PortalValidationError.js';

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
 * Keys the rate limiter on the request's client address.
 *
 * Fastify resolves `req.ip` from `X-Forwarded-For` only as far as the runtime's
 * `trustProxy` setting allows, so a portal behind `tailscale serve` limits the
 * real caller while a directly-exposed portal cannot be tricked by a forged
 * header. Declaring it explicitly keeps that decision visible instead of
 * leaving it to the plugin default.
 * @param req - The incoming request being counted.
 * @returns The address the limiter counts this request against.
 */
function limiterKey(req: FastifyRequest): string {
  return req.ip;
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
  const app = Fastify({ logger: false, trustProxy: rt.trustProxy });
  await app.register(rateLimit, {
    max: 100, timeWindow: '1 minute', keyGenerator: limiterKey,
  });
  await app.register(cookie, { secret: rt.sessionSecret });
  await app.register(fstatic, { root: publicDir() });
  app.setErrorHandler(handlePortalError);
  registerAuthRoutes(app, rt, store);
  registerApiRoutes(app, store);
  app.setNotFoundHandler((req, reply) => (
    isSpaShellRequest(req) ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found' })
  ));
  return await app;
}

const HOP_COUNT_WARNING = '⚠️  PORTAL_TRUST_PROXY is set to a proxy hop count, a form Fastify removed in '
  + '5.12.1 because it trusted X-Forwarded-For on every connection regardless of who opened it '
  + '(GHSA-3m5p-2c4r-xxw2). The portal is therefore trusting no forwarded header, so every caller '
  + 'now shares one rate-limit bucket. Name the proxy\'s own address instead: `loopback` behind '
  + '`tailscale serve`, or an IP/CIDR such as 10.0.0.0/8.';

/**
 * Builds the warning shown when the portal listens beyond loopback.
 * @param host - Resolved bind host.
 * @returns The warning line to log.
 */
function exposedHostWarning(host: string): string {
  return `⚠️  Portal is bound to non-loopback host ${host} and reachable from the network. `
    + 'Put it behind a TLS reverse proxy and set PORTAL_SECURE_COOKIES=true so cookies '
    + 'and secrets are never sent over plain HTTP. Set PORTAL_TRUST_PROXY to the proxy\'s own '
    + 'address (`loopback` when it shares the host), or the rate limits will count the proxy '
    + 'instead of the caller and one client can spend the login budget for everyone.';
}

/**
 * Collects the boot warnings the resolved runtime deserves.
 * @param rt - Resolved portal runtime.
 * @returns Warning lines to log, empty when nothing is amiss.
 */
function bootWarnings(rt: IPortalRuntime): string[] {
  const warnings: string[] = [];
  if (isLegacyProxyHopCount()) warnings.push(HOP_COUNT_WARNING);
  if (!isNonLoopbackHost(rt.host)) return warnings;
  const exposed = exposedHostWarning(rt.host);
  warnings.push(exposed);
  return warnings;
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
  const warnings = bootWarnings(rt);
  for (const warning of warnings) getLogger().warn(warning);
  return app;
}
