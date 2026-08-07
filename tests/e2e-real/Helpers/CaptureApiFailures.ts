/**
 * Diagnostic probe used by the real-bank E2E suites.
 *
 * Deliberately narrow: the provider already photographs a failed session for
 * us via `storeFailureScreenShotPath`, so this adds only what the provider
 * does not expose — which API calls the bank SPA made, how each answered, and
 * the browser-side errors that explain why a bank SPA failed to boot.
 *
 * Everything logged here is allowlisted metadata. Response bodies, request
 * payloads, header values and query strings are never printed: this runs
 * against a real account, so a body can carry balances and transactions and a
 * header can carry a live bearer token. The shape of a reply — its status,
 * content type and size — is what diagnoses a broken bank deploy anyway. That
 * is exactly how CAL's fault was identified: an HTML document served where the
 * page expected JavaScript.
 */

import type {
  ConsoleMessage, Frame, Page, Request, Response,
} from 'playwright-core';

const OK_FLOOR = 200;
const OK_CEILING = 300;

/** Request headers whose presence is reported, never their value. */
const WATCHED_HEADERS = ['authorization', 'x-site-id', 'referer'] as const;

/**
 * Decides whether a response is an API failure worth dumping.
 * @param response - Playwright response under inspection.
 * @returns True when the status falls outside the 2xx range.
 */
function isFailure(response: Response): boolean {
  const status = response.status();
  return status < OK_FLOOR || status >= OK_CEILING;
}

/**
 * Strips a URL down to origin and path, discarding query and fragment.
 *
 * Bank URLs routinely carry tokens and account identifiers in the query
 * string, and none of that is needed to tell which endpoint answered.
 * @param raw - Absolute URL as reported by the browser.
 * @returns Origin and pathname, or a placeholder when the URL will not parse.
 */
function safeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '<unparseable-url>';
  }
}

/**
 * Reports which watched headers were sent, without revealing their values.
 * @param headers - Request headers collected from the browser.
 * @returns Space-separated `name=present|absent` pairs.
 */
function describeHeaders(headers: Record<string, string>): string {
  return WATCHED_HEADERS
    .map(name => `${name}=${headers[name] === undefined ? 'absent' : 'present'}`)
    .join(' ');
}

/**
 * Summarises a response body by type and size rather than by content.
 * @param response - Playwright response that failed.
 * @returns Content type and byte length, or a note when the body is unreadable.
 */
async function describeBody(response: Response): Promise<string> {
  const body = await response.text().catch(() => null);
  if (body === null) return 'body=<unreadable>';
  const type = response.headers()['content-type'] ?? 'unknown';
  return `content-type=${type} body-bytes=${String(body.length)}`;
}

/**
 * Prints a failed API response as allowlisted metadata only.
 * @param response - Playwright response that failed.
 * @returns Nothing once the failure has been reported.
 */
async function dumpFailure(response: Response): Promise<void> {
  const request = response.request();
  const shape = await describeBody(response);
  const headers = await request.allHeaders();
  console.warn(
    `[api-failure] ${String(response.status())} ${request.method()} `
    + `${safeUrl(response.url())} ${shape} ${describeHeaders(headers)}`,
  );
}

/**
 * Logs every main-frame navigation so the post-login landing page is visible.
 * @param page - Page being observed.
 * @returns Nothing once the listener is attached.
 */
function trackNavigation(page: Page): void {
  page.on('framenavigated', (frame: Frame) => {
    if (frame === page.mainFrame()) console.warn(`[nav] ${safeUrl(frame.url())}`);
  });
}

/**
 * Logs browser-side failures, which is what stops a bank SPA booting.
 * @param page - Page being observed.
 * @returns Nothing once the listeners are attached.
 */
function trackScriptFailures(page: Page): void {
  page.on('pageerror', (error: Error) => {
    console.warn(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request: Request) => {
    const failure = request.failure();
    console.warn(`[reqfail] ${safeUrl(request.url())} :: ${failure?.errorText ?? ''}`);
  });
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') console.warn(`[console] ${message.text()}`);
  });
}

/**
 * Reports whether a response came from an application API call.
 * @param response - Playwright response under inspection.
 * @returns True for XHR and fetch traffic, false for documents and assets.
 */
function isApiCall(response: Response): boolean {
  const type = response.request().resourceType();
  return type === 'xhr' || type === 'fetch';
}

/**
 * Logs every API call the page makes, successful or not.
 *
 * The provider discovers its auth headers by watching this traffic, so seeing
 * which calls the bank SPA actually made — and which of them succeeded — is
 * what explains a later rejection of a request the provider replayed.
 * @param page - Page being observed.
 * @returns Nothing once the listener is attached.
 */
function trackApiCalls(page: Page): void {
  page.on('response', (response: Response) => {
    if (!isApiCall(response)) return;
    const method = response.request().method();
    console.warn(`[api] ${String(response.status())} ${method} ${safeUrl(response.url())}`);
  });
}

/**
 * Builds a preparePage hook that reports failed API calls and browser errors.
 * @returns preparePage callback suitable for ScraperOptions.
 */
export default function captureApiFailures(): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    page.on('response', (response: Response) => {
      if (isFailure(response)) void dumpFailure(response);
    });
    trackApiCalls(page);
    trackNavigation(page);
    trackScriptFailures(page);
    await Promise.resolve();
  };
}
