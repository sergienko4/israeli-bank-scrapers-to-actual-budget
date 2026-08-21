#!/usr/bin/env node
/**
 * Reads the local portal's `/api/status` the way the phone app does.
 *
 * Signs in with the local password, then prints the run history the app's
 * Status screen renders. Used to prove PR #637: before the fix a fully-failed
 * run leaves this list untouched, after it the run shows up as a failure.
 *
 * Usage (from the repository root):
 *   node tests/e2e/local-stack/status.mjs
 */
const BASE = process.env.PORTAL_BASE ?? 'http://127.0.0.1:8080';
const PASSWORD = process.env.PORTAL_PASSWORD ?? 'local-validation';

/**
 * Signs in and returns the session cookie header.
 * @returns {Promise<string>} A `Cookie` header value for the signed-in session.
 */
async function signIn() {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status} ${await response.text()}`);
  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((value) => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login returned no session cookie');
  return cookie;
}

/**
 * Fetches and prints the recent run history.
 * @returns {Promise<void>}
 */
async function main() {
  const cookie = await signIn();
  const response = await fetch(`${BASE}/api/status`, { headers: { cookie } });
  if (!response.ok) throw new Error(`status failed: ${response.status} ${await response.text()}`);
  const body = await response.json();
  console.log(JSON.stringify(body, null, 2));
  console.log(`\nruns: ${body.runs.length}`);
  for (const run of body.runs) {
    const failed = run.failedBanks > 0 ? 'FAILED' : 'ok';
    console.log(
      `  ${run.timestamp}  ${failed}  ${run.successRate}%  `
      + `${run.successfulBanks}/${run.totalBanks} ok  txns=${run.totalTransactions}`,
    );
    for (const bank of run.banks) {
      const reason = bank.error ? ` — ${bank.error}` : '';
      console.log(`      ${bank.name}: ${bank.status}${reason}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
