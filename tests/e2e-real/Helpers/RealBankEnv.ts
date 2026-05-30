/**
 * Helpers for the real-bank E2E suite: env-driven credential loaders,
 * gate flag, and a readline-based OTP retriever for human-in-the-loop tests.
 *
 * All loaders return Procedure<IBankConfig>; missing required env vars
 * surface as fail('skip-no-creds: <VAR>') so test files can SKIP cleanly
 * without throwing and without exposing the env var name in noisy errors.
 */

import readline from 'node:readline';

import type { IBankConfig, Procedure } from '../../../src/Types/Index.js';
import { fail, succeed } from '../../../src/Types/Index.js';

/**
 * Returns true when the real-bank suite gate is open.
 * @returns true when process.env.RUN_REAL_BANK_TESTS === 'true'.
 */
export function realBankTestsEnabled(): boolean {
  return process.env.RUN_REAL_BANK_TESTS === 'true';
}

/**
 * Builds a Procedure failure for a missing env var, using the canonical
 * 'skip-no-creds' status so test files can distinguish it from real errors.
 * @param varName - Name of the missing env var.
 * @returns Procedure failure with status='skip-no-creds'.
 */
function missing(varName: string): ReturnType<typeof fail> {
  return fail(`skip-no-creds: ${varName}`, { status: 'skip-no-creds' });
}

/**
 * Loads PayBox real credentials from env.
 * @returns Procedure success with IBankConfig or 'skip-no-creds' failure.
 */
export function loadPayboxCreds(): Procedure<IBankConfig> {
  const phoneNumber = process.env.PAYBOX_PHONE_NUMBER;
  if (!phoneNumber) return missing('PAYBOX_PHONE_NUMBER');
  const config: IBankConfig = {
    phoneNumber,
    twoFactorAuth: true,
    otpLongTermToken: process.env.PAYBOX_OTP_LONG_TERM ?? '',
    daysBack: 7,
  };
  return succeed(config);
}

/**
 * Loads Pepper real credentials from env.
 * @returns Procedure success with IBankConfig or 'skip-no-creds' failure.
 */
export function loadPepperCreds(): Procedure<IBankConfig> {
  const phoneNumber = process.env.PEPPER_PHONE_NUMBER;
  if (!phoneNumber) return missing('PEPPER_PHONE_NUMBER');
  const password = process.env.PEPPER_PASSWORD;
  if (!password) return missing('PEPPER_PASSWORD');
  const config: IBankConfig = {
    phoneNumber,
    password,
    twoFactorAuth: true,
    otpLongTermToken: process.env.PEPPER_OTP_LONG_TERM ?? '',
    daysBack: 7,
  };
  return succeed(config);
}

/**
 * Loads OneZero real credentials from env.
 * @returns Procedure success with IBankConfig or 'skip-no-creds' failure.
 */
export function loadOnezeroCreds(): Procedure<IBankConfig> {
  const email = process.env.ONEZERO_EMAIL;
  if (!email) return missing('ONEZERO_EMAIL');
  const password = process.env.ONEZERO_PASSWORD;
  if (!password) return missing('ONEZERO_PASSWORD');
  const phoneNumber = process.env.ONEZERO_PHONE_NUMBER;
  if (!phoneNumber) return missing('ONEZERO_PHONE_NUMBER');
  const config: IBankConfig = {
    email,
    password,
    phoneNumber,
    twoFactorAuth: true,
    otpLongTermToken: process.env.ONEZERO_OTP_LONG_TERM ?? '',
    daysBack: 7,
  };
  return succeed(config);
}

/**
 * Builds an OTP retriever that prompts the user on stdin (readline).
 * Used when a real OTP code arrives via SMS during a real-bank test.
 * @param bankId - bank id used in the prompt label.
 * @returns Async function resolving to the user-entered OTP code.
 */
export function buildStdinOtpRetriever(bankId: string): () => Promise<string> {
  return (): Promise<string> => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n[${bankId}] Enter OTP code from SMS: `, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
