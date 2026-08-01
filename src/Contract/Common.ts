/**
 * Shared contract primitives: the error and acknowledgement bodies every
 * portal route returns.
 *
 * Every module under Contract/ depends on nothing but TypeBox, so the whole
 * directory can be copied verbatim into a client and compiled there. Adding an
 * import of server code here breaks that guarantee.
 */

import { type Static, Type } from '@sinclair/typebox';

/** The body returned with every non-2xx status the portal produces. */
export const ERROR_BODY = Type.Object({
  error: Type.String({ description: 'Human-readable reason the request failed.' }),
});

/** The body returned by writes that carry no data of their own. */
export const OK_BODY = Type.Object({
  ok: Type.Literal(true, { description: 'Always true; the write succeeded.' }),
});

/**
 * A rejection, carrying the individual failures behind it when there were
 * several.
 *
 * `errors` is optional because a config write can be refused two ways. The
 * store's own validation reports every failed check; a request that does not
 * match the route schema is refused before the store sees it, and has only the
 * one thing to say. Requiring `errors` makes that second case unserialisable,
 * which turns a plain rejection into a 500.
 */
export const INVALID_CONFIG_BODY = Type.Object({
  error: Type.String({ description: 'Summary of why the config was rejected.' }),
  errors: Type.Optional(Type.Array(Type.String(), {
    description: 'One message per failed check, in the order they were run.',
  })),
});

/** The body returned with every non-2xx status the portal produces. */
export type ErrorBody = Static<typeof ERROR_BODY>;

/** The body returned by writes that carry no data of their own. */
export type OkBody = Static<typeof OK_BODY>;

/** A rejection, with the individual failures behind it when there were several. */
export type InvalidConfigBody = Static<typeof INVALID_CONFIG_BODY>;
