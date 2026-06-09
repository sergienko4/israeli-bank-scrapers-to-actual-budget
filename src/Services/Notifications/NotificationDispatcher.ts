/**
 * NotificationDispatcher - Pure dispatch over a list of INotifier instances.
 *
 * Owns the "send to all in parallel + count successes + log failures" policy.
 * Extracted from NotificationService.ts (PR 4) so the orchestrator stays a
 * thin shell that wires {@link buildEnabledNotifiers} (gate) and
 * {@link dispatchToAll} (dispatcher) together.
 *
 * Pure module — no state, no class. The notifier list is owned by the caller.
 */

import { getLogger } from '../../Logger/Index.js';
import type { Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import type { INotifier } from './INotifier.js';

/**
 * Action that calls a notifier and returns a status Procedure.
 *
 * Note: the inner `{ sent: boolean }` value is currently unused by
 * {@link dispatchToAll} (which only inspects fulfilled/rejected), but the
 * `Procedure<T>` wrapper is REQUIRED by the project's `no-restricted-syntax`
 * rule that forbids `Promise<void>` returns (Procedure pattern P1).
 */
export type NotifyAction = (n: INotifier) => Promise<Procedure<{ sent: boolean }>>;

/**
 * Runs the given action on all notifiers in parallel via `Promise.allSettled`.
 *
 * @param notifiers - The notifiers to dispatch to (may be empty).
 * @param action - Async function invoked once per notifier.
 * @returns Procedure with the count of fulfilled notifier calls, or
 *   `fail('all notifiers failed')` when every call rejected, or
 *   `succeed({ sent: 0 })` when the notifier list is empty.
 */
export async function dispatchToAll(
  notifiers: readonly INotifier[],
  action: NotifyAction
): Promise<Procedure<{ sent: number }>> {
  if (notifiers.length === 0) return succeed({ sent: 0 });
  const promises = notifiers.map(action);
  const results = await Promise.allSettled(promises);
  const count = countAndLogFailures(results);
  if (count === 0) return fail('all notifiers failed');
  return succeed({ sent: count });
}

/**
 * Counts fulfilled results and logs each rejected result via the active logger.
 *
 * @param results - Settled promise results from notifier calls.
 * @returns Number of fulfilled (successful) notifier calls.
 */
function countAndLogFailures(
  results: PromiseSettledResult<Procedure<{ sent: boolean }>>[]
): number {
  let fulfilled = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      fulfilled++;
    } else {
      const msg = result.reason instanceof Error
        ? result.reason.message : String(result.reason);
      getLogger().error(`⚠️  Notification failed: ${msg}`);
    }
  }
  return fulfilled;
}
