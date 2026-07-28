/**
 * Portal OTP routes (behind the /api auth guard):
 *   GET  /api/otp/pending   — the mobile app polls for pending OTP requests
 *   POST /api/otp/:id       — the app submits the code the user entered
 *   GET  /api/otp/settings  — read the OTP delivery channel
 *   PUT  /api/otp/settings  — set the channel (Telegram or app)
 *
 * Codes are validated (4–8 digits), rate-limited, and never logged here. The
 * channel lives in a dedicated store outside the config manifest, so the web
 * portal UI never surfaces it and it is intended to be set from the mobile app.
 * Both the app and the web portal authenticate to the same portal API, so this
 * is UI-level scoping, not a separate authorization boundary.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { IOtpRequest } from '../Services/TwoFactor/OtpRequestStore.js';
import OtpRequestStore from '../Services/TwoFactor/OtpRequestStore.js';
import OtpSettingsStore from '../Services/TwoFactor/OtpSettingsStore.js';
import { OTP_SUBMIT_MAX, RATE_WINDOW } from './PortalRateLimit.js';

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
 * Parses and validates a submitted OTP code value.
 * @param rawCode - The `code` field from the request body, of unknown type.
 * @returns The trimmed 4–8 digit code, or an empty string when absent/malformed.
 */
function parseOtpCode(rawCode: unknown): string {
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  return OTP_CODE_RE.test(code) ? code : '';
}

/**
 * Sends the live pending OTP requests (without codes) to the mobile app.
 * @param _req - Fastify request (unused).
 * @param reply - Fastify reply.
 * @returns The reply after sending the pending list.
 */
function sendPending(_req: FastifyRequest, reply: FastifyReply): FastifyReply {
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
  const body = req.body as { code?: unknown } | null;
  const code = parseOtpCode(body?.code);
  if (code === '') {
    return reply.code(400).send({ error: 'Invalid OTP code' });
  }
  const { id: requestId } = req.params as { id: string };
  const store = new OtpRequestStore();
  const wasAccepted = store.submit(requestId, code);
  return wasAccepted
    ? reply.send({ ok: true })
    : reply.code(404).send({ error: 'No pending OTP request for this id' });
}

/**
 * Sends the current OTP delivery channel.
 * @param _req - Fastify request (unused).
 * @param reply - Fastify reply.
 * @returns The reply after sending the settings.
 */
function sendSettings(_req: FastifyRequest, reply: FastifyReply): FastifyReply {
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
 * Registers the OTP request + settings routes. The submit route carries a
 * per-route rate limit so a compromised session cannot brute-force codes and so
 * the control is visible to static analysis.
 * @param app - Fastify instance.
 * @returns Confirmation that the OTP routes are registered.
 */
export default function registerOtpRoutes(app: FastifyInstance): { registered: true } {
  const submitLimit = { config: { rateLimit: { max: OTP_SUBMIT_MAX, timeWindow: RATE_WINDOW } } };
  app.get('/api/otp/pending', sendPending);
  app.post('/api/otp/:id', submitLimit, submitCode);
  app.get('/api/otp/settings', sendSettings);
  app.put('/api/otp/settings', saveSettings);
  return { registered: true };
}
