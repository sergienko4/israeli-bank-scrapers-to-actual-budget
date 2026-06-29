/**
 * Portal REST API: read/write config, add/remove banks, set targets, validate.
 * All routes sit behind the /api guard. Reads are masked; writes restore
 * masked secrets and persist via PortalConfigStore.
 */

import type { FastifyInstance } from 'fastify';

import { ConfigValidator } from '../Config/ConfigValidator.js';
import type { IBankConfig, IImporterConfig } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import { addBank, removeBank } from './ConfigMutations.js';
import type PortalConfigStore from './PortalConfigStore.js';

/**
 * Registers the public auth-mode probe + guarded config API routes.
 * @param app - Fastify instance.
 * @param store - Shared config store.
 * @param authMode - Configured auth mode, exposed for the login page.
 * @returns Confirmation that the API routes are registered.
 */
export default function registerApiRoutes(
  app: FastifyInstance, store: PortalConfigStore, authMode: string,
): { registered: true } {
  app.get('/auth/mode', (_req, reply) => reply.send({ authMode }));
  app.get('/api/config', (_req, reply) => {
    const masked = store.masked();
    return reply.send(masked);
  });
  app.put('/api/config', (req, reply) => {
    const result = store.save(req.body as IImporterConfig);
    if (isFail(result)) return reply.code(400).send({ error: result.message });
    return reply.send({ ok: true });
  });
  registerBankRoutes(app, store);
  app.post('/api/validate', (req, reply) => {
    const report = ConfigValidator.validateOffline(req.body as IImporterConfig);
    return reply.type('application/json').send(report);
  });
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
    const result = store.save(next);
    if (isFail(result)) return reply.code(400).send({ error: result.message });
    return reply.send({ ok: true });
  });
  app.delete('/api/banks/:name', (req, reply) => {
    const { name } = req.params as { name: string };
    const current = store.raw();
    const next = removeBank(current, name);
    const result = store.save(next);
    if (isFail(result)) return reply.code(400).send({ error: result.message });
    return reply.send({ ok: true });
  });
  return { registered: true };
}
