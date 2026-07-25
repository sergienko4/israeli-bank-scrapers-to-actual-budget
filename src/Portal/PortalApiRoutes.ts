/**
 * Portal REST API: read/write config, add/remove banks, set targets, validate.
 * All routes sit behind the /api guard. Reads are masked; writes restore
 * masked secrets and persist via PortalConfigStore.
 */

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

/** Static manifest payload (sections, supported bank ids, per-bank required keys), built once. */
const MANIFEST_PAYLOAD = {
  sections: CONFIG_MANIFEST,
  banks: DEFAULT_BANK_REGISTRY.list().map(bank => bank.bankId),
  bankRequirements: BANK_REQUIREMENTS,
};

/** How many recent import runs the status endpoint returns. */
const STATUS_HISTORY = 10;

/** Matches a well-formed Expo push token, e.g. ExponentPushToken[xxxx]. */
const EXPO_TOKEN_RE = /^Expo(?:nent)?PushToken\[[^\]]+\]$/;

/**
 * Registers the manifest probe + guarded config API routes.
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @returns Confirmation that the API routes are registered.
 */
export default function registerApiRoutes(
  app: FastifyInstance, store: PortalConfigStore,
): { registered: true } {
  app.get('/api/manifest', (_req, reply) => reply.send(MANIFEST_PAYLOAD));
  registerConfigRoutes(app, store);
  registerBankRoutes(app, store);
  registerStatusRoute(app);
  registerDeviceRoutes(app);
  registerValidateRoute(app, store);
  return { registered: true };
}

/**
 * Registers the read-only import-status route (recent redacted run summaries).
 * @param app - Fastify instance.
 * @returns Confirmation that the status route is registered.
 */
function registerStatusRoute(app: FastifyInstance): { registered: true } {
  app.get('/api/status', (_req, reply) => {
    const recent = new AuditLogService().getRecent(STATUS_HISTORY);
    return reply.send({ runs: isFail(recent) ? [] : recent.data });
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
  app.post('/api/validate', (req, reply) => {
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
 * Adds or removes an Expo push token for the mobile app, validating its format.
 * @param req - Request carrying a JSON `{ token }` body.
 * @param reply - Fastify reply.
 * @param action - Whether to register or unregister the token.
 * @returns The reply after sending the outcome.
 */
function handleDevice(
  req: FastifyRequest, reply: FastifyReply, action: 'add' | 'remove',
): FastifyReply {
  const body = req.body as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!EXPO_TOKEN_RE.test(token)) {
    return reply.code(400).send({ error: 'Invalid Expo push token' });
  }
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
  app.post('/api/devices', (req, reply) => handleDevice(req, reply, 'add'));
  app.delete('/api/devices', (req, reply) => handleDevice(req, reply, 'remove'));
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
  app.get('/api/config', (_req, reply) => {
    const masked = store.masked();
    return reply.send(masked);
  });
  app.put('/api/config', (req, reply) => persistConfig(store, req.body as IImporterConfig, reply));
  return { registered: true };
}

/**
 * Registers add/remove bank routes that mutate then persist the config.
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @returns Confirmation that the bank routes are registered.
 */
function registerBankRoutes(app: FastifyInstance, store: PortalConfigStore): { registered: true } {
  app.post('/api/banks/:name', (req, reply) => {
    const { name } = req.params as { name: string };
    const current = store.raw();
    const next = addBank(current, name, req.body as IBankConfig);
    return persistConfig(store, next, reply);
  });
  app.delete('/api/banks/:name', (req, reply) => {
    const { name } = req.params as { name: string };
    const current = store.raw();
    const next = removeBank(current, name);
    return persistConfig(store, next, reply);
  });
  return { registered: true };
}
