/**
 * CommandRouter — dispatches parsed commands against a declarative route table.
 * Exact matches win over prefix matches; first-match wins within each kind.
 */

import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import { parseCommand } from './CommandCallbackParser.js';
import type { ICommandRoute } from './ICommandRoute.js';

/** Reply when no route matches the incoming command. */
const NO_ROUTE_STATUS = 'no-route';

/** Single-class wrapper over a frozen route table. */
export default class CommandRouter {
  /**
   * Creates a router for the supplied route table.
   * Route order matters within match kind (first match wins).
   * @param routes - Immutable list of routes to dispatch against.
   */
  constructor(private readonly routes: readonly ICommandRoute[]) {}

  /**
   * Dispatches a raw command string to the first matching route.
   * @param raw - Raw command/callback string (will be trimmed and parsed).
   * @returns Procedure carrying the handler's status, or `no-route` when unmatched.
   */
  public async dispatch(raw: string): Promise<Procedure<{ status: string }>> {
    const parsed = parseCommand(raw);
    const route = this.findRoute(parsed.command);
    if (!route) return succeed({ status: NO_ROUTE_STATUS });
    const arg = route.parse ? route.parse(parsed.raw) : parsed.arg;
    return await route.handle(arg);
  }

  /**
   * Finds the first matching route. Exact matches are tried before prefix
   * matches so that e.g. `receipt_confirm` (exact) is not shadowed by a
   * `receipt_` prefix route registered earlier.
   * @param command - Parsed command token.
   * @returns Matching route or undefined.
   */
  private findRoute(
    command: string,
  ): ICommandRoute | undefined {
    const exact = this.routes.find(
      r => r.match === 'exact' && r.pattern === command,
    );
    if (exact) return exact;
    return this.routes.find(
      r => r.match === 'prefix' && command.startsWith(r.pattern),
    );
  }
}
