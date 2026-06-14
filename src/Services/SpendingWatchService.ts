import type api from '@actual-app/api';

import { getLogger } from '../Logger/Index.js';
import type { ISpendingWatchRule, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { evaluateRule, formatMessage, queryTransactions } from './SpendingWatch/Index.js';

/** Evaluates configured spending-watch rules against Actual transactions. */
export default class SpendingWatchService {
  /** Creates a spending-watch evaluator.
   * @param rules configured spending-watch rules.
   * @param actualApi Actual Budget API module. */
  constructor(
    private readonly rules: ISpendingWatchRule[], private readonly actualApi: typeof api
  ) {}

  /** Evaluates every rule and returns either one alert message or no-alerts.
   * @returns spending-watch evaluation result. */
  public async evaluate(): Promise<Procedure<{ message: string } | { noAlerts: true }>> {
    if (this.rules.length === 0) return succeed({ noAlerts: true as const }, 'no-alerts');
    try {
      const maxDays = Math.max(...this.rules.map(rule => rule.numOfDayToCount));
      const allTransactions = await queryTransactions(this.actualApi, maxDays);
      const results = this.rules.map(rule => evaluateRule(rule, allTransactions));
      const alertMessage = formatMessage(results);
      if (!alertMessage) return succeed({ noAlerts: true as const }, 'no-alerts');
      return succeed({ message: alertMessage }, 'alert-triggered');
    } catch (error: unknown) {
      getLogger().error(`Spending watch error: ${errorMessage(error)}`);
      const err = error instanceof Error ? error : new Error(String(error));
      const message = errorMessage(error);
      return fail(message, { error: err, status: 'evaluation-error' });
    }
  }
}
