/**
 * Pure formatting functions for Telegram import summary messages.
 * Extracted from TelegramNotifier to keep it within the 300-line limit.
 */
import type { MessageFormat, ShowTransactions } from '../../Types/Index.js';
import type {
IAccountMetrics, IBankMetrics,   IImportSummary, ITransactionRecord
} from '../MetricsService.js';

/** Options controlling which transactions appear in the formatted message. */
export interface IFormatOpts {
  /** Maximum transactions to display per account. */
  showTransactions: ShowTransactions;
  /** Cap on the number of transactions shown. */
  maxTransactions: number;
}

/** Combined context for rendering a single account's lines. */
interface IAccountCtx { bank: IBankMetrics; account: IAccountMetrics; opts: IFormatOpts }

/**
 * Formats an import summary into an HTML Telegram message using the configured format.
 * @param summary - The ImportSummary to format.
 * @param format - The MessageFormat key (summary/compact/ledger/emoji).
 * @param opts - Transaction display options.
 * @returns HTML-formatted string ready to send to Telegram.
 */
export function formatSummaryMessage(
  summary: IImportSummary, format: MessageFormat, opts: IFormatOpts
): string {
  const dispatch: Record<string, () => string> = {
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
  const formatter = dispatch[format] ?? dispatch.summary;
  return formatter();
}

/**
 * Escapes HTML special characters to prevent Telegram parse errors.
 * @param text - Raw text that may contain &, <, or > characters.
 * @returns HTML-safe string.
 */
export function escapeHtml(text: string): string {
  // Safe: Telegram HTML mode supports only <b>,<i>,<a>,<code> — no JS execution.
  // This escapes &, <, > to prevent markup injection in bot messages, not web XSS.
  return text // nosemgrep
    .replaceAll('&', '&amp;') // nosemgrep
    .replaceAll('<', '&lt;') // nosemgrep
    .replaceAll('>', '&gt;'); // nosemgrep
}

/**
 * Builds the bold header line with a success/warning icon.
 * @param summary - The ImportSummary used to choose the icon.
 * @returns HTML header string.
 */
function buildHeader(summary: IImportSummary): string {
  return `${summary.failedBanks === 0 ? '✅' : '⚠️'} <b>Import Summary</b>`;
}

/**
 * Returns a status icon string for a bank based on its import result.
 * @param bank - The BankMetrics to check.
 * @returns '✅' for success or '❌' for failure.
 */
function bankIcon(bank: IBankMetrics): string {
  return bank.status === 'success' ? '✅' : '❌';
}

/**
 * Builds bank-level footer lines including error when no accounts are reported.
 * @param bank - The BankMetrics whose footer to build.
 * @returns Array of footer lines to append.
 */
function buildBankFooter(bank: IBankMetrics): string[] {
  const lines: string[] = [];
  if (bank.accounts.length === 0) {
    lines.push('', `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>`);
  }
  if (bank.error) lines.push(`❌ ${escapeHtml(bank.error)}`);
  return lines;
}

/**
 * Formats the summary in default "D" style (banks overview, no transaction details).
 * @param summary - The ImportSummary to format.
 * @returns HTML summary string.
 */
function formatDefault(summary: IImportSummary): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary), '',
    `🏦 Banks: ${String(summary.successfulBanks)}/${String(summary.totalBanks)} ` +
      `(${summary.successRate.toFixed(0)}%)`,
    `📥 Transactions: ${String(summary.totalTransactions)} imported`,
    `🔄 Duplicates: ${String(summary.totalDuplicates)} skipped`,
    `⏱ Duration: ${dur}s`,
  ];
  if (summary.banks.length > 0) {
    lines.push('');
    for (const bank of summary.banks) lines.push(...buildDefaultBankLines(bank));
  }
  return lines.join('\n');
}

/**
 * Builds lines for a single bank in default format.
 * @param bank - The BankMetrics to format.
 * @returns Array of formatted bank lines.
 */
function buildDefaultBankLines(bank: IBankMetrics): string[] {
  const dur = bank.duration ? `${(bank.duration / 1000).toFixed(1)}s` : '';
  const txnCount = String(bank.transactionsImported);
  const name = escapeHtml(bank.bankName);
  const lines: string[] = [
    `${bankIcon(bank)} ${name}: ${txnCount} txns ${dur}`,
  ];
  lines.push(...buildReconciliationLines(bank));
  if (bank.error) lines.push(`   ❌ ${escapeHtml(bank.error)}`);
  return lines;
}

/**
 * Formats the summary in compact "A" style (per-transaction lines).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML compact string.
 */
function formatCompact(summary: IImportSummary, opts: IFormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary),
    `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks | ` +
      `${String(summary.totalTransactions)} txns | ${dur}s`,
  ];
  for (const bank of summary.banks) {
    for (const account of bank.accounts) {
      lines.push(...buildCompactLines({ bank, account, opts }));
    }
    lines.push(...buildBankFooter(bank));
  }
  return lines.join('\n');
}

/**
 * Builds compact-format lines for one account.
 * @param ctx - Combined bank, account, and format options context.
 * @param ctx.bank - The bank this account belongs to.
 * @param ctx.account - The account whose transactions to format.
 * @param ctx.opts - Transaction display options.
 * @returns Array of compact-format lines.
 */
function buildCompactLines(ctx: IAccountCtx): string[] {
  const { bank, account, opts } = ctx;
  const lines: string[] = ['',
    `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`,
  ];
  for (const txn of getTransactions(account, opts)) {
    lines.push(`${fmtDate(txn.date)}  ${escapeHtml(txn.description)}`,
      `       <b>${fmtAmount(txn.amount)}</b>`);
  }
  lines.push(...buildBalanceLines(account, bank));
  return lines;
}

