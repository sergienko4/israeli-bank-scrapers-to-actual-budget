#!/usr/bin/env node
/**
 * Generates a scrypt password hash for the config portal.
 *
 * The plaintext is read from the PORTAL_PASSWORD env var or from piped stdin —
 * never from argv, so it can't leak via shell history or the process list.
 *
 * Usage (pick one):
 *   PORTAL_PASSWORD='my-password' node scripts/hash-portal-password.js
 *   printf '%s' 'my-password' | node scripts/hash-portal-password.js
 *
 * Copy the printed value into credentials.json → portal.passwordHash.
 */
import { randomBytes, scryptSync } from 'node:crypto';

const USAGE = 'Provide the portal password without exposing it on the command line:\n'
  + "  PORTAL_PASSWORD='my-password' node scripts/hash-portal-password.js\n"
  + "  printf '%s' 'my-password' | node scripts/hash-portal-password.js";

/**
 * Reads the entire stdin stream as a UTF-8 string.
 * @returns {Promise<string>} the collected stdin content
 */
async function readStdin() {
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/**
 * Resolves the plaintext password from the env var, falling back to piped stdin.
 * @returns {Promise<string>} the password with any trailing newline stripped
 */
async function readPassword() {
  const fromEnv = process.env.PORTAL_PASSWORD;
  if (fromEnv) return fromEnv;
  if (process.stdin.isTTY) return '';
  const fromStdin = await readStdin();
  return fromStdin.replace(/\r?\n$/, '');
}

const password = await readPassword();
if (!password) {
  console.error(USAGE);
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
console.log(`scrypt$${salt}$${hash}`);
