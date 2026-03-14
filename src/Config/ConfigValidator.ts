/**
 * ConfigValidator — offline + online config health checks
 * Returns ValidationResult[] instead of throwing, so all issues surface at once.
 */

import { getLogger } from '../Logger/Index.js';

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

  /**
   * Runs all offline validation checks (no network calls).
   * @param config - The ImporterConfig to validate.
   * @returns Array of ValidationResult objects for each check.
   */
  validateOffline(config: ImporterConfig): ValidationResult[] {
    return [
      ...this.checkActualOffline(config),
      ...this.checkBanksOffline(config.banks),
      ...this.checkNotificationsOffline(config.notifications),
    ];
  }

  /**
   * Runs online checks (server reachability, budget existence, Telegram token, webhook URL).
   * @param config - The ImporterConfig to validate.
   * @returns Array of ValidationResult objects from the online checks.
   */
  async validateOnline(config: ImporterConfig): Promise<ValidationResult[]> {
    const serverResult = await this.checkActualServer(config);
    const results = [serverResult];
    if (serverResult.status === 'pass') results.push(await this.checkActualBudget(config));
    const tg = config.notifications?.enabled ? config.notifications.telegram : undefined;
    if (tg) results.push(await this.checkTelegramToken(tg));
    const wh = config.notifications?.enabled ? config.notifications.webhook : undefined;
    if (wh) results.push(await this.checkWebhookUrl(wh.url));
    return results;
  }

  /**
   * Runs both offline and online validation, skipping online checks if offline fails.
   * @param config - The ImporterConfig to validate.
   * @returns Combined array of offline and online ValidationResult objects.
   */
  async validateAll(config: ImporterConfig): Promise<ValidationResult[]> {
    const offline = this.validateOffline(config);
    const hasFailures = offline.some(r => r.status === 'fail');
    const online = hasFailures ? [] : await this.validateOnline(config);
    return [...offline, ...online];
  }

  /**
   * Formats a list of ValidationResult objects into a human-readable report string.
   * @param results - Array of validation results to format.
   * @returns Multi-line report string with pass/fail/warn lines and a summary.
   */
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

  /**
   * Creates a passing ValidationResult.
   * @param check - Dotted path of the config field checked.
   * @param message - Description of the passing check.
   * @returns A ValidationResult with status 'pass'.
   */
  private pass(check: string, message: string): ValidationResult {
    return { status: 'pass', check, message };
  }

  /**
   * Creates a failing ValidationResult.
   * @param check - Dotted path of the config field checked.
   * @param message - Description of the failure.
   * @returns A ValidationResult with status 'fail'.
   */
  private fail(check: string, message: string): ValidationResult {
    return { status: 'fail', check, message };
  }

  /**
   * Creates a warning ValidationResult.
   * @param check - Dotted path of the config field checked.
   * @param message - Description of the warning.
   * @returns A ValidationResult with status 'warn'.
   */
  private warn(check: string, message: string): ValidationResult {
    return { status: 'warn', check, message };
  }

  // ─── Offline — actual ───

  /**
   * Runs offline checks for the Actual Budget configuration section.
   * @param config - The ImporterConfig whose actual block to check.
   * @returns Array of ValidationResult objects for password, syncId, and serverURL.
   */
  private checkActualOffline(config: ImporterConfig): ValidationResult[] {
    return [
      this.checkActualPassword(config),
      this.checkActualSyncId(config),
      this.checkActualServerUrl(config),
    ];
  }

  /**
   * Checks whether the Actual Budget password is set.
   * @param config - The ImporterConfig to inspect.
   * @returns A pass result if the password is present, otherwise fail.
   */
  private checkActualPassword(config: ImporterConfig): ValidationResult {
    return config.actual.init.password
      ? this.pass('actual.password', 'Actual password is set')
      : this.fail('actual.password', 'ACTUAL_PASSWORD is missing');
  }

  /**
   * Checks whether the Actual Budget syncId is a valid UUID.
   * @param config - The ImporterConfig to inspect.
   * @returns A pass result if the syncId is a valid UUID, otherwise fail.
   */
  private checkActualSyncId(config: ImporterConfig): ValidationResult {
    const { syncId } = config.actual.budget;
    return this.isValidUUID(syncId)
      ? this.pass('actual.syncId', 'syncId UUID format valid')
      : this.fail('actual.syncId', `Invalid syncId: "${syncId}" — expected UUID format`);
  }

  /**
   * Checks whether the Actual server URL is present and starts with http.
   * @param config - The ImporterConfig to inspect.
   * @returns A pass result if the URL is valid, otherwise fail.
   */
  private checkActualServerUrl(config: ImporterConfig): ValidationResult {
    const { serverURL } = config.actual.init;
    if (!serverURL) return this.fail("actual.serverURL", "serverURL is missing");
    return serverURL.startsWith('http')
      ? this.pass('actual.serverURL', `Server URL format valid: ${serverURL}`)
      : this.fail('actual.serverURL',
        `Invalid serverURL "${serverURL}" — must start with http://`);
  }

  // ─── Offline — banks ───

  /**
   * Checks that at least one bank is configured and validates each one offline.
   * @param banks - The banks map from the ImporterConfig.
   * @returns Array of ValidationResult objects for all configured banks.
   */
  private checkBanksOffline(banks: Record<string, BankConfig>): ValidationResult[] {
    if (Object.keys(banks).length === 0) {
      return [this.fail('banks', 'No banks configured')];
    }
    return Object.entries(banks).flatMap(([name, cfg]) => this.checkBankOffline(name, cfg));
  }

  /**
   * Runs all offline checks for a single bank entry.
   * @param name - The bank key from the banks map.
   * @param cfg - The BankConfig to validate.
   * @returns Array of ValidationResult objects for name, dates, and targets.
   */
  private checkBankOffline(name: string, cfg: BankConfig): ValidationResult[] {
    return [
      this.checkBankName(name),
      ...this.checkBankDates(name, cfg),
      ...this.checkBankTargets(name, cfg),
    ];
  }

  /**
   * Checks whether the bank name is a known institution, with typo suggestions.
   * @param name - The bank key to validate against KNOWN_BANKS.
   * @returns A pass result if known, otherwise fail with an optional suggestion.
   */
  private checkBankName(name: string): ValidationResult {
    if (KNOWN_BANKS.has(name.toLowerCase())) {
      return this.pass(`bank.${name}`, `Bank "${name}" — known institution`);
    }
    const suggestion = this.suggest(name.toLowerCase());
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    return this.fail(`bank.${name}`, `Bank "${name}" — unknown institution.${hint}`);
  }

  /**
   * Validates that startDate and daysBack are not both set for a bank.
   * @param name - Bank key used in result messages.
   * @param cfg - The BankConfig whose date fields to check.
   * @returns Array containing a single ValidationResult for the date config.
   */
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

  /**
   * Validates that at least one target is configured and each target is valid.
   * @param name - Bank key used in result messages.
   * @param cfg - The BankConfig whose targets to check.
   * @returns Array of ValidationResult objects, one per target.
   */
  private checkBankTargets(name: string, cfg: BankConfig): ValidationResult[] {
    if (!cfg.targets || cfg.targets.length === 0) {
      return [this.fail(`bank.${name}.targets`, `${name}: no targets configured`)];
    }
    return cfg.targets.map((t, i) => this.checkBankTarget(name, t, i));
  }

  /**
   * Validates a single bank target's actualAccountId format and accounts field.
   * @param name - Bank key used in result messages.
   * @param target - The BankTarget to check.
   * @param idx - Zero-based target index used in result labels.
   * @returns A ValidationResult for this target.
   */
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

  /**
   * Formats the accounts field for display in validation messages.
   * @param accounts - Either 'all' or an array of account number strings.
   * @returns A display string like '[123, 456]' or 'all'.
   */
  private formatAccounts(accounts: BankTarget['accounts']): string {
    return Array.isArray(accounts) ? `[${accounts.join(', ')}]` : accounts;
  }

  // ─── Offline — notifications ───

  /**
   * Runs offline notification checks when notifications are enabled.
   * @param notifications - Optional notifications config block to check.
   * @returns Array of ValidationResult objects for Telegram and webhook.
   */
  private checkNotificationsOffline(
    notifications?: ImporterConfig['notifications']
  ): ValidationResult[] {
    if (!notifications?.enabled) return [];
    const results: ValidationResult[] = [];
    if (notifications.telegram) results.push(...this.checkTelegramOffline(notifications.telegram));
    if (notifications.webhook) results.push(this.checkWebhookOffline(notifications.webhook));
    return results;
  }

  /**
   * Validates Telegram bot token format and chat ID presence offline.
   * @param tg - The Telegram config to check.
   * @returns Array of ValidationResult objects for botToken and chatId.
   */
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

  /**
   * Validates webhook URL presence and format offline.
   * @param wh - The webhook config to check.
   * @returns A ValidationResult for the webhook URL.
   */
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

  /**
   * Checks whether the Actual Budget server is reachable via HTTP.
   * @param config - The ImporterConfig containing the server URL.
   * @returns A ValidationResult indicating server reachability.
   */
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

  /**
   * Verifies that the configured budget exists on the Actual Budget server.
   * @param config - The ImporterConfig with server credentials and budget syncId.
   * @returns A ValidationResult indicating whether the budget was found.
   */
  private async checkActualBudget(config: ImporterConfig): Promise<ValidationResult> {
    const { serverURL, password } = config.actual.init;
    const { syncId } = config.actual.budget;
    try {
      const token = await this.loginToActualServer(serverURL, password);
      if (!token) return this.fail('actual.budget', 'Cannot verify budget — login failed');
      return await this.findBudgetOnServer(serverURL, token, syncId);
    } catch (e: unknown) {
      return this.fail('actual.budget', `Cannot verify budget: ${errorMessage(e)}`);
    }
  }

  /**
   * Authenticates with the Actual Budget server and returns a session token.
   * @param serverURL - The Actual server base URL.
   * @param password - The Actual server password.
   * @returns The session token string, or null if login failed.
   */
  private async loginToActualServer(serverURL: string, password: string): Promise<string | null> {
    const resp = await fetch(`${serverURL}/account/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json() as { data?: { token?: string } };
    return data.data?.token ?? null;
  }

  /**
   * Lists budgets on the server and checks whether the given syncId exists.
   * @param serverURL - The Actual server base URL.
   * @param token - Authenticated session token.
   * @param syncId - The budget sync ID to look for.
   * @returns A pass result if found, fail if not found.
   */
  private async findBudgetOnServer(
    serverURL: string, token: string, syncId: string
  ): Promise<ValidationResult> {
    const resp = await fetch(`${serverURL}/sync/list-user-files`, {
      method: 'POST',
      headers: { 'X-ACTUAL-TOKEN': token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json() as { data?: Array<{ groupId?: string }> };
    const found = (data.data ?? []).some(f => f.groupId === syncId);
    return found
      ? this.pass('actual.budget', `Budget ${syncId.slice(0, 8)}… found on server`)
      : this.fail('actual.budget',
        `Budget "${syncId}" not found — check syncId in Settings → Advanced`);
  }

  /**
   * Verifies the Telegram bot token via the getMe API endpoint.
   * @param tg - The Telegram config containing the bot token to verify.
   * @returns A ValidationResult indicating whether the token is valid.
   */
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

  /**
   * Checks whether the webhook URL responds to an HTTP HEAD request.
   * @param url - The webhook URL to probe.
   * @returns A ValidationResult indicating webhook reachability.
   */
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

  /**
   * Generates a summary line counting failures and warnings from the results.
   * @param results - Array of ValidationResult objects to summarise.
   * @returns Summary string like "Result: 2 errors, 1 warning" or "All checks passed ✓".
   */
  private summarizeCounts(results: ValidationResult[]): string {
    const fails = results.filter(r => r.status === 'fail').length;
    const warns = results.filter(r => r.status === 'warn').length;
    if (fails === 0 && warns === 0) return 'All checks passed ✓';
    const parts: string[] = [];
    if (fails > 0) parts.push(`${fails} error${fails > 1 ? 's' : ''}`);
    if (warns > 0) parts.push(`${warns} warning${warns > 1 ? 's' : ''}`);
    return `Result: ${parts.join(', ')}`;
  }

  /**
   * Checks whether a string matches the UUID format.
   * @param s - The string to test.
   * @returns True if the string is a valid UUID.
   */
  private isValidUUID(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }

  /**
   * Computes the Levenshtein edit distance between two strings.
   * @param a - First string to compare.
   * @param b - Second string to compare.
   * @returns Integer edit distance between a and b.
   */
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

  /**
   * Finds the closest known bank name to the given input, if within edit distance 4.
   * @param name - Lowercased bank name entered by the user.
   * @returns The closest matching known bank name, or null if no close match.
   */
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

/**
 * CLI entry point for --validate mode: loads config, runs all checks, prints report.
 * @returns Exit code: 0 if all checks pass, 1 if any check fails.
 */
export async function runValidateMode(): Promise<number> {
  const loader = new ConfigLoader();
  let config: ImporterConfig;
  try {
    config = loader.loadRaw();
  } catch (e) {
    getLogger().info(`[FAIL] Cannot load config: ${errorMessage(e)}`);
    return 1;
  }
  const validator = new ConfigValidator();
  const results = await validator.validateAll(config);
  getLogger().info(validator.formatReport(results));
  return results.some(r => r.status === 'fail') ? 1 : 0;
}
