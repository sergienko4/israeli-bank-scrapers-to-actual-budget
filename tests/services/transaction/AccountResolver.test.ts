/**
 * Edge-case unit tests for AccountResolver — locks in the Procedure
 * pattern semantics (succeed/fail) plus the Actual-API name-fallback
 * quirk: createAccount may ignore the configured UUID and assign its
 * own, so subsequent lookups by ID fail and we retry by matching the
 * deterministic label.
 *
 * Happy path is exercised by tests/services/TransactionService.test.ts;
 * this file covers only the resolver-local branches.
 */
import type api from '@actual-app/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountResolver from '../../../src/Services/Transaction/AccountResolver.js';
import type { IActualAccount } from '../../../src/Types/Index.js';
import { isFail, isSuccess } from '../../../src/Types/Index.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

interface IMockApi {
  getAccounts: ReturnType<typeof vi.fn>;
  createAccount: ReturnType<typeof vi.fn>;
}

let mockApi: IMockApi;

beforeEach(() => {
  mockApi = { getAccounts: vi.fn(), createAccount: vi.fn() };
  vi.clearAllMocks();
});

describe('AccountResolver.getOrCreateAccount — lookup by ID', () => {
  it('returns the existing account when the UUID matches', async () => {
    const existing: IActualAccount = { id: 'uuid-1', name: 'Bank - 123' };
    mockApi.getAccounts.mockResolvedValue([existing]);
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('uuid-1', 'Bank', '123');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.data.id).toBe('uuid-1');
    expect(mockApi.createAccount).not.toHaveBeenCalled();
  });
});

describe('AccountResolver.getOrCreateAccount — name fallback', () => {
  it('matches by label when the UUID misses', async () => {
    const existing: IActualAccount = { id: 'server-uuid', name: 'Bank - 123' };
    mockApi.getAccounts.mockResolvedValue([existing]);
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('configured-uuid', 'Bank', '123');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.data.id).toBe('server-uuid');
  });

  it('warns and picks the first when multiple accounts share the same label', async () => {
    const acctA: IActualAccount = { id: 'a', name: 'Bank - 123' };
    const acctB: IActualAccount = { id: 'b', name: 'Bank - 123' };
    mockApi.getAccounts.mockResolvedValue([acctA, acctB]);
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('missing', 'Bank', '123');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.data.id).toBe('a');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('2 accounts named "Bank - 123"'),
    );
  });
});

describe('AccountResolver.getOrCreateAccount — create path', () => {
  it('creates a new account when neither ID nor label match', async () => {
    mockApi.getAccounts.mockResolvedValue([]);
    mockApi.createAccount.mockResolvedValue({ id: 'new-uuid', name: 'Bank - 999' });
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('configured-uuid', 'Bank', '999');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) expect(result.data.id).toBe('new-uuid');
  });

  it('wraps a string return from createAccount as { id, name }', async () => {
    mockApi.getAccounts.mockResolvedValue([]);
    mockApi.createAccount.mockResolvedValue('server-string-uuid');
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('configured-uuid', 'Bank', '999');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.id).toBe('server-string-uuid');
      expect(result.data.name).toBe('Bank - 999');
    }
  });

  it('returns fail(account-not-found) when createAccount returns empty', async () => {
    mockApi.getAccounts.mockResolvedValue([]);
    mockApi.createAccount.mockResolvedValue(undefined);
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('configured-uuid', 'Bank', '999');
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.status).toBe('account-not-found');
  });

  it('returns fail when createAccount throws', async () => {
    mockApi.getAccounts.mockResolvedValue([]);
    mockApi.createAccount.mockRejectedValue(new Error('boom'));
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('configured-uuid', 'Bank', '999');
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.message).toMatch(/Account creation failed/);
  });

  it('returns fail when getAccounts throws', async () => {
    mockApi.getAccounts.mockRejectedValue(new Error('network'));
    const r = new AccountResolver(mockApi as unknown as typeof api);
    const result = await r.getOrCreateAccount('configured-uuid', 'Bank', '999');
    expect(isFail(result)).toBe(true);
    if (isFail(result)) expect(result.message).toMatch(/Account lookup failed/);
  });
});
