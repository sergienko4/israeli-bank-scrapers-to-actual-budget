/**
 * Shared helpers for the webhook formatter cluster.
 * The Slack and Discord summary formatters render bank lines identically,
 * so the bank-line helper lives here to avoid duplication.
 */
import type { IBankMetrics } from '../../MetricsService.js';

/**
 * Formats a single bank result as a Slack/Discord-style text line.
 * @param b - The IBankMetrics to format.
 * @returns Text line with status icon, name, transaction count, and optional error.
 */
export default function bankLine(b: IBankMetrics): string {
  const icon = b.status === 'success' ? '✅' : '❌';
  const dur = b.duration === undefined ? '' : `${(b.duration / 1000).toFixed(1)}s`;
  const errSuffix = b.error ? ` — ${b.error}` : '';
  return `${icon} ${b.bankName}: ${String(b.transactionsImported)} txns ${dur}${errSuffix}`;
}
