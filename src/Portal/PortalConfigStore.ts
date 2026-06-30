/**
 * In-memory config store for the portal. Loads the merged config once, serves
 * a masked copy for reads, and validates + persists writes via ConfigWriter.
 * Importer/scheduler re-read files each run, so a write is enough to apply.
 */

import { ConfigLoader } from '../Config/ConfigLoader.js';
import { ConfigValidator, type IValidationResult } from '../Config/ConfigValidator.js';
import ConfigWriter from '../Config/ConfigWriter.js';
import ConfigurationError from '../Errors/ConfigurationError.js';
import type { IImporterConfig, Procedure } from '../Types/Index.js';
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

/**
 * Shapes a candidate config — restores round-tripped masked secrets, hashes a
 * freshly-typed portal password, and coerces target accounts — then gates it on
 * the importer's exact boot rules plus the portal's own auth bootability (see
 * {@link collectGateErrors}). Pure transform + validation, no I/O.
 * @param next - Replacement config from the portal UI.
 * @param current - Live config used to restore round-tripped masked secrets.
 * @returns The validated config, or a failure naming every gate violation.
 */
function shapeAndGate(next: IImporterConfig, current: IImporterConfig): Procedure<IImporterConfig> {
  const restored = restoreMasked(next, current);
  const hashed = hashPlainPortalPassword(restored);
  const merged = coerceTargetAccounts(hashed);
  const errors = collectGateErrors(merged);
  if (errors.length === 0) return succeed(merged);
  const reason = errors.join('; ');
  return fail(reason);
}

/** Loads, masks, validates, and persists the portal-managed config. */
export default class PortalConfigStore {
  private _config: IImporterConfig;
  private readonly _writer: ConfigWriter;

  /**
   * Builds a store seeded from the given config path. A load failure is fatal:
   * it throws to abort portal startup rather than seeding a synthetic empty
   * config, so a transient read error can never be served as real state or
   * persisted over the user's real config on the next save.
   * @param configPath - Absolute path to config.json.
   * @throws Error when the existing config cannot be loaded/parsed.
   */
  constructor(configPath = '/app/config.json') {
    const loaded = new ConfigLoader(configPath).loadRaw();
    if (isFail(loaded)) {
      const reason = `Portal refused to start; config did not load cleanly: ${loaded.message}`;
      throw new ConfigurationError(reason);
    }
    this._config = loaded.data;
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
   * Runs the offline validation report against a candidate config with its
   * round-tripped masked secrets restored, so the portal's live "Validate"
   * preview judges the real secret values it will persist — never the masked
   * placeholders the browser echoes back — keeping the preview and the eventual
   * save verdict in agreement (e.g. a masked Telegram botToken is not reported
   * as a format error it does not actually have).
   * @param next - Candidate config from the portal UI (secrets may be masked).
   * @returns The per-check offline validation report.
   */
  public validate(next: IImporterConfig): IValidationResult[] {
    const restored = restoreMasked(next, this._config);
    return ConfigValidator.validateOffline(restored);
  }

  /**
   * Shapes and gates the incoming config via `shapeAndGate`. Anything that
   * fails there is invalid client input (HTTP 400); the try/catch only relabels
   * unexpected shaping throws as failures, while write/I/O faults are deferred to
   * {@link commit} so they surface as server errors (HTTP 500).
   * @param next - Replacement config from the portal UI.
   * @returns The validated config ready to {@link commit}, or a 400-class failure.
   */
  public prepare(next: IImporterConfig): Procedure<IImporterConfig> {
    try {
      return shapeAndGate(next, this._config);
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
