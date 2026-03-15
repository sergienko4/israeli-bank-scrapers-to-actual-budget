#!/usr/bin/env node
/**
 * Encrypt config.json in-place using AES-256-GCM
 * Usage: CREDENTIALS_ENCRYPTION_PASSWORD=<your-key> node scripts/encrypt-config.js [input]
 */
import { readFileSync, writeFileSync } from 'fs';
import { encryptConfig, isEncryptedConfig } from '../dist/config/ConfigEncryption.js';

const inputPath = process.argv[2] || 'config.json';
const password = process.env.CREDENTIALS_ENCRYPTION_PASSWORD;

if (!password) {
  console.error('❌ Set CREDENTIALS_ENCRYPTION_PASSWORD environment variable');
  console.error('   Example: CREDENTIALS_ENCRYPTION_PASSWORD=<your-key> node scripts/encrypt-config.js');
  process.exit(1);
}

try {
  const raw = readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (isEncryptedConfig(parsed)) {
    console.error('❌ Config is already encrypted');
    process.exit(1);
  }
  writeFileSync(inputPath, encryptConfig(raw, password));
  console.log(`✅ ${inputPath} encrypted successfully`);
  console.log('🔐 Keep CREDENTIALS_ENCRYPTION_PASSWORD safe — you need it to run the importer');
} catch (error) {
  console.error(`❌ Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
