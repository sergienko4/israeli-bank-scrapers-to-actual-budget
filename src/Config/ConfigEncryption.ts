/**
 * Config file encryption/decryption using AES-256-GCM
 * Zero external dependencies — uses Node.js built-in crypto module
 */

import { createCipheriv, createDecipheriv,pbkdf2Sync, randomBytes } from 'node:crypto';

import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { errorMessage } from '../Utils/Index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const AUTH_TAG_LENGTH = 16;

export interface IEncryptedConfig {
  encrypted: true;
  version: number;
  salt: string;
  initVector: string;
  tag: string;
  ciphertext: string;
}

interface IEncryptedBuffers { salt: Buffer; initVector: Buffer; tag: Buffer; ciphertext: Buffer }

/**
 * Type guard that checks whether a parsed JSON value is an IEncryptedConfig object.
 * @param data - The value to inspect (typed as Record for safe property access).
 * @returns True when data has the shape of an IEncryptedConfig.
 */
export function isEncryptedConfig(
  data: Record<string, string | number | boolean> | IEncryptedConfig
): data is IEncryptedConfig {
  return data.encrypted === true;
}

/**
 * Reads the encryption password from environment variables.
 * @returns The password string, or empty string if neither env var is set.
 */
export function getEncryptionPassword(): string {
  return process.env.CREDENTIALS_ENCRYPTION_PASSWORD ?? process.env.CONFIG_PASSWORD ?? '';
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
 * Encrypts a plain-text JSON string and returns a serialised IEncryptedConfig.
 * @param plainJson - The JSON string to encrypt.
 * @param password - Passphrase used to derive the encryption key.
 * @returns Pretty-printed JSON string of the encrypted payload.
 */
export function encryptConfig(plainJson: string, password: string): string {
  if (!password) throw new ConfigurationError('Encryption password cannot be empty');
  const salt = randomBytes(SALT_LENGTH);
  const initVector = randomBytes(IV_LENGTH);
  const derivedKey = deriveKey(password, salt);
  const { ciphertext, tag } = encryptBuffer(plainJson, derivedKey, initVector);
  const payload = buildEncryptedPayload({ salt, initVector, tag, ciphertext });
  return JSON.stringify(payload, null, 2);
}

/**
 * Encrypts a UTF-8 plaintext string with AES-256-GCM.
 * @param plaintext - The string to encrypt.
 * @param key - 32-byte AES key buffer.
 * @param initVector - 16-byte initialisation vector buffer.
 * @returns Object containing the ciphertext and GCM authentication tag.
 */
function encryptBuffer(
  plaintext: string, key: Buffer, initVector: Buffer
): { ciphertext: Buffer; tag: Buffer } {
  const cipher = createCipheriv(ALGORITHM, key, initVector, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

/**
 * Converts raw encryption buffers into a base64-encoded IEncryptedConfig object.
 * @param buffers - Object containing salt, initVector, tag, and ciphertext buffers.
 * @returns Serialisable IEncryptedConfig with all fields base64-encoded.
 */
function buildEncryptedPayload(buffers: IEncryptedBuffers): IEncryptedConfig {
  const { salt, initVector, tag, ciphertext } = buffers;
  return {
    encrypted: true, version: 1,
    salt: salt.toString('base64'), initVector: initVector.toString('base64'),
    tag: tag.toString('base64'), ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypts a serialised IEncryptedConfig JSON string back to plain JSON.
 * @param encryptedJson - JSON string produced by encryptConfig.
 * @param password - Passphrase used to derive the decryption key.
 * @returns The original plain-text JSON string.
 */
export function decryptConfig(encryptedJson: string, password: string): string {
  if (!password) {
    throw new ConfigurationError('CREDENTIALS_ENCRYPTION_PASSWORD is required to decrypt config');
  }
  const data = JSON.parse(encryptedJson) as Record<string, string | number | boolean>;
  if (!isEncryptedConfig(data)) {
    throw new ConfigurationError('Config file is not encrypted');
  }
  const saltBuffer = Buffer.from(data.salt, 'base64');
  const derivedKey = deriveKey(password, saltBuffer);
  return decryptBuffer(data, derivedKey);
}

/**
 * Decrypts the ciphertext in an IEncryptedConfig using AES-256-GCM.
 * @param data - The parsed IEncryptedConfig object.
 * @param key - 32-byte AES key buffer derived from the user password.
 * @returns The decrypted UTF-8 string.
 */
function decryptBuffer(data: IEncryptedConfig, key: Buffer): string {
  const initVector = Buffer.from(data.initVector, 'base64');
  const decipher = createDecipheriv(
    ALGORITHM, key, initVector, { authTagLength: AUTH_TAG_LENGTH }
  );
  const authTag = Buffer.from(data.tag, 'base64');
  decipher.setAuthTag(authTag);
  try {
    const ciphertextBuffer = Buffer.from(data.ciphertext, 'base64');
    return Buffer.concat([
      decipher.update(ciphertextBuffer),
      decipher.final()
    ]).toString('utf8');
  } catch (error: unknown) {
    throw new ConfigurationError(
      `Decryption failed: ${errorMessage(error)}`
    );
  }
}
