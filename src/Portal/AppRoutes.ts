/**
 * Composition point for the app sign-in routes. The authorize, token and
 * refresh families only work together if they share one authorization-code
 * table and one refresh-token file, so the code table and the store opener are
 * obtained here once and handed to each family. The opener comes from the
 * portal's store bag, the same one the start sweep uses; each request opens
 * the store with the live refresh-token lifetime.
 */

import type { FastifyInstance } from 'fastify';

import { AppAuthCodes } from './AppAuthCodes.js';
import { registerAppAuthRoutes, type SessionResolver } from './AppAuthRoutes.js';
import { registerAppRefreshRoutes } from './AppRefreshRoutes.js';
import { registerAppSessionRoutes } from './AppSessionRoutes.js';
import { registerAppTokenRoutes } from './AppTokenRoutes.js';
import type { RuntimeAccessor } from './PortalRuntime.js';
import type { IPortalStores } from './PortalStores.js';

/** What the app sign-in routes need. */
export interface IAppRouteDeps {
  /** Accessor returning the current per-request portal runtime. */
  readonly live: RuntimeAccessor;
  /** Resolver reading the browser session from a request. */
  readonly sessionOf: SessionResolver;
  /** The store bag the refresh-token store is opened from. */
  readonly stores: Pick<IPortalStores, 'appTokens'>;
}

/**
 * Registers every app sign-in route against one shared code table and one
 * shared refresh-token store.
 * @param app - Fastify instance to register on.
 * @param deps - The runtime accessor, session resolver and store bag.
 * @returns A marker confirming registration ran.
 */
export default function registerAppRoutes(
  app: FastifyInstance,
  deps: IAppRouteDeps,
): { registered: true } {
  const { live, sessionOf } = deps;
  const codes = new AppAuthCodes();
  const openTokens = deps.stores.appTokens;
  registerAppAuthRoutes(app, { live, codes, sessionOf });
  registerAppTokenRoutes(app, { live, codes, openTokens });
  registerAppRefreshRoutes(app, { live, openTokens });
  registerAppSessionRoutes(app, { live, openTokens });
  return { registered: true };
}
