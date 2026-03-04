/**
 * ConfigValidator — offline + online config health checks
 * Returns ValidationResult[] instead of throwing, so all issues surface at once.
 */

import type { ImporterConfig, NotificationConfig, BankConfig, BankTarget } from '../Types/Index.js';
import { ConfigLoader } from './ConfigLoader.js';
import { errorMessage } from '../Utils/Index.js';
import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

/** A single check result from config validation. */
export interface ValidationResult {
  /** Whether the check passed, failed, or produced a warning. */
  status: 'pass' | 'fail' | 'warn';
  /** Dotted path identifying the config field checked (e.g. `bank.discount.target[0]`). */
  check: string;
  /** Human-readable description of the result. */
  message: string;
}

// Derived from the scraper's CompanyTypes — stays in sync when banks are added
const KNOWN_BANKS = new Set(Object.keys(CompanyTypes).map(k => k.toLowerCase()));

/**
 * Validates importer configuration without throwing — collects all issues at once.
 *
 * Offline checks: bank names (with typo suggestions), UUIDs, date config, enum values.
 * Online checks: Actual server reachability, Telegram token, webhook URL.
 */
export class ConfigValidator {

  // ─── Public API ───

  validateOffline(config: ImporterConfig): ValidationResult[] {
    return [
      ...this.checkActualOffline(config),
      ...this.checkBanksOffline(config.banks),
      ...this.checkNotificationsOffline(config.notifications),
    ];
  }

  async validateOnline(config: ImporterConfig): Promise<ValidationResult[]> {
    const results = [await this.checkActualServer(config)];
    const tg = config.notifications?.enabled ? config.notifications.telegram : undefined;
    if (tg) results.push(await this.checkTelegramToken(tg));
    const wh = config.notifications?.enabled ? config.notifications.webhook : undefined;
    if (wh) results.push(await this.checkWebhookUrl(wh.url));
    return results;
  }

  async validateAll(config: ImporterConfig): Promise<ValidationResult[]> {
    const offline = this.validateOffline(config);
    const hasFailures = offline.some(r => r.status === 'fail');
    const online = hasFailures ? [] : await this.validateOnline(config);
    return [...offline, ...online];
  }

  formatReport(results: ValidationResult[]): string {
    const sep = '='.repeat(40);
    const lines = ['Config Validation Report', sep];
    for (const r of results) {
      const label = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'WARN';
      lines.push(`[${label}] ${r.message}`);
    }
    lines.push(sep, this.summarizeCounts(results));
    return lines.join('\n');
  }

  // ─── Result builders ───

  private pass(check: string, message: string): ValidationResult {
    return { status: 'pass', check, message };
  }

  private fail(check: string, message: string): ValidationResult {
    return { status: 'fail', check, message };
  }

  private warn(check: string, message: string): ValidationResult {
    return { status: 'warn', check, message };
  }

  // ─── Offline — actual ───

  private checkActualOffline(config: ImporterConfig): ValidationResult[] {
    return [
      this.checkActualPassword(config),
      this.checkActualSyncId(config),
      this.checkActualServerUrl(config),
    ];
  }

  private checkActualPassword(config: ImporterConfig): ValidationResult {
    return config.actual.init.password
      ? this.pass('actual.password', 'Actual password is set')
      : this.fail('actual.password', 'ACTUAL_PASSWORD is missing');
  }

  private checkActualSyncId(config: ImporterConfig): ValidationResult {
    const { syncId } = config.actual.budget;
    return this.isValidUUID(syncId)
      ? this.pass('actual.syncId', 'syncId UUID format valid')
      : this.fail('actual.syncId', `Invalid syncId: "${syncId}" — expected UUID format`);
  }

  private checkActualServerUrl(config: ImporterConfig): ValidationResult {
    const { serverURL } = config.actual.init;
    if (!serverURL) return this.fail("actual.serverURL", "serverURL is missing");
    return serverURL.startsWith('http')
      ? this.pass('actual.serverURL', `Server URL format valid: ${serverURL}`)
      : this.fail('actual.serverURL',
        `Invalid serverURL "${serverURL}" — must start with http://`);
  }

