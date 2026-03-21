/**
 * ConfigValidator — offline + online config health checks
 * Returns IValidationResult[] instead of throwing, so all issues surface at once.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import { getLogger } from '../Logger/Index.js';
import type { IBankConfig, IBankTarget,IImporterConfig, INotificationConfig } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { ConfigLoader } from './ConfigLoader.js';

/** A single check result from config validation. */
export interface IValidationResult {
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
  /** Whether online checks should run when offline checks fail. */
  private readonly _skipOnlineOnFailure = true;

  /**
   * Runs all offline validation checks (no network calls).
   * @param config - The IImporterConfig to validate.
   * @returns Array of IValidationResult objects for each check.
   */
  public static validateOffline(config: IImporterConfig): IValidationResult[] {
    return [
      ...ConfigValidator.checkActualOffline(config),
      ...ConfigValidator.checkBanksOffline(config.banks),
      ...ConfigValidator.checkNotificationsOffline(config.notifications),
    ];
  }

  /**
   * Runs online checks (server reachability, budget existence, Telegram token, webhook URL).
   * @param config - The IImporterConfig to validate.
   * @returns Array of IValidationResult objects from the online checks.
   */
  public static async validateOnline(config: IImporterConfig): Promise<IValidationResult[]> {
    const serverResult = await ConfigValidator.checkActualServer(config);
    const results = [serverResult];
    if (serverResult.status === 'pass') results.push(await ConfigValidator.checkActualBudget(config));
    const tg = config.notifications?.enabled ? config.notifications.telegram : undefined;
    if (tg) results.push(await ConfigValidator.checkTelegramToken(tg));
    const wh = config.notifications?.enabled ? config.notifications.webhook : undefined;
    if (wh) results.push(await ConfigValidator.checkWebhookUrl(wh.url));
    return results;
  }

  /**
   * Runs both offline and online validation, skipping online checks if offline fails.
   * @param config - The IImporterConfig to validate.
   * @returns Combined array of offline and online IValidationResult objects.
   */
  public async validateAll(config: IImporterConfig): Promise<IValidationResult[]> {
    const offline = ConfigValidator.validateOffline(config);
    const hasFailures = offline.some(r => r.status === 'fail');
    const shouldSkipOnline = hasFailures && this._skipOnlineOnFailure;
    const online = shouldSkipOnline ? [] : await ConfigValidator.validateOnline(config);
    return [...offline, ...online];
  }

  /**
   * Formats a list of IValidationResult objects into a human-readable report string.
   * @param results - Array of validation results to format.
   * @returns Multi-line report string with pass/fail/warn lines and a summary.
   */
  public static formatReport(results: IValidationResult[]): string {
    const sep = '='.repeat(40);
    const lines = ['Config Validation Report', sep];
    for (const r of results) {
      const statusLabel = r.status === 'fail' ? 'FAIL' : 'WARN';
      const label = r.status === 'pass' ? 'PASS' : statusLabel;
      lines.push(`[${label}] ${r.message}`);
    }
    const countsSummary = ConfigValidator.summarizeCounts(results);
    lines.push(sep, countsSummary);
    return lines.join('\n');
  }

  // ─── Result builders ───

  /**
   * Creates a passing IValidationResult.
   * @param check - Dotted path of the config field checked.
   * @param message - Description of the passing check.
   * @returns A IValidationResult with status 'pass'.
   */
  private static pass(check: string, message: string): IValidationResult {
    return { status: 'pass', check, message };
  }

  /**
   * Creates a failing IValidationResult.
   * @param check - Dotted path of the config field checked.
   * @param message - Description of the failure.
   * @returns A IValidationResult with status 'fail'.
   */
  private static fail(check: string, message: string): IValidationResult {
    return { status: 'fail', check, message };
  }

  /**
   * Creates a warning IValidationResult.
   * @param check - Dotted path of the config field checked.
   * @param message - Description of the warning.
   * @returns A IValidationResult with status 'warn'.
   */
  private static warn(check: string, message: string): IValidationResult {
    return { status: 'warn', check, message };
  }

  // ─── Offline — actual ───

  /**
   * Runs offline checks for the Actual Budget configuration section.
   * @param config - The IImporterConfig whose actual block to check.
   * @returns Array of IValidationResult objects for password, syncId, and serverURL.
   */
  private static checkActualOffline(config: IImporterConfig): IValidationResult[] {
    return [
      ConfigValidator.checkActualPassword(config),
      ConfigValidator.checkActualSyncId(config),
      ConfigValidator.checkActualServerUrl(config),
    ];
  }

