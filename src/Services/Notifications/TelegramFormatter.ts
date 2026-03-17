/**
 * Pure formatting functions for Telegram import summary messages.
 * Extracted from TelegramNotifier to keep it within the 300-line limit.
 */
import type { MessageFormat, ShowTransactions } from '../../Types/Index.js';
import type {
  ImportSummary, BankMetrics, AccountMetrics, TransactionRecord
} from '../MetricsService.js';

/** Options controlling which transactions appear in the formatted message. */
export interface FormatOpts {
  /** Maximum transactions to display per account. */
  showTransactions: ShowTransactions;
  /** Cap on the number of transactions shown. */
  maxTransactions: number;
}

/** Combined context for rendering a single account's lines. */
type AccountCtx = { bank: BankMetrics; account: AccountMetrics; opts: FormatOpts };

/**
 * Formats an import summary into an HTML Telegram message using the configured format.
 * @param summary - The ImportSummary to format.
 * @param format - The MessageFormat key (summary/compact/ledger/emoji).
 * @param opts - Transaction display options.
 * @returns HTML-formatted string ready to send to Telegram.
 */
export function formatSummaryMessage(
  summary: ImportSummary, format: MessageFormat, opts: FormatOpts
): string {
  const dispatch: Record<MessageFormat, () => string> = {
    /**
     * Formats as compact style (A).
     * @returns HTML compact message.
     */
    compact: () => formatCompact(summary, opts),
    /**
     * Formats as ledger style (B).
     * @returns HTML ledger message.
     */
    ledger: () => formatLedger(summary, opts),
    /**
     * Formats as emoji style (C).
     * @returns HTML emoji message.
     */
    emoji: () => formatEmoji(summary, opts),
    /**
     * Formats as default summary style (D).
     * @returns HTML summary message.
     */
    summary: () => formatDefault(summary),
  };
  return (dispatch[format] ?? dispatch.summary)();
}

/**
 * Escapes HTML special characters to prevent Telegram parse errors.
 * @param text - Raw text that may contain &, <, or > characters.
 * @returns HTML-safe string.
 */
export function escapeHtml(text: string): string {
  // nosemgrep: javascript.audit.detect-replaceall-sanitization.detect-replaceall-sanitization
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Builds the bold header line with a success/warning icon.
 * @param summary - The ImportSummary used to choose the icon.
 * @returns HTML header string.
 */
function buildHeader(summary: ImportSummary): string {
  return `${summary.failedBanks === 0 ? '✅' : '⚠️'} <b>Import Summary</b>`;
}

/**
 * Returns a status icon string for a bank based on its import result.
 * @param bank - The BankMetrics to check.
 * @returns '✅' for success or '❌' for failure.
 */
function bankIcon(bank: BankMetrics): string {
  return bank.status === 'success' ? '✅' : '❌';
}

/**
 * Appends a bank-level footer and error line when no accounts are reported.
 * @param lines - Mutable message lines array to append to.
 * @param bank - The BankMetrics whose footer to build.
 */
function appendBankFooter(lines: string[], bank: BankMetrics): void {
  if (!bank.accounts?.length) {
    lines.push('', `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>`);
  }
  if (bank.error) lines.push(`❌ ${escapeHtml(bank.error)}`);
}

/**
 * Formats the summary in default "D" style (banks overview, no transaction details).
 * @param summary - The ImportSummary to format.
 * @returns HTML summary string.
 */
function formatDefault(summary: ImportSummary): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary), '',
    `🏦 Banks: ${summary.successfulBanks}/${summary.totalBanks} ` +
      `(${summary.successRate.toFixed(0)}%)`,
    `📥 Transactions: ${summary.totalTransactions} imported`,
    `🔄 Duplicates: ${summary.totalDuplicates} skipped`,
    `⏱ Duration: ${dur}s`,
  ];
  if (summary.banks.length > 0) {
    lines.push('');
    summary.banks.forEach(b => { appendDefaultBank(lines, b); });
  }
  return lines.join('\n');
}

/**
 * Appends a single bank line in default format.
 * @param lines - Mutable message lines array to append to.
 * @param bank - The BankMetrics to format.
 */
function appendDefaultBank(lines: string[], bank: BankMetrics): void {
  const d = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : '';
  lines.push(
    `${bankIcon(bank)} ${escapeHtml(bank.bankName)}: ${bank.transactionsImported} txns ${d}`
  );
  appendReconciliation(lines, bank);
  if (bank.error) lines.push(`   ❌ ${escapeHtml(bank.error)}`);
}

/**
 * Formats the summary in compact "A" style (per-transaction lines).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML compact string.
 */
function formatCompact(summary: ImportSummary, opts: FormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary),
    `${summary.successfulBanks}/${summary.totalBanks} banks | ` +
      `${summary.totalTransactions} txns | ${dur}s`,
  ];
  for (const bank of summary.banks) {
    for (const account of bank.accounts || []) appendCompact(lines, { bank, account, opts });
    appendBankFooter(lines, bank);
  }
  return lines.join('\n');
}

/**
 * Appends compact-format lines for one account.
 * @param lines - Mutable message lines array to append to.
 * @param ctx - Combined bank, account, and format options context.
 * @param ctx.bank - The bank this account belongs to.
 * @param ctx.account - The account whose transactions to format.
 * @param ctx.opts - Transaction display options.
 */
function appendCompact(lines: string[], ctx: AccountCtx): void {
  const { bank, account, opts } = ctx;
  lines.push('',
    `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`
  );
  for (const txn of getTransactions(account, opts)) {
    lines.push(`${fmtDate(txn.date)}  ${escapeHtml(txn.description)}`,
      `       <b>${fmtAmount(txn.amount)}</b>`);
  }
  appendBalance(lines, account, bank);
}