  // ─── Offline — banks ───

  private checkBanksOffline(banks: Record<string, BankConfig>): ValidationResult[] {
    if (Object.keys(banks).length === 0) {
      return [this.fail('banks', 'No banks configured')];
    }
    return Object.entries(banks).flatMap(([name, cfg]) => this.checkBankOffline(name, cfg));
  }

  private checkBankOffline(name: string, cfg: BankConfig): ValidationResult[] {
    return [
      this.checkBankName(name),
      ...this.checkBankDates(name, cfg),
      ...this.checkBankTargets(name, cfg),
    ];
  }

  private checkBankName(name: string): ValidationResult {
    if (KNOWN_BANKS.has(name.toLowerCase())) {
      return this.pass(`bank.${name}`, `Bank "${name}" — known institution`);
    }
    const suggestion = this.suggest(name.toLowerCase());
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    return this.fail(`bank.${name}`, `Bank "${name}" — unknown institution.${hint}`);
  }

  private checkBankDates(name: string, cfg: BankConfig): ValidationResult[] {
    if (cfg.startDate && cfg.daysBack) {
      return [this.fail(`bank.${name}.dates`,
        `${name}: cannot use both "startDate" and "daysBack" — choose one`)];
    }
    if (!cfg.startDate && !cfg.daysBack) {
      return [this.warn(`bank.${name}.dates`,
        `${name}: no daysBack/startDate set — will fetch ~1 year of history`)];
    }
    return [this.pass(`bank.${name}.dates`, `${name}: date config valid`)];
  }

  private checkBankTargets(name: string, cfg: BankConfig): ValidationResult[] {
    if (!cfg.targets || cfg.targets.length === 0) {
      return [this.fail(`bank.${name}.targets`, `${name}: no targets configured`)];
    }
    return cfg.targets.map((t, i) => this.checkBankTarget(name, t, i));
  }

  private checkBankTarget(name: string, target: BankTarget, idx: number): ValidationResult {
    const id = target.actualAccountId;
    if (!id || !this.isValidUUID(id)) {
      return this.fail(`bank.${name}.target[${idx}]`,
        `${name} target[${idx}]: invalid actualAccountId "${id || '(empty)'}" — expected UUID`);
    }
    const label = target.accountName ?? `...${id.split('-').at(-1)}`;
    const formatted = this.formatAccounts(target.accounts);
    return this.pass(`bank.${name}.target[${idx}]`,
      `${name} target[${idx}] "${label}": accounts=${formatted}, reconcile=${target.reconcile}`);
  }

  private formatAccounts(accounts: BankTarget['accounts']): string {
    return Array.isArray(accounts) ? `[${accounts.join(', ')}]` : accounts;
  }

  // ─── Offline — notifications ───

  private checkNotificationsOffline(
    notifications?: ImporterConfig['notifications']
  ): ValidationResult[] {
    if (!notifications?.enabled) return [];
    const results: ValidationResult[] = [];
    if (notifications.telegram) results.push(...this.checkTelegramOffline(notifications.telegram));
    if (notifications.webhook) results.push(this.checkWebhookOffline(notifications.webhook));
    return results;
  }

  private checkTelegramOffline(
    tg: NonNullable<NotificationConfig['telegram']>
  ): ValidationResult[] {
    const isTokenValid = /^\d+:.+$/.test(tg.botToken ?? '');
    return [
      isTokenValid
        ? this.pass('telegram.botToken', 'Telegram botToken format valid')
        : this.fail('telegram.botToken',
          'Invalid botToken format — expected "123456:ABCdef..."'),
      tg.chatId
        ? this.pass('telegram.chatId', 'Telegram chatId is set')
        : this.fail('telegram.chatId', 'Telegram chatId is missing'),
    ];
  }

