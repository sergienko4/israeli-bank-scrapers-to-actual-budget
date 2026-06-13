import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isFail, isSuccess } from '../../../src/Types/ProcedureHelpers.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { mockIsEncrypted, mockGetPassword, mockDecrypt } = vi.hoisted(() => ({
  mockIsEncrypted: vi.fn(),
  mockGetPassword: vi.fn(),
  mockDecrypt: vi.fn(),
}));
vi.mock('../../../src/Config/ConfigEncryption.js', () => ({
  isEncryptedConfig: mockIsEncrypted,
  getEncryptionPassword: mockGetPassword,
  decryptConfig: mockDecrypt,
}));

import * as fs from 'node:fs';

import readJsonOrEncrypted from '../../../src/Scheduler/Config/ConfigFileReader.js';

describe('ConfigFileReader.readJsonOrEncrypted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEncrypted.mockReset();
    mockGetPassword.mockReset();
    mockDecrypt.mockReset();
  });

  it('returns a failure when the file is absent', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('File not found');
  });

  it('parses plain JSON when the payload is not encrypted', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ foo: 'bar' }));
    mockIsEncrypted.mockReturnValue(false);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toEqual({ foo: 'bar' });
  });

  it('decrypts and returns the inner JSON when the payload is encrypted', () => {
    const encryptedRaw = JSON.stringify({ alg: 'aes-256-gcm', payload: 'opaque' });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(encryptedRaw);
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
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ alg: 'aes' }));
    mockIsEncrypted.mockReturnValue(true);
    mockGetPassword.mockReturnValue(undefined);
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Encryption password required');
  });

  it('wraps unexpected read errors in a failure procedure', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('disk burned down');
    });
    const result = readJsonOrEncrypted('/app/config.json');
    expect(result.success).toBe(false);
    if (!isFail(result)) return;
    expect(result.message).toContain('Failed to read /app/config.json');
    expect(result.message).toContain('disk burned down');
  });
});