  /**
   * Checks whether the Actual Budget password is set.
   * @param config - The IImporterConfig to inspect.
   * @returns A pass result if the password is present, otherwise fail.
   */
  private static checkActualPassword(config: IImporterConfig): IValidationResult {
    return config.actual.init.password
      ? ConfigValidator.pass('actual.password', 'Actual password is set')
      : ConfigValidator.fail('actual.password', 'ACTUAL_PASSWORD is missing');
  }

  /**
   * Checks whether the Actual Budget syncId is a valid UUID.
   * @param config - The IImporterConfig to inspect.
   * @returns A pass result if the syncId is a valid UUID, otherwise fail.
   */
  private static checkActualSyncId(config: IImporterConfig): IValidationResult {
    const { syncId } = config.actual.budget;
    return ConfigValidator.isValidUUID(syncId)
      ? ConfigValidator.pass('actual.syncId', 'syncId UUID format valid')
      : ConfigValidator.fail('actual.syncId', `Invalid syncId: "${syncId}" — expected UUID format`);
  }

  /**
   * Checks whether the Actual server URL is present and starts with http.
   * @param config - The IImporterConfig to inspect.
   * @returns A pass result if the URL is valid, otherwise fail.
   */
  private static checkActualServerUrl(config: IImporterConfig): IValidationResult {
    const { serverURL } = config.actual.init;
    if (!serverURL) return ConfigValidator.fail('actual.serverURL', 'serverURL is missing');
    return serverURL.startsWith('http')
      ? ConfigValidator.pass('actual.serverURL', `Server URL format valid: ${serverURL}`)
      : ConfigValidator.fail('actual.serverURL',
        `Invalid serverURL "${serverURL}" — must start with http://`);
  }

  // ─── Offline — banks ───

  /**
   * Checks that at least one bank is configured and validates each one offline.
   * @param banks - The banks map from the IImporterConfig.
   * @returns Array of IValidationResult objects for all configured banks.
   */
  private static checkBanksOffline(banks: Record<string, IBankConfig>): IValidationResult[] {
    if (Object.keys(banks).length === 0) {
      return [ConfigValidator.fail('banks', 'No banks configured')];
    }
    return Object.entries(banks)
      .flatMap(([name, cfg]) => ConfigValidator.checkBankOffline(name, cfg));
  }

  /**
   * Runs all offline checks for a single bank entry.
   * @param name - The bank key from the banks map.
   * @param cfg - The IBankConfig to validate.
   * @returns Array of IValidationResult objects for name, dates, and targets.
   */
  private static checkBankOffline(name: string, cfg: IBankConfig): IValidationResult[] {
    return [
      ConfigValidator.checkBankName(name),
      ...ConfigValidator.checkBankDates(name, cfg),
      ...ConfigValidator.checkBankTargets(name, cfg),
    ];
  }

  /**
   * Checks whether the bank name is a known institution, with typo suggestions.
   * @param name - The bank key to validate against KNOWN_BANKS.
   * @returns A pass result if known, otherwise fail with an optional suggestion.
   */
  private static checkBankName(name: string): IValidationResult {
    const lowerName = name.toLowerCase();
    if (KNOWN_BANKS.has(lowerName)) {
      return ConfigValidator.pass(`bank.${name}`, `Bank "${name}" — known institution`);
    }
    const suggestion = ConfigValidator.suggest(lowerName);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    return ConfigValidator.fail(`bank.${name}`, `Bank "${name}" — unknown institution.${hint}`);
  }

  /**
   * Validates that startDate and daysBack are not both set for a bank.
   * @param name - Bank key used in result messages.
   * @param cfg - The IBankConfig whose date fields to check.
   * @returns Array containing a single IValidationResult for the date config.
   */
  private static checkBankDates(name: string, cfg: IBankConfig): IValidationResult[] {
    if (cfg.startDate && cfg.daysBack) {
      return [ConfigValidator.fail(`bank.${name}.dates`,
        `${name}: cannot use both "startDate" and "daysBack" — choose one`)];
    }
    if (!cfg.startDate && !cfg.daysBack) {
      return [ConfigValidator.warn(`bank.${name}.dates`,
        `${name}: no daysBack/startDate set — will fetch ~1 year of history`)];
    }
    return [ConfigValidator.pass(`bank.${name}.dates`, `${name}: date config valid`)];
  }

  /**
   * Validates that at least one target is configured and each target is valid.
   * @param name - Bank key used in result messages.
   * @param cfg - The IBankConfig whose targets to check.
   * @returns Array of IValidationResult objects, one per target.
   */
  private static checkBankTargets(name: string, cfg: IBankConfig): IValidationResult[] {
    if (!cfg.targets || cfg.targets.length === 0) {
      return [ConfigValidator.fail(`bank.${name}.targets`, `${name}: no targets configured`)];
    }
    return cfg.targets.map((t, i) => ConfigValidator.checkBankTarget(name, t, i));
  }

