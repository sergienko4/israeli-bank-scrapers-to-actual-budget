/**
 * Short-lived, single-use authorization codes for the mobile app flow.
 *
 * A code is the only thing that crosses the untrusted hop between the browser
 * and the app, so it carries no secret of its own: it is a random handle to a
 * record held in this process. Redemption is once-only and reuse is treated as
 * theft — the caller revokes every refresh token descended from the code.
 */

import { randomBytes } from 'node:crypto';

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

/** How long an authorization code stays redeemable. */
export const CODE_TTL_MS = 60_000;

/** Longest device label kept from a client-supplied `device_name`. */
export const MAX_DEVICE_NAME = 64;

/** Label used when the client sends no usable device name. */
export const DEFAULT_DEVICE_NAME = 'Mobile app';

/** Authentication factors satisfied when a code was minted. */
export interface IAuthFactors {
  google: boolean;
  password: boolean;
}

/**
 * Narrows an untrusted value to the factor pair, used when reading factors back
 * off disk.
 * @param value - A parsed value of unknown shape.
 * @returns True when both factor flags are booleans.
 */
export function isAuthFactors(value: unknown): value is IAuthFactors {
  if (typeof value !== 'object' || value === null) return false;
  const factors = value as Record<string, unknown>;
  return typeof factors.google === 'boolean' && typeof factors.password === 'boolean';
}

/** Everything the token endpoint needs to know about a pending code. */
export interface IAuthCodeRecord {
  code: string;
  challenge: string;
  redirectUri: string;
  factors: IAuthFactors;
  email?: string;
  fingerprint: string;
  deviceName: string;
  expiresAt: number;
  used: boolean;
}

/** The caller-supplied half of a code record, before minting fills the rest. */
export type AuthCodeInput = Omit<IAuthCodeRecord, 'code' | 'expiresAt' | 'used'>;

/**
 * Whether a character is safe to keep in a device label. Control characters
 * are dropped rather than escaped so a label can never smuggle a terminator
 * into a log line or the sessions list.
 * @param char - A single code point from the untrusted label.
 * @returns True when the character is printable.
 */
function isPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code > 0x1f && code !== 0x7f;
}

/**
 * Strips control characters and trims a client-supplied device label to a
 * length safe to render in the sessions list.
 * @param raw - Untrusted `device_name` parameter, if any.
 * @returns A printable label, falling back to {@link DEFAULT_DEVICE_NAME}.
 */
export function sanitizeDeviceName(raw?: string): string {
  let kept = '';
  for (const char of raw ?? '') if (isPrintable(char)) kept += char;
  const cleaned = kept.trim();
  return cleaned.length > 0 ? cleaned.slice(0, MAX_DEVICE_NAME) : DEFAULT_DEVICE_NAME;
}

/**
 * In-process registry of pending authorization codes. Deliberately not
 * persisted: a code outlives neither a restart nor its 60-second window, and
 * writing one to disk would put a bearer-equivalent secret at rest.
 */
export class AppAuthCodes {
  private readonly _codes = new Map<string, IAuthCodeRecord>();

  /**
   * Mints a code bound to the PKCE challenge, redirect URI and factors in force
   * at authorize time.
   * @param input - Everything known about the authorization at mint time.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns The stored record, including its freshly generated code.
   */
  public mint(input: AuthCodeInput, now: number = Date.now()): IAuthCodeRecord {
    this.sweep(now);
    const record: IAuthCodeRecord = {
      ...input,
      code: randomBytes(32).toString('base64url'),
      expiresAt: now + CODE_TTL_MS,
      used: false,
    };
    this._codes.set(record.code, record);
    return record;
  }

  /**
   * Redeems a code exactly once.
   *
   * A code that was already redeemed stays in the map so this call can report
   * the reuse; the caller reacts by revoking the token family that the first
   * redemption created.
   * @param code - The code presented at the token endpoint.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Procedure with the record, or a failure naming the reason.
   */
  public redeem(code: string, now: number = Date.now()): Procedure<IAuthCodeRecord> {
    this.sweep(now);
    const record = this._codes.get(code);
    if (!record) return fail('Unknown authorization code');
    if (record.used) return fail('Authorization code already redeemed', { status: 'reused' });
    if (record.expiresAt <= now) return fail('Authorization code expired');
    record.used = true;
    return succeed(record);
  }

  /**
   * Drops every code that can no longer be redeemed. Used codes are kept until
   * their expiry so reuse remains detectable for the rest of the window.
   * @param now - Current epoch milliseconds, injectable for tests.
   * @returns Nothing.
   */
  public sweep(now: number = Date.now()): void {
    for (const [code, record] of this._codes) {
      if (record.expiresAt <= now) this._codes.delete(code);
    }
  }

  /**
   * How many codes are currently tracked. Exposed for tests and diagnostics;
   * the codes themselves are never enumerated.
   * @returns Count of pending and recently redeemed codes.
   */
  public get size(): number {
    return this._codes.size;
  }
}
