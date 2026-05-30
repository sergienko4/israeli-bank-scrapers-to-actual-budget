/**
 * Unit tests for the maskPhone logger helper.
 */

import { describe, it, expect } from 'vitest';

import maskPhone from '../../src/Logger/MaskPhone.js';

describe('maskPhone', () => {
  it('TC-MASK-001 — masks canonical input keeping last 3 digits', () => {
    expect(maskPhone('972542155100')).toBe('972***100');
  });

  it('TC-MASK-002 — masks leading-plus input', () => {
    expect(maskPhone('+972542155100')).toBe('972***100');
  });

  it('TC-MASK-003 — returns <masked> for empty input', () => {
    expect(maskPhone('')).toBe('<masked>');
  });

  it('TC-MASK-004 — returns <masked> for unparseable input', () => {
    expect(maskPhone('foo')).toBe('<masked>');
  });

  it('TC-MASK-005 — preserves the literal last 3 digits', () => {
    expect(maskPhone('972000000999')).toBe('972***999');
  });
});
