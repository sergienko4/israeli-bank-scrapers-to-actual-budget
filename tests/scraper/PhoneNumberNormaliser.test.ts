/**
 * Unit tests for PhoneNumberNormaliser — covers the canonical
 * `972XXXXXXXXX` coercion contract used by PayBox, Pepper, OneZero.
 */

import { describe, it, expect } from 'vitest';

import normalisePhoneNumber from '../../src/Scraper/PhoneNumberNormaliser.js';

describe('normalisePhoneNumber', () => {
  it('TC-NORM-001 — strips leading plus', () => {
    const result = normalisePhoneNumber('+972542155100');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('972542155100');
  });

  it('TC-NORM-002 — rejects landline length (972-3-1234567 = 11 digits)', () => {
    const result = normalisePhoneNumber('972-3-1234567');
    expect(result.success).toBe(false);
  });

  it('TC-NORM-003 — strips dashes from canonical mobile form', () => {
    const result = normalisePhoneNumber('972-52-1234567');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('972521234567');
  });

  it('TC-NORM-004 — strips spaces', () => {
    const result = normalisePhoneNumber('972 52 1234567');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('972521234567');
  });

  it('TC-NORM-005 — strips mixed +/-/spaces', () => {
    const result = normalisePhoneNumber('+972 52-123-4567');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('972521234567');
  });

  it('TC-NORM-006 — coerces leading-zero Israeli local form', () => {
    const result = normalisePhoneNumber('0521234567');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('972521234567');
  });

  it('TC-NORM-007 — accepts already canonical form (idempotent)', () => {
    const result = normalisePhoneNumber('972521234567');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('972521234567');
  });

  it('TC-NORM-008 — rejects empty string', () => {
    const result = normalisePhoneNumber('');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/Israeli digits-only/);
  });

  it('TC-NORM-009 — rejects non-Israeli prefix', () => {
    const result = normalisePhoneNumber('+447700900123');
    expect(result.success).toBe(false);
  });

  it('TC-NORM-010 — rejects too-short input', () => {
    const result = normalisePhoneNumber('972123');
    expect(result.success).toBe(false);
  });
});
