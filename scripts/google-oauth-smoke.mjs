#!/usr/bin/env node
/**
 * Google OAuth config-validity smoke (CI, secret-gated).
 *
 * Real interactive Google sign-in cannot run headless (Google blocks automated
 * consent), so this validates the *credentials* rather than a browser flow:
 *
 *   1. Fetch Google's OpenID discovery document and assert it still advertises
 *      the authorization + token endpoints (drift guard if Google moves them).
 *   2. POST a deliberately invalid authorization code to the token endpoint with
 *      the real client_id + client_secret + redirect_uri. Google's reply proves
 *      whether the configured credentials are recognised:
 *        - error "invalid_grant"         → PASS (creds + redirect valid; only the
 *                                          throwaway code was rejected)
 *        - error "invalid_client"        → FAIL (client_id / client_secret wrong)
 *        - error "redirect_uri_mismatch" → FAIL (redirect URI not registered)
 *
 * Secrets (GitHub repo secrets, passed as env): GOOGLE_CLIENT_ID,
 * GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI. When any is absent the smoke
 * self-skips (exit 0) so forks and secret-less runs stay green. The
 * client_id / client_secret values are never printed.
 *
 * Usage: node scripts/google-oauth-smoke.mjs
 */

const DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration';
const PASS_ERROR = 'invalid_grant';
const FAIL_ERRORS = {
  invalid_client: 'client_id / client_secret is not recognised by Google',
  redirect_uri_mismatch: 'redirect URI is not registered on this OAuth client',
};

/**
 * Reads the three Google secrets from the environment.
 * @returns {{ clientId?: string, clientSecret?: string, redirectUri?: string }} env values
 */
function readEnv() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  };
}

/**
 * Fetches a URL with a small retry to absorb transient network blips.
 * @param {string} url request URL
 * @param {object} [opts] fetch options
 * @param {number} [attempts] total attempts before throwing
 * @returns {Promise<Response>} the resolved response
 */
async function fetchWithRetry(url, opts = {}, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url, opts);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Loads Google's discovery document and validates the endpoints we rely on.
 * @returns {Promise<string>} the discovered token endpoint URL
 */
async function discoverTokenEndpoint() {
  const res = await fetchWithRetry(DISCOVERY_URL);
  if (!res.ok) throw new Error(`discovery returned HTTP ${res.status}`);
  const doc = await res.json();
  for (const key of ['authorization_endpoint', 'token_endpoint']) {
    const value = doc[key];
    if (typeof value !== 'string' || !value.startsWith('https://')) {
      throw new Error(`discovery is missing a valid ${key}`);
    }
  }
  console.log(`Discovery OK — token endpoint: ${doc.token_endpoint}`);
  return doc.token_endpoint;
}

/**
 * Exchanges a throwaway code so Google validates the real credentials.
 * @param {string} tokenEndpoint discovered token endpoint
 * @param {{ clientId: string, clientSecret: string, redirectUri: string }} creds configured creds
 * @returns {Promise<string>} the OAuth `error` code Google returned (empty if none)
 */
async function probeCredentials(tokenEndpoint, creds) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'invalid-config-smoke-code',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: creds.redirectUri,
  });
  const res = await fetchWithRetry(tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return typeof json.error === 'string' ? json.error : '';
}

/**
 * Runs the smoke and resolves to a process exit code.
 * @returns {Promise<number>} 0 = pass or skip, 1 = fail
 */
async function run() {
  const creds = readEnv();
  if (!creds.clientId || !creds.clientSecret || !creds.redirectUri) {
    console.log('Google OAuth smoke skipped: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / '
      + 'GOOGLE_REDIRECT_URI not all set.');
    return 0;
  }
  console.log(`Validating Google OAuth config (redirect_uri: ${creds.redirectUri})`);
  const tokenEndpoint = await discoverTokenEndpoint();
  const error = await probeCredentials(tokenEndpoint, creds);
  if (error === PASS_ERROR) {
    console.log('PASS — credentials + redirect URI recognised by Google.');
    return 0;
  }
  const reason = FAIL_ERRORS[error]
    ?? `unexpected token-endpoint response: "${error || 'no error field'}"`;
  console.error(`FAIL — ${reason}`);
  return 1;
}

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`FAIL — Google OAuth smoke errored: ${error.message}`);
    process.exit(1);
  });
