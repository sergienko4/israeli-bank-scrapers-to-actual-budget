import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fail, isFail, isSuccess, succeed } from '../../../src/Types/ProcedureHelpers.js';

const { mockReadText, mockIsEncrypted, mockGetPassword, mockDecrypt } = vi.hoisted(() => ({
  mockReadText: vi.fn(),
  mockIsEncrypted: vi.fn(),
  mockGetPassword: vi.fn(),
  mockDecrypt: vi.fn(),
}));
vi.mock('../../../src/Config/ConfigEncryption.js', () => ({
  isEncryptedConfig: mockIsEncrypted,
  getEncryptionPassword: mockGetPassword,
  decryptConfig: mockDecrypt,
}));

vi.mock('../../../src/Config/Loaders/ConfigFileText.js', () => ({ default: mockReadText }));

import readJsonOrEncrypted from '../../../src/Scheduler/Config/ConfigFileReader.js';

describe('ConfigFileReader.readJsonOrEncrypted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEncrypted.mockReset();
    mockGetPassword.mockReset();
    mockDecrypt.mockReset();
    mockReadText.mockReset();
  });

  it('returns a failure when the file is absent', () => {
    mockReadText.mockReturnValue(
      fail('Could not read /app/config.json: ENOENT', { status: 'ENOENT' }),
    );
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toBe('File not found: /app/config.json');
  });

  it('parses plain JSON when the payload is not encrypted', () => {
    mockReadText.mockReturnValue(succeed(JSON.stringify({ foo: 'bar' })));
    mockIsEncrypted.mockReturnValue(false);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toEqual({ foo: 'bar' });
  });

  it('decrypts and returns the inner JSON when the payload is encrypted', () => {
    const encryptedRaw = JSON.stringify({ alg: 'aes-256-gcm', payload: 'opaque' });
    mockReadText.mockReturnValue(succeed(encryptedRaw));
    mockIsEncrypted.mockReturnValue(true);
    mockGetPassword.mockReturnValue('secret');
    mockDecrypt.mockReturnValue(JSON.stringify({ banks: { leumi: {} } }));
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toEqual({ banks: { leumi: {} } });
    expect(mockDecrypt).toHaveBeenCalledWith(encryptedRaw, 'secret');
  });

  it('fails when the encrypted payload has no available password', () => {
    mockReadText.mockReturnValue(succeed(JSON.stringify({ alg: 'aes' })));
    mockIsEncrypted.mockReturnValue(true);
    mockGetPassword.mockReturnValue(undefined);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Encryption password required');
  });

  it('forwards any other read failure unchanged', () => {
    const unreadable = fail('Could not read /app/config.json: EACCES', { status: 'EACCES' });
    mockReadText.mockReturnValue(unreadable);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result).toBe(unreadable);
  });
});
