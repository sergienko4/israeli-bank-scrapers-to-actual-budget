/**
 * Types an Actual Budget query for the API's AQL runner.
 *
 * <p>`@actual-app/api` exports `q()` from its own `app/query` declaration and
 * types `aqlQuery` with the structurally identical `Query` class from
 * `@actual-app/core/shared/query`. The declarations are two nominal classes,
 * so the strict class-instance check rejects a factory-built query even
 * though both describe the same runtime object. This module is the one place
 * that re-types the value.
 */

import type api from '@actual-app/api';

/** The query type `aqlQuery` accepts. */
export type ActualQuery = Parameters<typeof api.aqlQuery>[0];

/**
 * Re-types a factory-built Actual query for `aqlQuery`.
 * @param query - Value returned by `q()` or one of its builder methods.
 * @returns The same value, typed as the class `aqlQuery` expects.
 */
export default function asActualQuery(query: unknown): ActualQuery {
  return query as ActualQuery;
}
