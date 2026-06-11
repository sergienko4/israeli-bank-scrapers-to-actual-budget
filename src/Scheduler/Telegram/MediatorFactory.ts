/**
 * Factory for the ImportMediator wiring used by the Telegram path.
 *
 * Isolated from HandlerFactory so the ImportMediator service dependency
 * plus the scheduler-side wiring (spawnImport + getConfiguredBankNames)
 * stays out of HandlerFactory's import surface. Keeps the receipt-vs-bank
 * seam clean: HandlerFactory composes them; this module owns mediator
 * construction.
 */

import { ImportMediator } from '../../Services/ImportMediator.js';
import type TelegramNotifier from '../../Services/Notifications/TelegramNotifier.js';
import type { Procedure } from '../../Types/Index.js';
import { spawnImport } from '../ImportProcessRunner.js';
import { getConfiguredBankNames } from './ConfigHelpers.js';

/**
 * Creates an ImportMediator wired to spawnImport and the current config.
 *
 * @param notifierResult - Procedure with TelegramNotifier, or failure for none.
 * @returns A configured ImportMediator instance.
 */
export default function createMediator(
  notifierResult: Procedure<TelegramNotifier>
): ImportMediator {
  const notifier = notifierResult.success ? notifierResult.data : void 0;
  return new ImportMediator({
    spawnImport,
    getBankNames: getConfiguredBankNames,
    notifier: notifier ?? null,
  });
}
