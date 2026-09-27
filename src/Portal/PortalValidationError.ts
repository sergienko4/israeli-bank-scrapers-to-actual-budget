/**
 * Keeps schema validation invisible to clients.
 *
 * Fastify answers a failed request-schema check with its own body —
 * `{ statusCode, code, error, message }` — where `error` holds "Bad Request".
 * Both clients read `error` as the sentence to show a user, so adopting schema
 * validation without this handler would silently replace every specific
 * rejection ("Invalid OTP code") with the useless word "Bad Request".
 *
 * Each route declares its own wording through `config.invalidMessage`, so the
 * message stays next to the rule that produces it. Any other client error
 * (4xx) is handed straight back to Fastify's default handling.
 *
 * A server error, one with a 5xx status or none at all, answers one generic
 * body. Its message can hold a file path or an errno, which help an attacker
 * map the host and help no user, so the detail goes to the log instead.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { getLogger } from '../Logger/Index.js';
import { errorMessage } from '../Utils/Index.js';

/** Wording used when a route declares none of its own. */
export const INVALID_REQUEST = 'Invalid request';

/** The one body every server error answers with. */
export const INTERNAL_ERROR = 'Internal server error';

/** Lowest and highest status of a client error. */
const CLIENT_ERROR_MIN = 400;
const CLIENT_ERROR_MAX = 499;

/**
 * Reads the wording a route declared for its validation failures.
 * @param req - The request whose route config is being read.
 * @returns The route's message, or the generic fallback.
 */
function messageFor(req: FastifyRequest): string {
  return req.routeOptions.config.invalidMessage ?? INVALID_REQUEST;
}

/**
 * Whether an error is the client's fault, by the status it carries.
 * @param error - The error Fastify caught.
 * @returns True for a 4xx status.
 */
function isClientError(error: FastifyError): boolean {
  const status = error.statusCode;
  return status !== undefined && status >= CLIENT_ERROR_MIN && status <= CLIENT_ERROR_MAX;
}

/**
 * Logs a server error with the route it happened on, then answers the generic body.
 * @param error - The error Fastify caught.
 * @param req - The request being answered.
 * @param reply - The reply to send on.
 * @returns The reply, already sent.
 */
function answerServerError(
  error: FastifyError, req: FastifyRequest, reply: FastifyReply,
): FastifyReply {
  const route = req.routeOptions.url ?? 'an unknown route';
  const detail = errorMessage(error);
  getLogger().error(`Portal ${req.method} ${route} failed: ${detail}`);
  return reply.code(500).send({ error: INTERNAL_ERROR });
}

/**
 * Maps validation failures onto the portal's `{ error }` body, answers every
 * server error with the generic body, and leaves other client errors to Fastify.
 * @param error - The error Fastify caught.
 * @param req - The request being answered.
 * @param reply - The reply to send on.
 * @returns The reply, already sent.
 */
export function handlePortalError(
  error: FastifyError, req: FastifyRequest, reply: FastifyReply,
): FastifyReply {
  if (error.validation !== undefined) return reply.code(400).send({ error: messageFor(req) });
  if (isClientError(error)) return reply.send(error);
  return answerServerError(error, req, reply);
}
