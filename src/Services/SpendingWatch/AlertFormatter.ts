import { fromCents } from '../../Utils/Index.js';
import { escapeHtml } from '../Notifications/TelegramFormatter.js';
import type { IRuleResult, ITransactionRow } from './Types.js';
import { MAX_DISPLAYED_TRANSACTIONS } from './Types.js';

/** Formats triggered rules into one Telegram HTML alert.
 * @param results evaluated spending-watch rules.
 * @returns alert message or an empty string when no rule triggered. */
export function formatMessage(results: IRuleResult[]): string {
  const triggered = results.filter(result => result.triggered);
  if (triggered.length === 0) return '';
  const sections = triggered.map(result => formatRule(result));
  return `🔔 <b>Spending Watch</b>\n\n${sections.join('\n\n')}`;
}

/** Formats one triggered spending-watch rule.
 * @param result triggered rule result.
 * @returns rule section with header and transaction details. */
export function formatRule(result: IRuleResult): string {
  const header = buildRuleHeader(result);
  const details = buildTransactionDetails(result.matched);
  return [header, ...details].filter(Boolean).join('\n');
}

/** Builds the header line for a triggered rule.
 * @param result triggered rule result.
 * @returns escaped rule header text. */
export function buildRuleHeader(result: IRuleResult): string {
  const { rule, totalSpent } = result;
  const rawPayeeLabel = rule.watchPayees?.length ? rule.watchPayees.join(', ') : 'All payees';
  const payeeLabel = escapeHtml(rawPayeeLabel);
  const dayLabel = rule.numOfDayToCount === 1 ? '1 day' : `${String(rule.numOfDayToCount)} days`;
  const amount = formatAmount(totalSpent);
  const threshold = rule.alertFromAmount.toLocaleString();
  return `⚠️ ${payeeLabel}: ${amount} in ${dayLabel} (limit: ${threshold})`;
}

/** Formats visible transaction detail lines plus an overflow marker.
 * @param matched transactions matched by one rule.
 * @returns formatted transaction detail lines. */
export function buildTransactionDetails(matched: ITransactionRow[]): string[] {
  const lines = matched.slice(0, MAX_DISPLAYED_TRANSACTIONS).map(transaction => {
    const payee = transaction.imported_payee ? transaction.imported_payee : 'Unknown';
    return `  ${formatAmount(transaction.amount)}  ${escapeHtml(payee)}`;
  });
  const overflowCount = matched.length - MAX_DISPLAYED_TRANSACTIONS;
  if (overflowCount > 0) lines.push(`  ... and ${String(overflowCount)} more`);
  return lines;
}

/** Formats a cent amount as a stable display currency value.
 * @param cents amount in cents.
 * @returns formatted amount with two fraction digits. */
export function formatAmount(cents: number): string {
  const value = fromCents(cents);
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
