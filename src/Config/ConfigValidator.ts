/**
 * ConfigValidator — offline + online config health checks orchestrator.
 *
 * Returns IValidationResult[] instead of throwing, so all issues surface
 * at once. After PR 3 of the decoupling plan, the heavy lifting lives in
 * the modules under `./Validators/`; this file is the orchestrator + CLI
 * entry point only.
 */
import { getLogger } from '../Logger/Index.js';
import type { IImporterConfig } from '../Types/Index.js';
import { isFail } from '../Types/Index.js';
import { ConfigLoader } from './ConfigLoader.js';
import { resolveConfigPath } from './ConfigPath.js';
import { checkActualOffline } from './Validators/ActualOfflineChecker.js';
import { checkBanksOffline } from './Validators/BanksOfflineChecker.js';
import {
  checkActualBudget,
  checkActualServer,
  checkTelegramToken,
  checkWebhookUrl,
} from './Validators/ConfigOnlineChecker.js';
import { checkNotificationsOffline } from './Validators/NotificationsOfflineChecker.js';
import { formatReport } from './Validators/ReportFormatter.js';
import type { IValidationResult } from './Validators/ValidationResult.js';

export type { IValidationResult } from './Validators/ValidationResult.js';

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
   * Runs all offline validation checks (no network calls): the required
   * actual/banks/notifications sections, surfacing every issue at once with
   * bank-name typo suggestions. This is a human-readable report, not the boot
   * gate — the portal write-gate additionally runs
   * {@link ConfigLoader.validateBootable} for full importer-boot parity.
   * @param config - The IImporterConfig to validate.
   * @returns Array of IValidationResult objects for each check.
   */
  public static validateOffline(config: IImporterConfig): IValidationResult[] {
    return [
      ...checkActualOffline(config),
      ...checkBanksOffline(config.banks),
      ...checkNotificationsOffline(config.notifications),
    ];
  }

  /**
   * Runs online checks (server reachability, budget existence, Telegram token, webhook URL).
   * @param config - The IImporterConfig to validate.
   * @returns Array of IValidationResult objects from the online checks.
   */
  public static async validateOnline(config: IImporterConfig): Promise<IValidationResult[]> {
    const serverResult = await checkActualServer(config);
    const results = [serverResult];
    if (serverResult.status === 'pass') results.push(await checkActualBudget(config));
    const tg = config.notifications?.enabled ? config.notifications.telegram : undefined;
    if (tg) results.push(await checkTelegramToken(tg));
    const wh = config.notifications?.enabled ? config.notifications.webhook : undefined;
    if (wh) results.push(await checkWebhookUrl(wh.url));
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
    return formatReport(results);
  }
}

/**
 * CLI entry point for --validate mode: loads config, runs all checks, prints report.
 * @returns Exit code: 0 if all checks pass, 1 if any check fails.
 */
export async function runValidateMode(): Promise<number> {
  const loader = new ConfigLoader(resolveConfigPath());
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
