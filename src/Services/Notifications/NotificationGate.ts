/**
 * NotificationGate - Pure config-driven filter that decides which notifiers
 * to instantiate.
 *
 * Owns the "is notifications enabled? then walk NOTIFIER_REGISTRY and
 * create+describe each applicable factory" policy. Extracted from
 * NotificationService.ts (PR 4) so adding a new notifier (Slack, Discord, …)
 * never edits the orchestrator — it only adds a new registry entry.
 *
 * Pure module — no state, no class. Returns a fresh INotifier[] per call.
 */

import { getLogger } from '../../Logger/Index.js';
import type { INotificationConfig } from '../../Types/Index.js';
import type { INotifier } from './INotifier.js';
import NOTIFIER_REGISTRY from './NotifierRegistry.js';

/**
 * Builds the list of enabled notifiers for the given notification config.
 *
 * Iterates {@link NOTIFIER_REGISTRY} instead of an if-chain so adding a new
 * notifier is a registry-only change. Returns an empty array when notifications
 * are disabled or no factory applies.
 *
 * @param config - Optional notification configuration with channel-specific settings.
 * @returns Array of instantiated notifiers, one per applicable factory.
 */
export default function buildEnabledNotifiers(
  config?: INotificationConfig
): INotifier[] {
  if (!config?.enabled) return [];
  const notifiers: INotifier[] = [];
  for (const factory of NOTIFIER_REGISTRY) {
    if (!factory.applies(config)) continue;
    const notifier = factory.create(config);
    const status = factory.describe(config);
    notifiers.push(notifier);
    getLogger().info(status);
  }
  return notifiers;
}
