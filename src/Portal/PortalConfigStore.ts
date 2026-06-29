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
import { maskSecrets, restoreMasked } from './ConfigMutations.js';

/** Loads, masks, validates, and persists the portal-managed config. */
export default class PortalConfigStore {
  private _config: IImporterConfig;
  private readonly _writer: ConfigWriter;

  /**
   * Builds a store seeded from the given config path.
   * @param configPath - Absolute path to config.json.
   */
  constructor(configPath = '/app/config.json') {
    const loaded = new ConfigLoader(configPath).loadRaw();
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
   * Validates then persists a new config, replacing the in-memory copy.
   * @param next - Replacement config from the portal UI.
   * @returns Procedure success, or first validation/write failure.
   */
  public save(next: IImporterConfig): Procedure<{ saved: true }> {
    const merged = restoreMasked(next, this._config);
    const fails = ConfigValidator.validateOffline(merged).filter(r => r.status === 'fail');
    if (fails.length) {
      const messages = fails.map(f => f.message).join('; ');
      return fail(messages);
    }
    const written = this._writer.write(merged);
    if (isFail(written)) return written;
    this._config = merged;
    return succeed({ saved: true as const });
  }

  /**
   * Returns the unmasked live config (server-side use only).
   * @returns The current in-memory config.
   */
  public raw(): IImporterConfig {
    return this._config;
  }
}
