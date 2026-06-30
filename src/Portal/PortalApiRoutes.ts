/**
 * Portal REST API: read/write config, add/remove banks, set targets, validate.
 * All routes sit behind the /api guard. Reads are masked; writes restore
 * masked secrets and persist via PortalConfigStore.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

import { BANK_REQUIREMENTS, CONFIG_MANIFEST } from '../Config/ConfigManifest.js';
import { getLogger } from '../Logger/Index.js';
import { DEFAULT_BANK_REGISTRY } from '../Scraper/BankRegistry.js';
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
function persistConfig(
  store: PortalConfigStore, next: IImporterConfig, reply: FastifyReply,
): FastifyReply {
  const prepared = store.prepare(next);
  if (isFail(prepared)) return reply.code(400).send({ error: prepared.message });
  const committed = store.commit(prepared.data);
  if (isFail(committed)) {
    getLogger().error(`Portal config persist failed: ${committed.message}`);
    return reply.code(500).send({ error: 'Failed to persist configuration' });
  }
  return reply.send({ ok: true });
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
