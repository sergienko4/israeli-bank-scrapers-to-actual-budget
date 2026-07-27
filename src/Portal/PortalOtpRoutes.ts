/**
 * Portal OTP routes (behind the /api auth guard):
 *   GET  /api/otp/pending   — the mobile app polls for pending OTP requests
 *   POST /api/otp/:id       — the app submits the code the user entered
 *   GET  /api/otp/settings  — read the app-only OTP delivery channel
 *   PUT  /api/otp/settings  — set the channel (Telegram or app), app-only
 *
 * Codes are validated (4–8 digits) and never logged here. The channel lives in
 * a dedicated store, kept out of the config manifest so it is settable only
 * from the mobile app, never the web portal.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { IOtpRequest } from '../Services/TwoFactor/OtpRequestStore.js';
import OtpRequestStore from '../Services/TwoFactor/OtpRequestStore.js';
import OtpSettingsStore from '../Services/TwoFactor/OtpSettingsStore.js';

/** Matches a well-formed OTP code (4–8 digits). */
const OTP_CODE_RE = /^\d{4,8}$/;

/** The public view of a pending request (never carries the code). */
interface IPublicOtpRequest {
  id: string;
  bankId: string;
  createdAt: number;
  deadline: number;
}

/**
 * Projects a stored request to its public (code-free) view.
 * @param request - The stored request.
 * @returns The public request fields.
 */
function toPublic(request: IOtpRequest): IPublicOtpRequest {
  return {
    id: request.id,
    bankId: request.bankId,
    createdAt: request.createdAt,
    deadline: request.deadline,
  };
}

/**
 * Sends the live pending OTP requests (without codes).
 * @param reply - Fastify reply.
 * @returns The reply after sending the pending list.
 */
function sendPending(reply: FastifyReply): FastifyReply {
  const store = new OtpRequestStore();
  const requests = store.pending().map(toPublic);
  return reply.send({ requests });
}

/**
 * Validates and records the OTP code the user submitted from the app.
 * @param req - Request with an `:id` param and a JSON `{ code }` body.
 * @param reply - Fastify reply.
 * @returns The reply: 200 on success, 400 for a bad code, 404 for no request.
 */
function submitCode(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  const { id: requestId } = req.params as { id: string };
  const body = req.body as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!OTP_CODE_RE.test(code)) {
    return reply.code(400).send({ error: 'Invalid OTP code' });
  }
  const store = new OtpRequestStore();
  const wasAccepted = store.submit(requestId, code);
  if (!wasAccepted) {
    return reply.code(404).send({ error: 'No pending OTP request for this id' });
  }
  return reply.send({ ok: true });
}

/**
 * Sends the current OTP delivery channel.
 * @param reply - Fastify reply.
 * @returns The reply after sending the settings.
 */
function sendSettings(reply: FastifyReply): FastifyReply {
  const store = new OtpSettingsStore();
  const settings = store.get();
  return reply.send(settings);
}

/**
 * Validates and persists the OTP delivery channel.
 * @param req - Request with a JSON `{ channel }` body.
 * @param reply - Fastify reply.
 * @returns The reply: 200 on success, 400 for an invalid channel.
 */
function saveSettings(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  const body = req.body as { channel?: unknown } | null;
  const channel = body?.channel;
  if (channel !== 'telegram' && channel !== 'app') {
    return reply.code(400).send({ error: 'Invalid OTP channel' });
  }
  const store = new OtpSettingsStore();
  store.set(channel);
  return reply.send({ ok: true });
}

/**
 * Registers the OTP request + settings routes.
 * @param app - Fastify instance.
 * @returns Confirmation that the OTP routes are registered.
 */
export default function registerOtpRoutes(app: FastifyInstance): { registered: true } {
  app.get('/api/otp/pending', (_req, reply) => sendPending(reply));
  app.post('/api/otp/:id', (req, reply) => submitCode(req, reply));
  app.get('/api/otp/settings', (_req, reply) => sendSettings(reply));
  app.put('/api/otp/settings', (req, reply) => saveSettings(req, reply));
  return { registered: true };
}
