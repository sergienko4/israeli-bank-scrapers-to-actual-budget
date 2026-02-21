#!/usr/bin/env node
/**
 * Decrypt config.json in-place for editing
 * Usage: CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/decrypt-config.js [input]
 */
import { readFileSync, writeFileSync } from 'fs';
import { decryptConfig, isEncryptedConfig } from '../dist/config/ConfigEncryption.js';

const inputPath = process.argv[2] || 'config.json';
const password = process.env.CREDENTIALS_ENCRYPTION_PASSWORD;

if (!password) {
  console.error('❌ Set CREDENTIALS_ENCRYPTION_PASSWORD environment variable');
  console.error('   Example: CREDENTIALS_ENCRYPTION_PASSWORD=mypassword node scripts/decrypt-config.js');
  process.exit(1);
}

try {
  const raw = readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!isEncryptedConfig(parsed)) {
    console.error('❌ Config is not encrypted (already plain text)');
    process.exit(1);
  }
  const decrypted = decryptConfig(raw, password);
  writeFileSync(inputPath, JSON.stringify(JSON.parse(decrypted), null, 2));
  console.log(`✅ ${inputPath} decrypted successfully`);
  console.log('⚠️  Re-encrypt after editing: CREDENTIALS_ENCRYPTION_PASSWORD=... node scripts/encrypt-config.js');
} catch (error) {
  console.error(`❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
