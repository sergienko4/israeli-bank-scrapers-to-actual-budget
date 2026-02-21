/**
 * Config file encryption/decryption using AES-256-GCM
 * Zero external dependencies — uses Node.js built-in crypto module
 */

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';

export interface EncryptedConfig {
  encrypted: true;
  version: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function isEncryptedConfig(data: unknown): data is EncryptedConfig {
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>).encrypted === true;
}

export function getEncryptionPassword(): string | undefined {
  return process.env.CREDENTIALS_ENCRYPTION_PASSWORD ?? process.env.CONFIG_PASSWORD;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

export function encryptConfig(plainJson: string, password: string): string {
  if (!password) throw new Error('Encryption password cannot be empty');
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const { ciphertext, tag } = encryptBuffer(plainJson, deriveKey(password, salt), iv);
  return JSON.stringify(buildEncryptedPayload(salt, iv, tag, ciphertext), null, 2);
}

function encryptBuffer(plaintext: string, key: Buffer, iv: Buffer): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

function buildEncryptedPayload(salt: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer): EncryptedConfig {
  return {
    encrypted: true, version: 1,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: tag.toString('base64'), ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptConfig(encryptedJson: string, password: string): string {
  if (!password) throw new Error('CREDENTIALS_ENCRYPTION_PASSWORD is required to decrypt config');
  const data = JSON.parse(encryptedJson) as EncryptedConfig;
  if (!isEncryptedConfig(data)) throw new Error('Config file is not encrypted');
  return decryptBuffer(data, deriveKey(password, Buffer.from(data.salt, 'base64')));
}

function decryptBuffer(data: EncryptedConfig, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Decryption failed: invalid password or corrupted data');
  }
}
