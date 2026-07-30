/**
 * Composition point for the app sign-in routes. The authorize, token and
 * refresh families only work together if they share one authorization-code
 * table and one refresh-token store, so both are constructed here once and
 * handed to each family rather than created per route.
 */

import type { FastifyInstance } from 'fastify';

import { AppAuthCodes } from './AppAuthCodes.js';
import { registerAppAuthRoutes, type SessionResolver } from './AppAuthRoutes.js';
import { registerAppRefreshRoutes } from './AppRefreshRoutes.js';
import { registerAppSessionRoutes } from './AppSessionRoutes.js';
import { registerAppTokenRoutes } from './AppTokenRoutes.js';
import { AppTokenStore } from './AppTokenStore.js';
import type { RuntimeAccessor } from './PortalRuntime.js';

/**
 * Registers every app sign-in route against one shared code table and one
 * shared refresh-token store.
 * @param app - Fastify instance to register on.
 * @param live - Accessor returning the current per-request portal runtime.
 * @param sessionOf - Resolver reading the browser session from a request.
 * @returns A marker confirming registration ran.
 */
export default function registerAppRoutes(
  app: FastifyInstance,
  live: RuntimeAccessor,
  sessionOf: SessionResolver,
): { registered: true } {
  const codes = new AppAuthCodes();
  const tokens = new AppTokenStore();
  registerAppAuthRoutes(app, { live, codes, sessionOf });
  registerAppTokenRoutes(app, { live, codes, tokens });
  registerAppRefreshRoutes(app, { live, tokens });
  registerAppSessionRoutes(app, { live, tokens });
  return { registered: true };
}
