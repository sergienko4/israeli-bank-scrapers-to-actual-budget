import { describe, it, expect, vi, beforeEach } from 'vitest';

import type TelegramNotifier from '../../../src/Services/Notifications/TelegramNotifier.js';
import { fail, succeed } from '../../../src/Types/ProcedureHelpers.js';

const { mediatorCtor } = vi.hoisted(() => ({ mediatorCtor: vi.fn() }));

vi.mock('../../../src/Services/ImportMediator.js', () => {
  class MockImportMediator {
    setPoller = vi.fn();
    constructor(opts: unknown) { mediatorCtor(opts); }
  }
  return { ImportMediator: MockImportMediator };
});

vi.mock('../../../src/Scheduler/ImportProcessRunner.js', () => ({
  spawnImport: vi.fn(),
}));

vi.mock('../../../src/Scheduler/Telegram/ConfigHelpers.js', () => ({
  getConfiguredBankNames: vi.fn(() => ['bank-a']),
  runConfigValidation: vi.fn(),
}));

import createMediator from '../../../src/Scheduler/Telegram/MediatorFactory.js';

const fakeNotifier = {
  sendMessage: vi.fn(),
} as unknown as TelegramNotifier;

describe('MediatorFactory edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes null notifier when the procedure failed', () => {
    createMediator(fail('no notifier'));
    expect(mediatorCtor).toHaveBeenCalledWith(
      expect.objectContaining({ notifier: null })
    );
  });

  it('forwards the notifier on success', () => {
    createMediator(succeed(fakeNotifier));
    expect(mediatorCtor).toHaveBeenCalledWith(
      expect.objectContaining({ notifier: fakeNotifier })
    );
  });

  it('wires spawnImport and getBankNames from the scheduler', () => {
    createMediator(succeed(fakeNotifier));
    expect(mediatorCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        spawnImport: expect.any(Function),
        getBankNames: expect.any(Function),
      })
    );
  });

  it('returns a single ImportMediator instance per call', () => {
    const a = createMediator(succeed(fakeNotifier));
    const b = createMediator(succeed(fakeNotifier));
    expect(a).not.toBe(b);
    expect(mediatorCtor).toHaveBeenCalledTimes(2);
  });
});
