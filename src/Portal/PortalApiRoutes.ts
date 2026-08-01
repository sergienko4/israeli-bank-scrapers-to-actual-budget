/**
 * Portal REST API: read/write config, add/remove banks, set targets, validate.
 * All routes sit behind the /api guard. Reads are masked; writes restore
 * masked secrets and persist via PortalConfigStore.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { BANK_REQUIREMENTS, CONFIG_MANIFEST } from '../Config/ConfigManifest.js';
import { getLogger } from '../Logger/Index.js';
import { DEFAULT_BANK_REGISTRY } from '../Scraper/BankRegistry.js';
import { AuditLogService } from '../Services/AuditLogService.js';
import DeviceTokenStore from '../Services/Notifications/DeviceTokenStore.js';
import type { IBankConfig, IImporterConfig } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { addBank, removeBank } from './ConfigMutations.js';
import type PortalConfigStore from './PortalConfigStore.js';
import registerOtpRoutes from './PortalOtpRoutes.js';
import {
  BANK_ADD_ROUTE, BANK_REMOVE_ROUTE, CONFIG_READ_ROUTE, CONFIG_WRITE_ROUTE,
  DEVICE_ROUTE, STATUS_ROUTE, VALIDATE_ROUTE,
} from './PortalRouteSchemas.js';

/** Static manifest payload (sections, supported bank ids, per-bank required keys), built once. */
const MANIFEST_PAYLOAD = {
  sections: CONFIG_MANIFEST,
  banks: DEFAULT_BANK_REGISTRY.list().map(bank => bank.bankId),
  bankRequirements: BANK_REQUIREMENTS,
};

/** How many recent import runs the status endpoint returns. */
const STATUS_HISTORY = 10;

/**
 * Registers the manifest probe + guarded config API routes.
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @returns Confirmation that the API routes are registered.
 */
export default function registerApiRoutes(
  app: FastifyInstance, store: PortalConfigStore,
): { registered: true } {
  // The manifest deliberately carries no response schema. Its field shape is
  // recursive, and a recursive schema cannot be inlined at the four places a
  // section refers to it without Fastify rejecting the duplicate reference.
  // Bounding the depth instead would let a deeply nested group be dropped
  // silently, which is the exact failure response schemas are meant to prevent.
  // The payload is a server-owned constant with nothing to strip, and
  // PortalContract.test.ts asserts it satisfies MANIFEST_BODY.
  app.get('/api/manifest', (_req, reply) => reply.send(MANIFEST_PAYLOAD));
  registerConfigRoutes(app, store);
  registerBankRoutes(app, store);
  registerStatusRoute(app);
  registerDeviceRoutes(app);
  registerValidateRoute(app, store);
  registerOtpRoutes(app);
  return { registered: true };
}

/**
 * Registers the read-only import-status route (recent redacted run summaries).
 * @param app - Fastify instance.
 * @returns Confirmation that the status route is registered.
 */
function registerStatusRoute(app: FastifyInstance): { registered: true } {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();
  typed.get('/api/status', STATUS_ROUTE, () => {
    const recent = new AuditLogService().getRecent(STATUS_HISTORY);
    return { runs: isFail(recent) ? [] : recent.data };
  });
  return { registered: true };
}

/**
 * Registers the config validation route (validate without persisting).
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @returns Confirmation that the validate route is registered.
 */
function registerValidateRoute(
  app: FastifyInstance, store: PortalConfigStore,
): { registered: true } {
  app.post('/api/validate', VALIDATE_ROUTE, (req, reply) => {
    try {
      const report = store.validate(req.body as IImporterConfig);
      return reply.type('application/json').send(report);
    } catch (error: unknown) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  return { registered: true };
}

/**
 * Adds or removes an Expo push token for the mobile app. The token's shape is
 * enforced by the route schema, so an unusable token never reaches here.
 * @param req - Request carrying a JSON `{ token }` body.
 * @param reply - Fastify reply.
 * @param action - Whether to register or unregister the token.
 * @returns The reply after sending the outcome.
 */
function handleDevice(
  req: FastifyRequest, reply: FastifyReply, action: 'add' | 'remove',
): FastifyReply {
  const { token } = req.body as { token: string };
  const store = new DeviceTokenStore();
  if (action === 'add') store.add(token);
  else store.remove(token);
  return reply.send({ ok: true });
}

/**
 * Registers the mobile-app device-registration routes (POST/DELETE /api/devices).
 * @param app - Fastify instance.
 * @returns Confirmation that the device routes are registered.
 */
function registerDeviceRoutes(app: FastifyInstance): { registered: true } {
  app.post('/api/devices', DEVICE_ROUTE, (req, reply) => handleDevice(req, reply, 'add'));
  app.delete('/api/devices', DEVICE_ROUTE, (req, reply) => handleDevice(req, reply, 'remove'));
  return { registered: true };
}

/**
 * Validates then writes a candidate config, mapping prepare failures to HTTP 400
 * (bad client input) and commit failures to HTTP 500 (server/I/O fault), so the
 * portal never reports a failed disk write as a client error. The 500 body is
 * generic; the underlying I/O detail (which can include host file paths) is
 * logged server-side only, never returned to the browser.
 * @param store - Shared config store.
 * @param next - Candidate config to persist.
 * @param reply - Fastify reply to send the outcome on.
 * @returns The Fastify reply, sent with the appropriate status.
 */
async function persistConfig(
  store: PortalConfigStore, next: IImporterConfig, reply: FastifyReply,
): Promise<FastifyReply> {
  const prepared = await store.prepare(next);
  if (isFail(prepared)) {
    const errors = prepared.details ?? [prepared.message];
    return await reply.code(400).send({ error: prepared.message, errors });
  }
  const committed = store.commit(prepared.data);
  if (isFail(committed)) {
    getLogger().error(`Portal config persist failed: ${committed.message}`);
    return await reply.code(500).send({ error: 'Failed to persist configuration' });
  }
  return await reply.send({ ok: true });
}

/**
 * Registers the masked-read + validated-write config routes.
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @returns Confirmation that the config routes are registered.
 */
function registerConfigRoutes(
  app: FastifyInstance, store: PortalConfigStore,
): { registered: true } {
  app.get('/api/config', CONFIG_READ_ROUTE, (_req, reply) => {
    const masked = store.masked();
    return reply.send(masked);
  });
  app.put('/api/config', CONFIG_WRITE_ROUTE, (req, reply) => (
    persistConfig(store, req.body as IImporterConfig, reply)
  ));
  return { registered: true };
}

/**
 * Registers add/remove bank routes that mutate then persist the config.
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @returns Confirmation that the bank routes are registered.
 */
function registerBankRoutes(app: FastifyInstance, store: PortalConfigStore): { registered: true } {
  app.post('/api/banks/:name', BANK_ADD_ROUTE, (req, reply) => {
    const { name } = req.params as { name: string };
    const current = store.raw();
    const next = addBank(current, name, req.body as IBankConfig);
    return persistConfig(store, next, reply);
  });
  app.delete('/api/banks/:name', BANK_REMOVE_ROUTE, (req, reply) => {
    const { name } = req.params as { name: string };
    const current = store.raw();
    const next = removeBank(current, name);
    return persistConfig(store, next, reply);
  });
  return { registered: true };
}
