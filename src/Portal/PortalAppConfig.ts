/**
 * Resolution of the `portal.app` block — the settings that govern mobile-app
 * sign-in. Every field is hand-editable JSON, so nothing is trusted: an
 * out-of-range TTL or a malformed redirect URI falls back to a safe value
 * rather than reaching the authorize endpoint.
 *
 * The redirect allow-list is the only thing standing between an authorization
 * code and an attacker-controlled app, so an entry that cannot be matched
 * exactly is dropped. Dropping every entry disables app sign-in entirely: a
 * feature that is enabled but has nowhere safe to send a code is worse than a
 * feature that is off.
 */

import type { IPortalAppConfig, IPortalConfig } from '../Types/Index.js';

const MAX_REDIRECT_URI_LENGTH = 512;

/** Bounds for an integer config field, with the value used when it is invalid. */
interface IRange {
  min: number;
  max: number;
  fallback: number;
}

const ACCESS_TTL: IRange = { min: 1, max: 60, fallback: 15 };
const REFRESH_TTL: IRange = { min: 1, max: 365, fallback: 60 };

/** Fully-resolved mobile-app authorization settings. */
export interface IPortalAppRuntime {
  /** True only when the feature is switched on AND has a usable redirect URI. */
  enabled: boolean;
  /** Redirect URIs an authorization code may be sent to, matched exactly. */
  redirectUris: readonly string[];
  /** Lifetime of an issued access token, in minutes. */
  accessTokenTtlMinutes: number;
  /** Lifetime of an issued refresh token, in days. */
  refreshTokenTtlDays: number;
}

/**
 * Whether a redirect URI is safe to hand an authorization code to.
 *
 * A fragment would let a code land in a part of the URL the app never parses,
 * and embedded whitespace defeats the exact-match comparison the authorize
 * endpoint relies on, so both are rejected outright. The value must also parse
 * as a URL: `https://` clears every other check here and is still not somewhere
 * a code can be delivered.
 * @param value - Candidate redirect URI, already trimmed.
 * @returns True when the URI can be used as an allow-list entry.
 */
export function isValidRedirectUri(value: string): boolean {
  if (value.length === 0 || value.length > MAX_REDIRECT_URI_LENGTH) return false;
  if (!value.includes('://') || value.includes('#')) return false;
  if (/\s/.test(value)) return false;
  return URL.canParse(value);
}

/**
 * Keeps the entries that survive {@link isValidRedirectUri}, trimming each and
 * discarding anything that is not a string. Invalid entries are dropped rather
 * than rejected so one typo cannot lock a working app out.
 * @param entries - Raw entries from config or from the env override.
 * @returns The trimmed, usable redirect URIs, in their original order.
 */
function validUris(entries: readonly unknown[]): string[] {
  const kept: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (isValidRedirectUri(trimmed)) kept.push(trimmed);
  }
  return kept;
}

/**
 * Resolves the redirect allow-list. A non-blank `PORTAL_APP_REDIRECT_URIS`
 * replaces the configured list outright (comma separated) so a deployment can
 * point at a different app build without editing config files.
 * @param app - Raw app config block.
 * @returns The validated allow-list, possibly empty.
 */
function resolveRedirectUris(app: IPortalAppConfig): string[] {
  const override = process.env.PORTAL_APP_REDIRECT_URIS?.trim() ?? '';
  if (override.length > 0) {
    const parts = override.split(',');
    return validUris(parts);
  }
  return Array.isArray(app.redirectUris) ? validUris(app.redirectUris) : [];
}

/**
 * Whether app sign-in is switched on, honouring the `PORTAL_APP_ENABLED`
 * override in both directions like the other portal env flags.
 * @param app - Raw app config block.
 * @returns True when the operator asked for app sign-in.
 */
function resolveEnabled(app: IPortalAppConfig): boolean {
  const override = process.env.PORTAL_APP_ENABLED;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return app.enabled === true;
}

/**
 * Clamps a hand-edited integer field to its legal range.
 * @param value - Raw value from config, of unknown shape.
 * @param range - Legal bounds plus the value to use when the input is invalid.
 * @returns The value when it is a legal integer, else the fallback.
 */
function boundedInt(value: unknown, range: IRange): number {
  const isLegal = typeof value === 'number'
    && Number.isInteger(value)
    && value >= range.min
    && value <= range.max;
  return isLegal ? value : range.fallback;
}

/**
 * Resolves the `portal.app` block into settings the routes can rely on.
 * @param portal - The portal config block, possibly without an `app` section.
 * @returns Fully-resolved app authorization settings.
 */
export function resolvePortalApp(portal: IPortalConfig): IPortalAppRuntime {
  const app = portal.app ?? {};
  const redirectUris = resolveRedirectUris(app);
  const isRequested = resolveEnabled(app);
  return {
    enabled: isRequested && redirectUris.length > 0,
    redirectUris,
    accessTokenTtlMinutes: boundedInt(app.accessTokenTtlMinutes, ACCESS_TTL),
    refreshTokenTtlDays: boundedInt(app.refreshTokenTtlDays, REFRESH_TTL),
  };
}
