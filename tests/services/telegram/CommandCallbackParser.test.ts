import { describe, expect, it } from 'vitest';

import {
  extractPrefixPayload,
  parseCommand,
} from '../../../src/Services/Telegram/CommandCallbackParser.js';

describe('CommandCallbackParser', () => {
  describe('parseCommand', () => {
    it('lowercases plain slash commands', () => {
      const r = parseCommand('/SCAN');
      expect(r.command).toBe('/scan');
      expect(r.arg).toBe('');
    });

    it('returns whitespace remainder as arg', () => {
      const r = parseCommand('/scan discount,leumi');
      expect(r.command).toBe('/scan');
      expect(r.arg).toBe('discount,leumi');
    });

    it('returns empty arg when only whitespace remainder', () => {
      const r = parseCommand('/scan   ');
      expect(r.arg).toBe('');
    });

    it('preserves colon payload casing on prefix tokens', () => {
      const r = parseCommand('SCAN:Discount');
      expect(r.command).toBe('scan:Discount');
    });

    it('preserves payload on receipt_acc colon prefix', () => {
      const r = parseCommand('receipt_acc:Abc-123');
      expect(r.command).toBe('receipt_acc:Abc-123');
    });

    it('handles exact callback values like scan_all', () => {
      const r = parseCommand('scan_all');
      expect(r.command).toBe('scan_all');
      expect(r.arg).toBe('');
    });

    it('trims surrounding whitespace into raw', () => {
      const r = parseCommand('   /help   ');
      expect(r.command).toBe('/help');
      expect(r.raw).toBe('/help');
    });

    it('handles a colon with empty payload', () => {
      const r = parseCommand('scan:');
      expect(r.command).toBe('scan:');
    });
  });

  describe('extractPrefixPayload', () => {
    it('strips the prefix and returns the payload', () => {
      expect(extractPrefixPayload('scan:cal', 'scan:')).toBe('cal');
    });

    it('returns empty string when prefix is missing', () => {
      expect(extractPrefixPayload('/scan', 'receipt_acc:')).toBe('');
    });

    it('returns empty string when payload is empty', () => {
      expect(extractPrefixPayload('receipt_acc:', 'receipt_acc:')).toBe('');
    });

    it('trims whitespace inside the payload', () => {
      expect(extractPrefixPayload('scan:  cal  ', 'scan:')).toBe('cal');
    });
  });
});