/**
 * Formats the summary in ledger "B" style (monospace table).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML ledger string.
 */
function formatLedger(summary: IImportSummary, opts: IFormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const lines: string[] = [
    buildHeader(summary), `${String(summary.totalTransactions)} transactions · ${dur}s`,
  ];
  for (const bank of summary.banks) {
    for (const account of bank.accounts) {
      lines.push(...buildLedgerLines({ bank, account, opts }));
    }
    lines.push(...buildBankFooter(bank));
  }
  return lines.join('\n');
}

/**
 * Builds ledger-format lines for one account.
 * @param ctx - Combined bank, account, and format options context.
 * @param ctx.bank - The bank this account belongs to.
 * @param ctx.account - The account whose transactions to format.
 * @param ctx.opts - Transaction display options.
 * @returns Array of ledger-format lines.
 */
function buildLedgerLines(ctx: IAccountCtx): string[] {
  const { bank, account, opts } = ctx;
  const lines: string[] = ['',
    `${bankIcon(bank)} <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`,
  ];
  const txns = getTransactions(account, opts);
  if (txns.length > 0) lines.push(...buildLedgerTransactionLines(txns));
  lines.push(...buildBalanceLines(account, bank));
  return lines;
}

/**
 * Builds monospace transaction rows inside a code block.
 * @param txns - Transactions to render in table format.
 * @returns Array of ledger transaction lines including code tags.
 */
function buildLedgerTransactionLines(txns: ITransactionRecord[]): string[] {
  const lines: string[] = ['<code>'];
  for (const txn of txns) {
    const raw = txn.description.length > 18 ? `${txn.description.slice(0, 18)}..` : txn.description;
    lines.push(`${fmtDate(txn.date)} ${escapeHtml(raw)}`,
      `${''.padStart(6)}${fmtAmount(txn.amount).padStart(9)}`);
  }
  lines.push('</code>');
  return lines;
}

/**
 * Formats the summary in emoji "C" style (directional icons per transaction).
 * @param summary - The ImportSummary to format.
 * @param opts - Transaction display options.
 * @returns HTML emoji string.
 */
function formatEmoji(summary: IImportSummary, opts: IFormatOpts): string {
  const dur = (summary.totalDuration / 1000).toFixed(1);
  const dup = summary.totalDuplicates > 0 ? ` · ${String(summary.totalDuplicates)} dup` : '';
  const lines: string[] = [
    buildHeader(summary), '',
    `📊 ${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks · ` +
      `${String(summary.totalTransactions)} txns${dup} · ${dur}s`,
  ];
  for (const bank of summary.banks) {
    for (const account of bank.accounts) {
      lines.push(...buildEmojiLines({ bank, account, opts }));
    }
    lines.push(...buildBankFooter(bank));
  }
  return lines.join('\n');
}

/**
 * Builds emoji-format lines for one account.
 * @param ctx - Combined bank, account, and format options context.
 * @param ctx.bank - The bank this account belongs to.
 * @param ctx.account - The account whose transactions to format.
 * @param ctx.opts - Transaction display options.
 * @returns Array of emoji-format lines.
 */
function buildEmojiLines(ctx: IAccountCtx): string[] {
  const { bank, account, opts } = ctx;
  const lines: string[] = ['',
    `💳 <b>${escapeHtml(bank.bankName)}</b>` +
    ` · ${escapeHtml(account.accountName ?? account.accountNumber)}`,
  ];
  for (const txn of getTransactions(account, opts)) {
    const dir = txn.amount >= 0 ? '📥' : '📤';
    lines.push(`${dir} <b>${fmtAmount(txn.amount)}</b>  ${escapeHtml(txn.description)}`);
  }
  if (account.balance !== undefined) {
    lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
  }
  lines.push(...buildReconciliationLines(bank));
  return lines;
}

/**
 * Builds balance and reconciliation lines for an account.
 * @param account - The account whose balance to display.
 * @param bank - The bank whose reconciliation status to display.
 * @returns Array of balance and reconciliation lines.
 */
function buildBalanceLines(account: IAccountMetrics, bank: IBankMetrics): string[] {
  const lines: string[] = [];
  if (account.balance !== undefined) {
    lines.push(`💰 ${account.balance.toLocaleString()} ${account.currency || 'ILS'}`);
  }
  lines.push(...buildReconciliationLines(bank));
  return lines;
}

/**
 * Builds a reconciliation status line when one exists.
 * @param bank - The bank whose reconciliation status to check.
 * @returns Array of reconciliation lines (empty if no reconciliation info).
 */
function buildReconciliationLines(bank: IBankMetrics): string[] {
  if (bank.reconciliationStatus === 'created' && bank.reconciliationAmount !== undefined) {
    const sign = bank.reconciliationAmount > 0 ? '+' : '';
    return [`🔄 Reconciled: ${sign}${(bank.reconciliationAmount / 100).toFixed(2)} ILS`];
  }
  if (bank.reconciliationStatus === 'skipped') return ['✅ Balance matched'];
  if (bank.reconciliationStatus === 'already-reconciled') return ['✅ Already reconciled'];
  return [];
}

/**
 * Returns the transactions to display for an account based on display options.
 * @param account - The account whose transactions to retrieve.
 * @param opts - Transaction display options (showTransactions, maxTransactions).
 * @returns Sliced array of ITransactionRecord objects.
 */
function getTransactions(account: IAccountMetrics, opts: IFormatOpts): ITransactionRecord[] {
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
