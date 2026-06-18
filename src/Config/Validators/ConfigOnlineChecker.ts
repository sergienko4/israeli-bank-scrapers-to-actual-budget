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
 * Performs a `fetch` with the shared 5-second abort timeout applied.
 * @param url - The request URL.
 * @param init - Optional fetch init; its `signal` is overridden with the timeout.
 * @returns The fetch Response promise.
 */
function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
}

/**
 * Authenticates with the Actual Budget server and returns a session token.
 * @param serverURL - The Actual server base URL.
 * @param password - The Actual server password.
 * @returns The session token string, or empty string if login failed.
 */
async function loginToActualServer(serverURL: string, password: string): Promise<string> {
  const resp = await fetchWithTimeout(`${serverURL}/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await resp.json() as { data?: { token?: string } };
  return data.data?.token ?? '';
}

/**
 * Fetches the server's user-file list.
 * @param serverURL - The Actual server base URL.
 * @param token - Authenticated session token.
 * @returns The parsed list-user-files payload.
 */
async function listUserFiles(
  serverURL: string, token: string
): Promise<{ data?: { groupId?: string }[] }> {
  const resp = await fetchWithTimeout(`${serverURL}/sync/list-user-files`, {
    method: 'POST',
    headers: { 'X-ACTUAL-TOKEN': token, 'Content-Type': 'application/json' },
  });
  return await resp.json() as { data?: { groupId?: string }[] };
}

/**
 * Builds the budget-presence result from the lookup outcome.
 * @param found - Whether the budget syncId was present on the server.
 * @param syncId - The budget sync ID that was looked up.
 * @returns A pass result if found, fail if not found.
 */
function budgetFoundResult(found: boolean, syncId: string): IValidationResult {
  return found
    ? pass('actual.budget', `Budget ${syncId.slice(0, 8)}… found on server`)
    : fail('actual.budget',
      `Budget "${syncId}" not found — check syncId in Settings → Advanced`);
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
  const data = await listUserFiles(serverURL, token);
  const wasFound = (data.data ?? []).some(f => f.groupId === syncId);
  return budgetFoundResult(wasFound, syncId);
}

/**
 * Builds the server-reachability result from the response status.
 * @param serverURL - The server URL used in messages.
 * @param status - The HTTP status code from the reachability probe.
 * @returns A pass result when status < 500, else fail.
 */
function serverReachableResult(serverURL: string, status: number): IValidationResult {
  return status < 500
    ? pass('actual.server', `Actual server reachable: ${serverURL} (${String(status)})`)
    : fail('actual.server', `Actual server error ${String(status)}: ${serverURL}`);
}

/**
 * Checks whether the Actual Budget server is reachable via HTTP.
 * @param config - The IImporterConfig containing the server URL.
 * @returns A IValidationResult indicating server reachability.
 */
export async function checkActualServer(config: IImporterConfig): Promise<IValidationResult> {
  const { serverURL } = config.actual.init;
  try {
    const resp = await fetchWithTimeout(serverURL);
    return serverReachableResult(serverURL, resp.status);
  } catch (e: unknown) {
    return fail('actual.server', `Cannot reach Actual server: ${errorMessage(e)}`);
  }
}

/**
 * Logs in and looks up the configured budget, without error handling.
 * @param config - The IImporterConfig with server credentials and budget syncId.
 * @returns A IValidationResult indicating whether the budget was found.
 */
async function verifyBudget(config: IImporterConfig): Promise<IValidationResult> {
  const { serverURL, password } = config.actual.init;
  const { syncId } = config.actual.budget;
  const token = await loginToActualServer(serverURL, password);
  if (!token) return fail('actual.budget', 'Cannot verify budget — login failed');
  return await findBudgetOnServer(serverURL, token, syncId);
}

/**
 * Verifies that the configured budget exists on the Actual Budget server.
 * @param config - The IImporterConfig with server credentials and budget syncId.
 * @returns A IValidationResult indicating whether the budget was found.
 */
export async function checkActualBudget(config: IImporterConfig): Promise<IValidationResult> {
  try {
    return await verifyBudget(config);
  } catch (e: unknown) {
    return fail('actual.budget', `Cannot verify budget: ${errorMessage(e)}`);
  }
}

interface ITelegramMe {
  ok: boolean;
  result?: { username?: string };
}

/**
 * Calls the Telegram getMe endpoint and returns the parsed payload.
 * @param botToken - The Telegram bot token to verify.
 * @returns The parsed getMe response.
 */
async function fetchTelegramMe(botToken: string): Promise<ITelegramMe> {
  const url = `https://api.telegram.org/bot${botToken}/getMe`;
  const resp = await fetchWithTimeout(url);
  return await resp.json() as ITelegramMe;
}

/**
 * Builds the token-validity result from the getMe payload.
 * @param data - The parsed getMe response.
 * @returns A pass result when the token is valid, else fail.
 */
function telegramTokenResult(data: ITelegramMe): IValidationResult {
  return data.ok
    ? pass('telegram.token', `Telegram bot valid (@${data.result?.username ?? '?'})`)
    : fail('telegram.token', 'Invalid Telegram bot token');
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
    const data = await fetchTelegramMe(tg.botToken);
    return telegramTokenResult(data);
  } catch (e: unknown) {
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
  } catch (e: unknown) {
    return fail('webhook.url', `Cannot reach webhook: ${errorMessage(e)}`);
  }
}
