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
 * message stays next to the rule that produces it. Anything that is not a
 * validation failure is handed straight back to Fastify's default handling.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/** Wording used when a route declares none of its own. */
export const INVALID_REQUEST = 'Invalid request';

/**
 * Reads the wording a route declared for its validation failures.
 * @param req - The request whose route config is being read.
 * @returns The route's message, or the generic fallback.
 */
function messageFor(req: FastifyRequest): string {
  return req.routeOptions.config.invalidMessage ?? INVALID_REQUEST;
}

/**
 * Maps validation failures onto the portal's `{ error }` body, and leaves every
 * other error to Fastify.
 * @param error - The error Fastify caught.
 * @param req - The request being answered.
 * @param reply - The reply to send on.
 * @returns The reply, already sent.
 */
export function handlePortalError(
  error: FastifyError, req: FastifyRequest, reply: FastifyReply,
): FastifyReply {
  if (error.validation === undefined) return reply.send(error);
  return reply.code(400).send({ error: messageFor(req) });
}