  private checkWebhookOffline(
    wh: NonNullable<NotificationConfig['webhook']>
  ): ValidationResult {
    if (!wh.url) return this.fail("webhook.url", "Webhook URL is missing");
    return wh.url.startsWith('http')
      ? this.pass('webhook.url', `Webhook URL format valid: ${wh.url}`)
      : this.fail('webhook.url',
        `Invalid webhook URL "${wh.url}" — must start with http://`);
  }

  // ─── Online ───

  private async checkActualServer(config: ImporterConfig): Promise<ValidationResult> {
    const { serverURL } = config.actual.init;
    try {
      const resp = await fetch(serverURL, { signal: AbortSignal.timeout(5000) });
      return resp.status < 500
        ? this.pass('actual.server', `Actual server reachable: ${serverURL} (${resp.status})`)
        : this.fail('actual.server', `Actual server error ${resp.status}: ${serverURL}`);
    } catch (e) {
      return this.fail('actual.server', `Cannot reach Actual server: ${errorMessage(e)}`);
    }
  }

  private async checkTelegramToken(
    tg: NonNullable<NotificationConfig['telegram']>
  ): Promise<ValidationResult> {
    try {
      const url = `https://api.telegram.org/bot${tg.botToken}/getMe`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const json: unknown = await resp.json();
      const data = json as { ok: boolean; result?: { username?: string } };
      return data.ok
        ? this.pass('telegram.token', `Telegram bot valid (@${data.result?.username ?? '?'})`)
        : this.fail('telegram.token', 'Invalid Telegram bot token');
    } catch (e) {
      return this.fail('telegram.token', `Telegram check failed: ${errorMessage(e)}`);
    }
  }

  private async checkWebhookUrl(url: string): Promise<ValidationResult> {
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return resp.ok
        ? this.pass('webhook.url', `Webhook reachable (${resp.status})`)
        : this.warn('webhook.url', `Webhook returned ${resp.status} — may not accept HEAD`);
    } catch (e) {
      return this.fail('webhook.url', `Cannot reach webhook: ${errorMessage(e)}`);
    }
  }

  // ─── Utilities ───

  private summarizeCounts(results: ValidationResult[]): string {
    const fails = results.filter(r => r.status === 'fail').length;
    const warns = results.filter(r => r.status === 'warn').length;
    if (fails === 0 && warns === 0) return 'All checks passed ✓';
    const parts: string[] = [];
    if (fails > 0) parts.push(`${fails} error${fails > 1 ? 's' : ''}`);
    if (warns > 0) parts.push(`${warns} warning${warns > 1 ? 's' : ''}`);
    return `Result: ${parts.join(', ')}`;
  }

  private isValidUUID(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }

  private levenshtein(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next: number[] = Array.from({ length: b.length + 1 }, () => 0);
      next[0] = i;
      for (let j = 1; j <= b.length; j++)
        next[j] = a[i - 1] === b[j - 1] ? row[j - 1]
          : 1 + Math.min(row[j], next[j - 1], row[j - 1]);
      row = next;
    }
    return row[b.length];
  }

  private suggest(name: string): string | null {
    let best: string | null = null;
    let bestDist = 4; // only suggest if edit distance < 4
    for (const bank of KNOWN_BANKS) {
      const d = this.levenshtein(name, bank);
      if (d < bestDist) { bestDist = d; best = bank; }
    }
    return best;
  }
}

export async function runValidateMode(): Promise<number> {
  const loader = new ConfigLoader();
  let config: ImporterConfig;
  try {
    config = loader.loadRaw();
  } catch (e) {
    // eslint-disable-next-line no-console -- validation CLI reports to stdout, not logger
    console.log(`[FAIL] Cannot load config: ${errorMessage(e)}`);
    return 1;
  }
  const validator = new ConfigValidator();
  const results = await validator.validateAll(config);
  // eslint-disable-next-line no-console -- validation CLI reports to stdout, not logger
  console.log(validator.formatReport(results));
  return results.some(r => r.status === 'fail') ? 1 : 0;
}
