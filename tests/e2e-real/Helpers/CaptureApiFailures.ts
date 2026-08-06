/**
 * Diagnostic probe used by the real-bank E2E suites.
 *
 * Deliberately narrow: the provider already photographs a failed session for
 * us via `storeFailureScreenShotPath`, so this adds only what the provider
 * does not expose — the full body of a failed API reply (the bundle previews
 * roughly the first thirty characters), the request headers behind it, and
 * the browser-side errors that explain why a bank SPA failed to boot.
 */

import type {
  ConsoleMessage, Frame, Page, Request, Response,
} from 'playwright-core';

const OK_FLOOR = 200;
const OK_CEILING = 300;

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
 * Prints a failed API response with its complete body and request context.
 * @param response - Playwright response that failed.
 * @returns Nothing once the failure has been reported.
 */
async function dumpFailure(response: Response): Promise<void> {
  const body = await response.text().catch(() => '<unreadable>');
  console.warn(`[api-failure] ${response.status()} ${response.url()}\n${body}`);
  const request = response.request();
  const headers = await request.allHeaders();
  console.warn(`[api-failure] request.body=${request.postData() ?? ''}`);
  console.warn(`[api-failure] authorization=${headers.authorization ?? '<none>'}`);
  console.warn(`[api-failure] x-site-id=${headers['x-site-id'] ?? '<none>'}`);
  console.warn(`[api-failure] referer=${headers.referer ?? '<none>'}`);
}

/**
 * Logs every main-frame navigation so the post-login landing page is visible.
 * @param page - Page being observed.
 * @returns Nothing once the listener is attached.
 */
function trackNavigation(page: Page): void {
  page.on('framenavigated', (frame: Frame) => {
    if (frame === page.mainFrame()) console.warn(`[nav] ${frame.url()}`);
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
    console.warn(`[reqfail] ${request.url()} :: ${failure?.errorText ?? ''}`);
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
    console.warn(`[api] ${response.status()} ${method} ${response.url()}`);
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
