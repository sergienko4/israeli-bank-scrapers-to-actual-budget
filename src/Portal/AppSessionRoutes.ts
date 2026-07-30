/**
 * Device management for app sign-ins: what is signed in, and how to sign it
 * out. Revoking one entry drops the whole refresh-token family, because a
 * rotated token and its predecessor are the same device holding a newer key.
 *
 * The listing is deliberately thin. Everything the store keeps for its own
 * checks - the token hash, the credential fingerprint, the family id - would
 * help an attacker who already reached this endpoint and helps nobody else.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isSuccess } from '../Types/Index.js';
import type { AppTokenStore, IAppTokenRecord } from './AppTokenStore.js';
import type { RuntimeAccessor } from './PortalRuntime.js';
import { bearerSessionOf } from './PortalTokenAuth.js';

/** Shape of a record id, as minted by the token store. */
const SESSION_ID = /^[\w-]{22}$/;

/** Collaborators the session routes need, injected to avoid an import cycle. */
export interface IAppSessionDeps {
  live: RuntimeAccessor;
  tokens: AppTokenStore;
}

/** One signed-in device, as shown to the user. */
export interface IAppSessionView {
  id: string;
  deviceName: string;
  issuedAt: number;
  lastUsedAt: number;
  expiresAt: number;
  current: boolean;
}

/**
 * Reduces a stored record to the fields safe to hand back.
 * @param record - The stored refresh-token record.
 * @param family - Family of the calling access token, when it has one.
 * @returns The redacted view of that session.
 */
export function sessionView(record: IAppTokenRecord, family?: string): IAppSessionView {
  return {
    id: record.id,
    deviceName: record.deviceName,
    issuedAt: record.issuedAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    current: family !== undefined && record.familyId === family,
  };
}

/**
 * Lists every live app session.
 * @param req - Incoming request.
 * @param reply - Outgoing reply.
 * @param deps - Injected collaborators.
 * @returns The reply, already sent.
 */
function handleList(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: IAppSessionDeps,
): FastifyReply {
  const runtime = deps.live();
  const caller = bearerSessionOf(req, runtime);
  // A browser cookie session has no family, so nothing is marked as current.
  const family = isSuccess(caller) ? caller.data.family : undefined;
  const records = deps.tokens.list();
  const views = records.map((record) => sessionView(record, family));
  return reply.code(200).send(views);
}

/**
 * Signs one device out, along with every token it rotated through.
 * @param req - Incoming request.
 * @param reply - Outgoing reply.
 * @param deps - Injected collaborators.
 * @returns The reply, already sent.
 */
function handleRevoke(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: IAppSessionDeps,
): FastifyReply {
  const params = req.params as { id: string };
  const sessionId = params.id;
  if (!SESSION_ID.test(sessionId)) return reply.code(404).send({ error: 'Unknown session' });
  const records = deps.tokens.list();
  const match = records.find((record) => record.id === sessionId);
  if (!match) return reply.code(404).send({ error: 'Unknown session' });
  deps.tokens.revokeFamily(match.familyId);
  return reply.code(200).send({ ok: true });
}

/**
 * Registers the app session management routes under the `/api` guard.
 * @param app - Fastify instance to register on.
 * @param deps - Injected collaborators.
 * @returns A marker confirming registration ran.
 */
export function registerAppSessionRoutes(
  app: FastifyInstance,
  deps: IAppSessionDeps,
): { registered: true } {
  app.get('/api/app/sessions', (req, reply) => handleList(req, reply, deps));
  app.delete('/api/app/sessions/:id', (req, reply) => handleRevoke(req, reply, deps));
  return { registered: true };
}
