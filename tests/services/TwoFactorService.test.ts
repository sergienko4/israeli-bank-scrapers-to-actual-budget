import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwoFactorService } from '../../src/services/TwoFactorService.js';

describe('TwoFactorService', () => {
  let mockNotifier: any;
  let service: TwoFactorService;

  beforeEach(() => {
    mockNotifier = {
      waitForReply: vi.fn(),
      sendMessage: vi.fn(),
      sendSummary: vi.fn(),
      sendError: vi.fn()
    };
    service = new TwoFactorService(mockNotifier, 60);
  });

  describe('createOtpRetriever', () => {
    it('returns a callback that asks for OTP via Telegram', async () => {
      mockNotifier.waitForReply.mockResolvedValue('123456');

      const retriever = service.createOtpRetriever('oneZero');
      const code = await retriever();

      expect(code).toBe('123456');
      expect(mockNotifier.waitForReply).toHaveBeenCalledWith(
        expect.stringContaining('oneZero'),
        60000
      );
    });

    it('extracts digits from reply', async () => {
      mockNotifier.waitForReply.mockResolvedValue('Code: 789012');

      const retriever = service.createOtpRetriever('oneZero');
      const code = await retriever();

      expect(code).toBe('789012');
    });

    it('handles reply with spaces', async () => {
      mockNotifier.waitForReply.mockResolvedValue('12 34 56');

      const retriever = service.createOtpRetriever('oneZero');
      const code = await retriever();

      expect(code).toBe('123456');
    });

    it('throws on too short code', async () => {
      mockNotifier.waitForReply.mockResolvedValue('12');

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('Invalid OTP code');
    });

    it('throws on too long code', async () => {
      mockNotifier.waitForReply.mockResolvedValue('123456789');

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('Invalid OTP code');
    });

    it('throws on no digits', async () => {
      mockNotifier.waitForReply.mockResolvedValue('hello');

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('Invalid OTP code');
    });

    it('propagates timeout error from notifier', async () => {
      mockNotifier.waitForReply.mockRejectedValue(new Error('2FA timeout: no reply received'));

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('2FA timeout');
    });
  });

  describe('timeout configuration', () => {
    it('uses configured timeout in milliseconds', async () => {
      const customService = new TwoFactorService(mockNotifier, 120);
      mockNotifier.waitForReply.mockResolvedValue('123456');

      const retriever = customService.createOtpRetriever('oneZero');
      await retriever();

      expect(mockNotifier.waitForReply).toHaveBeenCalledWith(
        expect.any(String),
        120000
      );
    });

    it('defaults to 300 seconds when not specified', async () => {
      const defaultService = new TwoFactorService(mockNotifier);
      mockNotifier.waitForReply.mockResolvedValue('123456');

      const retriever = defaultService.createOtpRetriever('oneZero');
      await retriever();

      expect(mockNotifier.waitForReply).toHaveBeenCalledWith(
        expect.any(String),
        300000
      );
    });
  });
});
