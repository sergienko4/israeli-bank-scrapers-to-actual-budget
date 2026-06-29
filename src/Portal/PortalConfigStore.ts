/**
 * In-memory config store for the portal. Loads the merged config once, serves
 * a masked copy for reads, and validates + persists writes via ConfigWriter.
 * Importer/scheduler re-read files each run, so a write is enough to apply.
 */

import { ConfigLoader } from '../Config/ConfigLoader.js';
import { ConfigValidator } from '../Config/ConfigValidator.js';
import ConfigWriter from '../Config/ConfigWriter.js';
import type { IActualConfig, IImporterConfig, Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { coerceTargetAccounts, maskSecrets, restoreMasked } from './ConfigMutations.js';

/** Loads, masks, validates, and persists the portal-managed config. */
export default class PortalConfigStore {
  private _config: IImporterConfig;
  private readonly _writer: ConfigWriter;
  private readonly _loaded: boolean;

  /**
   * Builds a store seeded from the given config path.
   * @param configPath - Absolute path to config.json.
   */
  constructor(configPath = '/app/config.json') {
    const loaded = new ConfigLoader(configPath).loadRaw();
    this._loaded = !isFail(loaded);
    this._config = isFail(loaded) ? { actual: {} as IActualConfig, banks: {} } : loaded.data;
    this._writer = new ConfigWriter(configPath);
  }

  /**
   * Returns the live config with secrets masked for transport.
   * @returns Masked copy safe to send to the browser.
   */
  public masked(): IImporterConfig {
    return maskSecrets(this._config);
  }

  /**
   * Validates then persists a new config, replacing the in-memory copy. A
   * malformed body that trips the validators is reported as a failure (400),
   * never an unhandled 500.
   * @param next - Replacement config from the portal UI.
   * @returns Procedure success, or first validation/write failure.
   */
  public save(next: IImporterConfig): Procedure<{ saved: true }> {
    if (!this._loaded) {
      return fail('Config did not load cleanly; refusing to overwrite existing files');
    }
    const validated = this.validate(next);
    if (isFail(validated)) return validated;
    return this.persist(validated.data);
  }

  /**
   * Returns the unmasked live config (server-side use only).
   * @returns The current in-memory config.
   */
  public raw(): IImporterConfig {
    return this._config;
  }

  /**
   * Shapes (restore masked secrets + coerce target accounts) and offline-validates
   * the incoming config. Anything that throws or fails here is treated as invalid
   * client input (mapped to HTTP 400); write/I/O faults are deferred to
   * {@link persist} so they surface as server errors instead.
   * @param next - Replacement config from the portal UI.
   * @returns The validated config, or a failure describing the bad input.
   */
  private validate(next: IImporterConfig): Procedure<IImporterConfig> {
    try {
      const restored = restoreMasked(next, this._config);
      const merged = coerceTargetAccounts(restored);
      const fails = ConfigValidator.validateOffline(merged).filter(r => r.status === 'fail');
      if (fails.length) {
        const messages = fails.map(f => f.message).join('; ');
        return fail(messages);
      }
      return succeed(merged);
    } catch (error: unknown) {
      return fail(`Invalid config: ${errorMessage(error)}`);
    }
  }

  /**
   * Writes an already-validated config and replaces the in-memory copy. Runs
   * outside {@link validate}'s try/catch so an unexpected write failure surfaces
   * as a server error rather than being relabeled as invalid client input.
   * @param merged - Validated config ready to persist.
   * @returns Procedure success, or the writer's failure.
   */
  private persist(merged: IImporterConfig): Procedure<{ saved: true }> {
    const written = this._writer.write(merged);
    if (isFail(written)) return written;
    this._config = merged;
    return succeed({ saved: true as const });
  }
}