  /**
   * Validates a single bank target's actualAccountId format and accounts field.
   * @param name - Bank key used in result messages.
   * @param target - The IBankTarget to check.
   * @param idx - Zero-based target index used in result labels.
   * @returns A IValidationResult for this target.
   */
  private static checkBankTarget(
    name: string, target: IBankTarget, idx: number
  ): IValidationResult {
    const id = target.actualAccountId;
    const tag = `bank.${name}.target[${String(idx)}]`;
    if (!id || !ConfigValidator.isValidUUID(id)) {
      const idLabel = id || '(empty)';
      return ConfigValidator.fail(tag,
        `${name} target[${String(idx)}]: invalid actualAccountId "${idLabel}" — expected UUID`);
    }
    const label = target.accountName ?? `...${id.split('-').at(-1) ?? ''}`;
    const accts = Array.isArray(target.accounts) ? `[${target.accounts.join(', ')}]` : target.accounts;
    const rec = String(target.reconcile);
    return ConfigValidator.pass(tag,
      `${name} target[${String(idx)}] "${label}": accounts=${accts}, reconcile=${rec}`);
  }

  // ─── Offline — notifications ───

  /**
   * Runs offline notification checks when notifications are enabled.
   * @param notifications - Optional notifications config block to check.
   * @returns Array of IValidationResult objects for Telegram and webhook.
   */
  private static checkNotificationsOffline(
    notifications?: IImporterConfig['notifications']
  ): IValidationResult[] {
    if (!notifications?.enabled) return [];
    const results: IValidationResult[] = [];
    const { telegram, webhook } = notifications;
    if (telegram) {
      const telegramResults = ConfigValidator.checkTelegramOffline(telegram);
      results.push(...telegramResults);
    }
    if (webhook) {
      const webhookResult = ConfigValidator.checkWebhookOffline(webhook);
      results.push(webhookResult);
    }
    return results;
  }

  /**
   * Validates Telegram bot token format and chat ID presence offline.
   * @param tg - The Telegram config to check.
   * @returns Array of IValidationResult objects for botToken and chatId.
   */
  private static checkTelegramOffline(
    tg: NonNullable<INotificationConfig['telegram']>
  ): IValidationResult[] {
    const isTokenValid = /^\d+:.+$/.test(tg.botToken);
    return [
      isTokenValid
        ? ConfigValidator.pass('telegram.botToken', 'Telegram botToken format valid')
        : ConfigValidator.fail('telegram.botToken',
          'Invalid botToken format — expected "123456:ABCdef..."'),
      tg.chatId
        ? ConfigValidator.pass('telegram.chatId', 'Telegram chatId is set')
        : ConfigValidator.fail('telegram.chatId', 'Telegram chatId is missing'),
    ];
  }

  /**
   * Validates webhook URL presence and format offline.
   * @param wh - The webhook config to check.
   * @returns A IValidationResult for the webhook URL.
   */
  private static checkWebhookOffline(
    wh: NonNullable<INotificationConfig['webhook']>
  ): IValidationResult {
    if (!wh.url) return ConfigValidator.fail('webhook.url', 'Webhook URL is missing');
    return wh.url.startsWith('http')
      ? ConfigValidator.pass('webhook.url', `Webhook URL format valid: ${wh.url}`)
      : ConfigValidator.fail('webhook.url',
        `Invalid webhook URL "${wh.url}" — must start with http://`);
  }

  // ─── Online ───

  /**
   * Checks whether the Actual Budget server is reachable via HTTP.
   * @param config - The IImporterConfig containing the server URL.
   * @returns A IValidationResult indicating server reachability.
   */
  private static async checkActualServer(config: IImporterConfig): Promise<IValidationResult> {
    const { serverURL } = config.actual.init;
    try {
      const resp = await fetch(serverURL, { signal: AbortSignal.timeout(5000) });
      return resp.status < 500
        ? ConfigValidator.pass('actual.server', `Actual server reachable: ${serverURL} (${String(resp.status)})`)
        : ConfigValidator.fail('actual.server', `Actual server error ${String(resp.status)}: ${serverURL}`);
    } catch (e) {
      return ConfigValidator.fail('actual.server', `Cannot reach Actual server: ${errorMessage(e)}`);
    }
  }

  /**
   * Verifies that the configured budget exists on the Actual Budget server.
   * @param config - The IImporterConfig with server credentials and budget syncId.
   * @returns A IValidationResult indicating whether the budget was found.
   */
  private static async checkActualBudget(config: IImporterConfig): Promise<IValidationResult> {
    const { serverURL, password } = config.actual.init;
    const { syncId } = config.actual.budget;
    try {
      const token = await ConfigValidator.loginToActualServer(serverURL, password);
      if (!token) return ConfigValidator.fail('actual.budget', 'Cannot verify budget — login failed');
      return await ConfigValidator.findBudgetOnServer(serverURL, token, syncId);
    } catch (e: unknown) {
      return ConfigValidator.fail('actual.budget', `Cannot verify budget: ${errorMessage(e)}`);
    }
  }

