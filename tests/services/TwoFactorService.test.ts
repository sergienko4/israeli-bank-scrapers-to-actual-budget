import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwoFactorService } from '../../src/Services/TwoFactorService.js';
import { TelegramNotifier } from '../../src/Services/Notifications/TelegramNotifier.js';

describe('TwoFactorService', () => {
  let mockNotifier: Pick<TelegramNotifier, 'waitForReply' | 'sendMessage' | 'sendOtpMessage' | 'sendSummary' | 'sendError'>;
  let service: TwoFactorService;

  beforeEach(() => {
    mockNotifier = {
      waitForReply: vi.fn(),
      sendMessage: vi.fn(),
      sendOtpMessage: vi.fn(),
      sendSummary: vi.fn(),
      sendError: vi.fn()
    };
    service = new TwoFactorService(mockNotifier as TelegramNotifier, 60);
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
      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('authenticating')
      );
    });

    it('includes masked OTP code in Telegram confirmation message', async () => {
      mockNotifier.waitForReply.mockResolvedValue('123456');

      const retriever = service.createOtpRetriever('beinleumi');
      await retriever();

      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('1****6')
      );
    });

    it('masks 4-digit OTP correctly', async () => {
      mockNotifier.waitForReply.mockResolvedValue('1234');

      const retriever = service.createOtpRetriever('beinleumi');
      await retriever();

      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('1**4')
      );
    });

    it('two retrievers for different banks produce independent masked codes', async () => {
      const notifier2 = {
        waitForReply: vi.fn().mockResolvedValue('789012'),
        sendMessage: vi.fn(),
        sendOtpMessage: vi.fn(),
        sendSummary: vi.fn(),
        sendError: vi.fn(),
      };
      mockNotifier.waitForReply.mockResolvedValue('123456');

      const service2 = new TwoFactorService(notifier2 as TelegramNotifier, 60);
      const retrieverB = service.createOtpRetriever('beinleumi');
      const retrieverO = service2.createOtpRetriever('oneZero');

      await retrieverB();
      await retrieverO();

      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(expect.stringContaining('1****6'));
      expect(notifier2.sendOtpMessage).toHaveBeenCalledWith(expect.stringContaining('7****2'));
    });

    it('extracts digits from reply', async () => {
      mockNotifier.waitForReply.mockResolvedValue('Code: 789012');

      const retriever = service.createOtpRetriever('oneZero');
      const code = await retriever();

      expect(code).toBe('789012');
      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('authenticating')
      );
    });

    it('handles reply with spaces', async () => {
      mockNotifier.waitForReply.mockResolvedValue('12 34 56');

      const retriever = service.createOtpRetriever('oneZero');
      const code = await retriever();

      expect(code).toBe('123456');
      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('authenticating')
      );
    });

    it('throws on too short code', async () => {
      mockNotifier.waitForReply.mockResolvedValue('12');

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('Invalid OTP code');
      expect(mockNotifier.sendOtpMessage).not.toHaveBeenCalled();
    });

    it('throws on too long code', async () => {
      mockNotifier.waitForReply.mockResolvedValue('123456789');

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('Invalid OTP code');
      expect(mockNotifier.sendOtpMessage).not.toHaveBeenCalled();
    });

    it('throws on no digits', async () => {
      mockNotifier.waitForReply.mockResolvedValue('hello');

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('Invalid OTP code');
      expect(mockNotifier.sendOtpMessage).not.toHaveBeenCalled();
    });

    it('propagates timeout error from notifier', async () => {
      mockNotifier.waitForReply.mockRejectedValue(new Error('2FA timeout: no reply received'));

      const retriever = service.createOtpRetriever('oneZero');

      await expect(retriever()).rejects.toThrow('2FA timeout');
      expect(mockNotifier.sendOtpMessage).not.toHaveBeenCalled();
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
      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('authenticating')
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
      expect(mockNotifier.sendOtpMessage).toHaveBeenCalledWith(
        expect.stringContaining('authenticating')
      );
    });
  });
});