/**
 * Formats the summary in ledger "B" style (monospace table).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML ledger string.
 */
function formatLedger(summary: ImportSummary, opts: FormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary), `${summary.totalTransactions} transactions · ${dur}s`,
  ];
  for (const bank of summary.banks) {
    for (const account of bank.accounts || []) appendLedger(lines, { bank, account, opts });
    appendBankFooter(lines, bank);
  }
  return lines.join('\n');
}

/**
 * Appends ledger-format lines for one account.
 * @param lines - Mutable message lines array to append to.
 * @param ctx - Combined bank, account, and format options context.
 * @param ctx.bank - The bank this account belongs to.
 * @param ctx.account - The account whose transactions to format.
 * @param ctx.opts - Transaction display options.
 */
function appendLedger(lines: string[], ctx: AccountCtx): void {
  const { bank, account, opts } = ctx;
  lines.push('',
    `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`
  );
  const txns = getTransactions(account, opts);
  if (txns.length > 0) appendLedgerTransactions(lines, txns);
  appendBalance(lines, account, bank);
}

/**
 * Appends monospace transaction rows inside a code block.
 * @param lines - Mutable message lines array to append to.
 * @param txns - Transactions to render in table format.
 */
function appendLedgerTransactions(lines: string[], txns: TransactionRecord[]): void {
  lines.push('<code>');
  for (const txn of txns) {
    const raw = txn.description.length > 18 ? `${txn.description.slice(0, 18)}..` : txn.description;
    lines.push(`${fmtDate(txn.date)} ${escapeHtml(raw)}`,
      `${''.padStart(6)}${fmtAmount(txn.amount).padStart(9)}`);
  }
  lines.push('</code>');
}

/**
 * Formats the summary in emoji "C" style (directional icons per transaction).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML emoji string.
 */
function formatEmoji(summary: ImportSummary, opts: FormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const dup = summary.totalDuplicates > 0 ? ` · ${summary.totalDuplicates} dup` : '';
  const lines: string[] = [
    buildHeader(summary), '',
    `📊 ${summary.successfulBanks}/${summary.totalBanks} banks · ` +
      `${summary.totalTransactions} txns${dup} · ${dur}s`,
  ];
  for (const bank of summary.banks) {
    for (const account of bank.accounts || []) appendEmoji(lines, { bank, account, opts });
    appendBankFooter(lines, bank);
  }
  return lines.join('\n');
}

/**
 * Appends emoji-format lines for one account.
 * @param lines - Mutable message lines array to append to.
 * @param ctx - Combined bank, account, and format options context.
 * @param ctx.bank - The bank this account belongs to.
 * @param ctx.account - The account whose transactions to format.
 * @param ctx.opts - Transaction display options.
 */
function appendEmoji(lines: string[], ctx: AccountCtx): void {
  const { bank, account, opts } = ctx;
  lines.push('',
    `💳 <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`
  );
  for (const txn of getTransactions(account, opts)) {
    const dir = txn.amount >= 0 ? '📥' : '📤';
    lines.push(`${dir} <b>${fmtAmount(txn.amount)}</b>  ${escapeHtml(txn.description)}`);
  }
  if (account.balance !== undefined) {
    lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
  }
  appendReconciliation(lines, bank);
}

/**
 * Appends balance and reconciliation lines for an account.
 * @param lines - Mutable message lines array to append to.
 * @param account - The account whose balance to display.
 * @param bank - The bank whose reconciliation status to display.
 */
function appendBalance(lines: string[], account: AccountMetrics, bank: BankMetrics): void {
  if (account.balance !== undefined) {
    lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
  }
  appendReconciliation(lines, bank);
}

/**
 * Appends a reconciliation status line when one exists.
 * @param lines - Mutable message lines array to append to.
 * @param bank - The bank whose reconciliation status to check.
 */
function appendReconciliation(lines: string[], bank: BankMetrics): void {
  if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount !== undefined) {
    const sign = bank.reconciliationAmount > 0 ? '+' : '';
    lines.push(`🔄 Reconciled: ${sign}${(bank.reconciliationAmount / 100).toFixed(2)} ILS`);
  } else if (bank.reconciliationStatus === 'skipped') {
    lines.push(`✅ Balance matched`);
  } else if (bank.reconciliationStatus === 'already-reconciled') {
    lines.push(`✅ Already reconciled`);
  }
}

/**
 * Returns the transactions to display for an account based on display options.
 * @param account - The account whose transactions to retrieve.
 * @param opts - Transaction display options (showTransactions, maxTransactions).
 * @returns Sliced array of TransactionRecord objects.
 */
function getTransactions(account: AccountMetrics, opts: FormatOpts): TransactionRecord[] {
  if (opts.showTransactions === 'none') return [];
  const txns = opts.showTransactions === 'all'
    ? [...account.newTransactions, ...account.existingTransactions]
    : account.newTransactions;
  return txns.slice(0, opts.maxTransactions);
}

/**
 * Formats a cent amount as a signed decimal string.
 * @param cents - The amount in cents to format.
 * @returns Signed decimal string with 2 decimal places.
 */
function fmtAmount(cents: number): string {
  return `${cents >= 0 ? '+' : ''}${(cents / 100).toFixed(2)}`;
}

/**
 * Formats a YYYY-MM-DD date string to DD/MM for compact display.
 * @param date - YYYY-MM-DD formatted date string.
 * @returns Two-part date string like "15/03".
 */
function fmtDate(date: string): string {
  const parts = date.split('-');
  return `${parts[2]}/${parts[1]}`;
}
