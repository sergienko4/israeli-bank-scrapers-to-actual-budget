/**
 * Online (network-touching) config checks.
 *
 * Extracted from `ConfigValidator.ts` (PR 3 of the decoupling plan).
 *
 * Each check times out at 5 seconds via `AbortSignal.timeout(5000)` and
 * converts thrown errors to `fail` results so the orchestrator never
 * has to wrap calls in try/catch.
 */
import type { IImporterConfig, INotificationConfig } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import { fail, type IValidationResult,pass, warn } from './ValidationResult.js';

/**
 * Authenticates with the Actual Budget server and returns a session token.
 * @param serverURL - The Actual server base URL.
 * @param password - The Actual server password.
 * @returns The session token string, or empty string if login failed.
 */
async function loginToActualServer(
  serverURL: string, password: string): Promise<string> {
  const resp = await fetch(`${serverURL}/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await resp.json() as { data?: { token?: string } };
  return data.data?.token ?? '';
}

/**
 * Lists budgets on the server and checks whether the given syncId exists.
 * @param serverURL - The Actual server base URL.
 * @param token - Authenticated session token.
 * @param syncId - The budget sync ID to look for.
 * @returns A pass result if found, fail if not found.
 */
async function findBudgetOnServer(
  serverURL: string, token: string, syncId: string
): Promise<IValidationResult> {
  const resp = await fetch(`${serverURL}/sync/list-user-files`, {
    method: 'POST',
    headers: { 'X-ACTUAL-TOKEN': token, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  const data = await resp.json() as { data?: { groupId?: string }[] };
  const wasFound = (data.data ?? []).some(f => f.groupId === syncId);
  return wasFound
    ? pass('actual.budget', `Budget ${syncId.slice(0, 8)}… found on server`)
    : fail('actual.budget',
      `Budget "${syncId}" not found — check syncId in Settings → Advanced`);
}

/**
 * Checks whether the Actual Budget server is reachable via HTTP.
 * @param config - The IImporterConfig containing the server URL.
 * @returns A IValidationResult indicating server reachability.
 */
export async function checkActualServer(config: IImporterConfig): Promise<IValidationResult> {
  const { serverURL } = config.actual.init;
  try {
    const resp = await fetch(serverURL, { signal: AbortSignal.timeout(5000) });
    return resp.status < 500
      ? pass('actual.server', `Actual server reachable: ${serverURL} (${String(resp.status)})`)
      : fail('actual.server', `Actual server error ${String(resp.status)}: ${serverURL}`);
  } catch (e) {
    return fail('actual.server', `Cannot reach Actual server: ${errorMessage(e)}`);
  }
}

/**
 * Verifies that the configured budget exists on the Actual Budget server.
 * @param config - The IImporterConfig with server credentials and budget syncId.
 * @returns A IValidationResult indicating whether the budget was found.
 */
export async function checkActualBudget(config: IImporterConfig): Promise<IValidationResult> {
  const { serverURL, password } = config.actual.init;
  const { syncId } = config.actual.budget;
  try {
    const token = await loginToActualServer(serverURL, password);
    if (!token) return fail('actual.budget', 'Cannot verify budget — login failed');
    return await findBudgetOnServer(serverURL, token, syncId);
  } catch (e: unknown) {
    return fail('actual.budget', `Cannot verify budget: ${errorMessage(e)}`);
  }
}

/**
 * Verifies the Telegram bot token via the getMe API endpoint.
 * @param tg - The Telegram config containing the bot token to verify.
 * @returns A IValidationResult indicating whether the token is valid.
 */
export async function checkTelegramToken(
  tg: NonNullable<INotificationConfig['telegram']>
): Promise<IValidationResult> {
  try {
    const url = `https://api.telegram.org/bot${tg.botToken}/getMe`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json: unknown = await resp.json();
    const data = json as { ok: boolean; result?: { username?: string } };
    return data.ok
      ? pass('telegram.token', `Telegram bot valid (@${data.result?.username ?? '?'})`)
      : fail('telegram.token', 'Invalid Telegram bot token');
  } catch (e) {
    return fail('telegram.token', `Telegram check failed: ${errorMessage(e)}`);
  }
}

/**
 * Checks whether the webhook URL responds to an HTTP HEAD request.
 * @param url - The webhook URL to probe.
 * @returns A IValidationResult indicating webhook reachability.
 */
export async function checkWebhookUrl(url: string): Promise<IValidationResult> {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return resp.ok
      ? pass('webhook.url', `Webhook reachable (${String(resp.status)})`)
      : warn('webhook.url', `Webhook returned ${String(resp.status)} — may not accept HEAD`);
  } catch (e) {
    return fail('webhook.url', `Cannot reach webhook: ${errorMessage(e)}`);
  }
}
