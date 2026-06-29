#!/usr/bin/env node
/**
 * Generates a scrypt password hash for the config portal. Usage:
 *   node scripts/hash-portal-password.js "my-password"
 * Copy the printed value into credentials.json → portal.passwordHash.
 */
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-portal-password.js "<password>"');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
console.log(`scrypt$${salt}$${hash}`);
