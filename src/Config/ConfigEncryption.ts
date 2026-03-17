/**
 * Config file encryption/decryption using AES-256-GCM
 * Zero external dependencies — uses Node.js built-in crypto module
 */

import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'node:crypto';
import { errorMessage } from '../Utils/Index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const AUTH_TAG_LENGTH = 16;

export interface EncryptedConfig {
  encrypted: true;
  version: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface EncryptedBuffers { salt: Buffer; iv: Buffer; tag: Buffer; ciphertext: Buffer }

/**
 * Type guard that checks whether an unknown value is an EncryptedConfig object.
 * @param data - The value to inspect.
 * @returns True when data has the shape of an EncryptedConfig.
 */
export function isEncryptedConfig(data: unknown): data is EncryptedConfig {
  return typeof data === 'object'
    && data !== null
    && (data as Record<string, unknown>).encrypted === true;
}

/**
 * Reads the encryption password from environment variables.
 * @returns The password string, or undefined if neither env var is set.
 */
export function getEncryptionPassword(): string | undefined {
  return process.env.CREDENTIALS_ENCRYPTION_PASSWORD ?? process.env.CONFIG_PASSWORD;
}

/**
 * Derives a 256-bit AES key from a password and salt using PBKDF2.
 * @param password - The user-supplied passphrase.
 * @param salt - Random salt buffer used to prevent rainbow-table attacks.
 * @returns A 32-byte derived key buffer.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypts a plain-text JSON string and returns a serialised EncryptedConfig.
 * @param plainJson - The JSON string to encrypt.
 * @param password - Passphrase used to derive the encryption key.
 * @returns Pretty-printed JSON string of the encrypted payload.
 */
export function encryptConfig(plainJson: string, password: string): string {
  if (!password) throw new Error('Encryption password cannot be empty');
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const { ciphertext, tag } = encryptBuffer(plainJson, deriveKey(password, salt), iv);
  return JSON.stringify(buildEncryptedPayload({ salt, iv, tag, ciphertext }), null, 2);
}

/**
 * Encrypts a UTF-8 plaintext string with AES-256-GCM.
 * @param plaintext - The string to encrypt.
 * @param key - 32-byte AES key buffer.
 * @param iv - 16-byte initialisation vector buffer.
 * @returns Object containing the ciphertext and GCM authentication tag.
 */
function encryptBuffer(
  plaintext: string, key: Buffer, iv: Buffer
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

/**
 * Converts raw encryption buffers into a base64-encoded EncryptedConfig object.
 * @param buffers - Object containing salt, iv, tag, and ciphertext buffers.
 * @returns Serialisable EncryptedConfig with all fields base64-encoded.
 */
function buildEncryptedPayload(buffers: EncryptedBuffers): EncryptedConfig {
  const { salt, iv, tag, ciphertext } = buffers;
  return {
    encrypted: true, version: 1,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: tag.toString('base64'), ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypts a serialised EncryptedConfig JSON string back to plain JSON.
 * @param encryptedJson - JSON string produced by encryptConfig.
 * @param password - Passphrase used to derive the decryption key.
 * @returns The original plain-text JSON string.
 */
export function decryptConfig(encryptedJson: string, password: string): string {
  if (!password) throw new Error('CREDENTIALS_ENCRYPTION_PASSWORD is required to decrypt config');
  const data = JSON.parse(encryptedJson) as EncryptedConfig;
  if (!isEncryptedConfig(data)) throw new Error('Config file is not encrypted');
  return decryptBuffer(data, deriveKey(password, Buffer.from(data.salt, 'base64')));
}

/**
 * Decrypts the ciphertext in an EncryptedConfig using AES-256-GCM.
 * @param data - The parsed EncryptedConfig object.
 * @param key - 32-byte AES key buffer derived from the user password.
 * @returns The decrypted UTF-8 string.
 */
function decryptBuffer(data: EncryptedConfig, key: Buffer): string {
  const iv = Buffer.from(data.iv, 'base64');
  const decipher = createDecipheriv(
    ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(data.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (error: unknown) {
    throw new Error(`Decryption failed: ${errorMessage(error)}`, { cause: error });
  }
}
