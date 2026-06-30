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
import { coerceTargetAccounts, hashPlainPortalPassword, maskSecrets, restoreMasked } from './ConfigMutations.js';
import { isPortalEnabled, portalBootBlocker, resolvePortalRuntime } from './PortalRuntime.js';

/**
 * Portal-auth bootability errors for the candidate config, but only when the
 * saved config would actually start a portal ({@link isPortalEnabled}) — exactly
 * mirroring {@link bootPortal}, so a save is blocked iff the next portal boot
 * would refuse. A disabled or absent portal block can lock nobody out, so it is
 * skipped (and a config with no portal block stays writable).
 * @param merged - Shaped candidate config.
 * @returns A one-element array with the boot-blocking reason, or empty.
 */
function portalAuthGateErrors(merged: IImporterConfig): string[] {
  if (!isPortalEnabled(merged)) return [];
  const runtime = resolvePortalRuntime(merged);
  const authError = portalBootBlocker(runtime);
  return authError ? [authError] : [];
}

/**
 * Collects every reason the portal write-gate must reject a candidate config,
 * de-duplicated. Combines the offline report (rich, with bank-name typo hints),
 * the importer's exact boot gate ({@link ConfigLoader.validateBootable} — so a
 * save can never persist a config the next import would exit(1) on), and the
 * portal's own auth bootability ({@link portalAuthGateErrors} — so a save can
 * never lock every operator out of the portal it just enabled).
 * @param merged - Shaped candidate config (secrets restored, password hashed).
 * @returns Distinct human-readable failure messages; empty when fully bootable.
 */
function collectGateErrors(merged: IImporterConfig): string[] {
  const offline = ConfigValidator.validateOffline(merged)
    .filter(result => result.status === 'fail').map(result => result.message);
  const bootable = ConfigLoader.validateBootable(merged);
  const bootMessages = isFail(bootable) ? [bootable.message] : [];
  const authMessages = portalAuthGateErrors(merged);
  const distinct = new Set([...offline, ...bootMessages, ...authMessages]);
  return [...distinct];
}

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
   * Returns the unmasked live config (server-side use only).
   * @returns The current in-memory config.
   */
  public raw(): IImporterConfig {
    return this._config;
  }

  /**
   * Shapes (restore masked secrets, hash a freshly-typed portal password, and
   * coerce target accounts) the incoming config, then gates it on the importer's
   * exact boot rules plus the portal's own auth bootability (see
   * `collectGateErrors`). Anything that fails here is invalid client input
   * (HTTP 400); write/I/O faults are deferred to {@link commit} so they surface
   * as server errors (HTTP 500).
   * @param next - Replacement config from the portal UI.
   * @returns The validated config ready to {@link commit}, or a 400-class failure.
   */
  public prepare(next: IImporterConfig): Procedure<IImporterConfig> {
    if (!this._loaded) {
      return fail('Config did not load cleanly; refusing to overwrite existing files');
    }
    try {
      const restored = restoreMasked(next, this._config);
      const hashed = hashPlainPortalPassword(restored);
      const merged = coerceTargetAccounts(hashed);
      const errors = collectGateErrors(merged);
      if (errors.length) {
        const reason = errors.join('; ');
        return fail(reason);
      }
      return succeed(merged);
    } catch (error: unknown) {
      return fail(`Invalid config: ${errorMessage(error)}`);
    }
  }

  /**
   * Writes an already-{@link prepare}d config and replaces the in-memory copy.
   * Runs outside prepare's try/catch so an unexpected write failure surfaces as
   * a server error (HTTP 500) rather than being relabeled as invalid client input.
   * @param merged - Validated config from {@link prepare}.
   * @returns Procedure success, or the writer's failure.
   */
  public commit(merged: IImporterConfig): Procedure<{ saved: true }> {
    const written = this._writer.write(merged);
    if (isFail(written)) return written;
    this._config = merged;
    return succeed({ saved: true as const });
  }
}