  /**
   * Authenticates with the Actual Budget server and returns a session token.
   * @param serverURL - The Actual server base URL.
   * @param password - The Actual server password.
   * @returns The session token string, or null if login failed.
   */
  private static async loginToActualServer(
    serverURL: string, password: string): Promise<string | null> {
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
  private static async findBudgetOnServer(
    serverURL: string, token: string, syncId: string
  ): Promise<IValidationResult> {
    const resp = await fetch(`${serverURL}/sync/list-user-files`, {
      method: 'POST',
      headers: { 'X-ACTUAL-TOKEN': token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await resp.json() as { data?: { groupId?: string }[] };
    const wasFound = (data.data ?? []).some(f => f.groupId === syncId);
    return wasFound
      ? ConfigValidator.pass('actual.budget', `Budget ${syncId.slice(0, 8)}… found on server`)
      : ConfigValidator.fail('actual.budget',
        `Budget "${syncId}" not found — check syncId in Settings → Advanced`);
  }

  /**
   * Verifies the Telegram bot token via the getMe API endpoint.
   * @param tg - The Telegram config containing the bot token to verify.
   * @returns A IValidationResult indicating whether the token is valid.
   */
  private static async checkTelegramToken(
    tg: NonNullable<INotificationConfig['telegram']>
  ): Promise<IValidationResult> {
    try {
      const url = `https://api.telegram.org/bot${tg.botToken}/getMe`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const json: unknown = await resp.json();
      const data = json as { ok: boolean; result?: { username?: string } };
      return data.ok
        ? ConfigValidator.pass('telegram.token', `Telegram bot valid (@${data.result?.username ?? '?'})`)
        : ConfigValidator.fail('telegram.token', 'Invalid Telegram bot token');
    } catch (e) {
      return ConfigValidator.fail('telegram.token', `Telegram check failed: ${errorMessage(e)}`);
    }
  }

  /**
   * Checks whether the webhook URL responds to an HTTP HEAD request.
   * @param url - The webhook URL to probe.
   * @returns A IValidationResult indicating webhook reachability.
   */
  private static async checkWebhookUrl(url: string): Promise<IValidationResult> {
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return resp.ok
        ? ConfigValidator.pass('webhook.url', `Webhook reachable (${String(resp.status)})`)
        : ConfigValidator.warn('webhook.url', `Webhook returned ${String(resp.status)} — may not accept HEAD`);
    } catch (e) {
      return ConfigValidator.fail('webhook.url', `Cannot reach webhook: ${errorMessage(e)}`);
    }
  }

  // ─── Utilities ───

  /**
   * Generates a summary line counting failures and warnings from the results.
   * @param results - Array of IValidationResult objects to summarise.
   * @returns Summary string like "Result: 2 errors, 1 warning" or "All checks passed ✓".
   */
  private static summarizeCounts(results: IValidationResult[]): string {
    const fails = results.filter(r => r.status === 'fail').length;
    const warns = results.filter(r => r.status === 'warn').length;
    if (fails === 0 && warns === 0) return 'All checks passed ✓';
    const parts: string[] = [];
    if (fails > 0) parts.push(`${String(fails)} error${fails > 1 ? 's' : ''}`);
    if (warns > 0) parts.push(`${String(warns)} warning${warns > 1 ? 's' : ''}`);
    return `Result: ${parts.join(', ')}`;
  }

  /**
   * Checks whether a string matches the UUID format.
   * @param s - The string to test.
   * @returns True if the string is a valid UUID.
   */
  private static isValidUUID(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  }

  /**
   * Computes the Levenshtein edit distance between two strings.
   * @param a - First string to compare.
   * @param b - Second string to compare.
   * @returns Integer edit distance between a and b.
   */
  private static levenshtein(a: string, b: string): number {
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
  private static suggest(name: string): string | null {
    let best: string | null = null;
    let bestDist = 4; // only suggest if edit distance < 4
    for (const bank of KNOWN_BANKS) {
      const d = ConfigValidator.levenshtein(name, bank);
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
  const rawResult = loader.loadRaw();
  if (isFail(rawResult)) {
    getLogger().info(`[FAIL] Cannot load config: ${rawResult.message}`);
    return 1;
  }
  const validator = new ConfigValidator();
  const results = await validator.validateAll(rawResult.data);
  const report = ConfigValidator.formatReport(results);
  getLogger().info(report);
  return results.some(r => r.status === 'fail') ? 1 : 0;
}
