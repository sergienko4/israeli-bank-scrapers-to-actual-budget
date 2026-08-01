/**
 * Declares the route-level config the portal reads when validation refuses a
 * request.
 *
 * This augments Fastify's own `FastifyContextConfig`, so the interface must
 * carry Fastify's name rather than this project's `I` prefix — which is why the
 * declaration lives in its own file with a scoped lint exemption instead of
 * beside the handler that reads it.
 */

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Sentence sent as `error` when this route rejects a body, param or query. */
    invalidMessage?: string;
  }
}

export {};
