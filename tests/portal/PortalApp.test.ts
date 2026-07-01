// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── Paths + fixtures (real SPA shell + the real generated schema) ── */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(HERE, '../../src/Portal/Public/app.js');
const INDEX_PATH = join(HERE, '../../src/Portal/Public/index.html');
const SCHEMA_PATH = join(HERE, '../../config/portal/config.schema.json');

const PARSED_INDEX = new DOMParser().parseFromString(readFileSync(INDEX_PATH, 'utf8'), 'text/html');
PARSED_INDEX.querySelectorAll('script').forEach((node) => {
  node.remove();
});
const BODY_HTML = PARSED_INDEX.body.innerHTML;

// The app.js under test imports the real vendored jedison, which renders plain
// DOM under jsdom — so the tests drive and assert on the true jedi- markup the
// schema produces (no library mock), giving realistic coverage of the render,
// secret-reveal, conditional-visibility, add/remove-bank and save wiring.
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, unknown>;
const MASK = '********';

/* ── Types ──────────────────────────────────────────────────────────── */

interface ValidationResult {
  status: 'pass' | 'fail' | 'warn';
  check: string;
  message: string;
}

interface PortalState {
  statusOk: boolean;
  status: Record<string, unknown>;
  schemaOk: boolean;
  config: Record<string, unknown>;
  loginOk: boolean;
  saveOk: boolean;
  saveStatus: number;
  saveErrorless: boolean;
  validateOk: boolean;
  validateResults: ValidationResult[] | null;
  logoutOk: boolean;
  schemaBody?: Record<string, unknown>;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

interface FetchInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * Builds a masked config whose shape matches the generated schema, with secrets
 * pre-masked as ******** exactly like GET /api/config returns them.
 * @returns A fresh config fixture.
 */
function makeConfig(): Record<string, unknown> {
  return {
    delayBetweenBanks: 0,
    actual: {
      init: { serverURL: 'https://actual.example', password: MASK, dataDir: '/data' },
      budget: { syncId: 'uuid-1', password: MASK },
    },
    banks: {
      hapoalim: {
        daysBack: 14,
        username: MASK,
        password: MASK,
        twoFactorAuth: false,
        targets: [{ actualAccountId: 'acct-1', accounts: 'all', reconcile: false }],
      },
      leumi: { userCode: MASK, password: MASK, daysBack: 30 },
    },
    notifications: {
      enabled: true,
      maxTransactions: 5,
      telegram: { botToken: MASK, chatId: '123', messageFormat: 'summary', showTransactions: 'new' },
      webhook: { url: MASK, format: 'slack' },
    },
    spendingWatch: [{ alertFromAmount: 100, numOfDayToCount: 7, watchPayees: ['coffee'] }],
    categorization: { mode: 'history', translations: [] },
    logConfig: { format: 'words', logDir: './logs' },
    proxy: { server: '' },
    portal: {
      enabled: true,
      host: '127.0.0.1',
      port: 8080,
      authMode: 'password',
      secureCookies: false,
      passwordHash: MASK,
      sessionSecret: MASK,
      google: { clientId: 'cid', clientSecret: MASK, redirectUri: 'https://cb', allowedEmails: ['a@b.co'] },
    },
  };
}

/* ── Harness state ──────────────────────────────────────────────────── */

/**
 * Deep-clones the generated schema so a test can mutate an edge-case variant
 * (missing title, banks without options, etc.) without affecting other tests.
 * @returns A structural copy of the schema.
 */
function cloneSchema(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SCHEMA)) as Record<string, unknown>;
}


let state: PortalState;
let fetchMock: Mock;
let reloadSpy: Mock;
let mediaChange: ((event: { matches: boolean }) => void) | undefined;

/**
 * Produces a Response-like object the SPA's api() helper understands.
 * @param status - HTTP status code.
 * @param body - Parsed JSON body to resolve.
 * @returns A fake response.
 */
function makeResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: (): Promise<unknown> => Promise.resolve(body),
  };
}

/**
 * Routes a portal request to a canned response based on the harness state.
 * @param path - Request path.
 * @param method - HTTP method.
 * @returns The fake response for the route.
 */
function route(path: string, method: string): FakeResponse {
  if (path === '/auth/status') return state.statusOk ? makeResponse(200, state.status) : makeResponse(503, { error: 'status' });
  if (path === '/api/schema') return state.schemaOk ? makeResponse(200, state.schemaBody ?? SCHEMA) : makeResponse(500, { error: 'schema' });
  if (path === '/api/config' && method === 'PUT') return state.saveOk ? makeResponse(204, {}) : makeResponse(state.saveStatus, state.saveErrorless ? {} : { error: 'Disk full' });
  if (path === '/api/config') return makeResponse(200, state.config);
  if (path === '/api/validate') return state.validateOk ? makeResponse(200, state.validateResults) : makeResponse(500, { error: 'validate down' });
  if (path === '/auth/login') return state.loginOk ? makeResponse(200, { ok: true }) : makeResponse(401, { error: 'Invalid portal password' });
  if (path === '/auth/logout') return state.logoutOk ? makeResponse(204, {}) : makeResponse(500, { error: 'logout failed' });
  return makeResponse(404, { error: 'not found' });
}

/**
 * Resets harness state and installs the DOM, fetch, matchMedia, scrollIntoView
 * and location stubs the SPA touches at import time.
 * @returns Nothing.
 */
function installHarness(): void {
  state = {
    statusOk: true,
    status: { authorized: true, authMode: 'password', google: false, password: true, email: '' },
    schemaOk: true,
    config: makeConfig(),
    loginOk: true,
    saveOk: true,
    saveStatus: 500,
    saveErrorless: false,
    validateOk: true,
    validateResults: [],
    logoutOk: true,
  };
  document.body.innerHTML = BODY_HTML;
  mediaChange = undefined;
  reloadSpy = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: reloadSpy, href: 'http://localhost/', assign: vi.fn(), replace: vi.fn() },
  });
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (event: { matches: boolean }) => void): void => { mediaChange = cb; },
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  fetchMock = vi.fn((input: string, init: FetchInit = {}) => Promise.resolve(route(String(input), init.method ?? 'GET')));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

/* ── Async + DOM helpers ────────────────────────────────────────────── */

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Imports the SPA (runs its top-level wiring + init) and waits for the boot
 * fetch chain to settle so the initial render or login view is in place.
 * @returns Resolves once boot completes.
 */
async function boot(): Promise<void> {
  await import(APP_PATH);
  await settle();
  await settle();
}

/**
 * Switches the harness to an unauthorized status with the given overrides.
 * @param patch - Status fields to merge onto an unauthorized base.
 * @returns Nothing.
 */
function unauth(patch: Record<string, unknown>): void {
  state.statusOk = true;
  state.status = { authorized: false, ...patch };
}

/**
 * Resolves an element by id, failing loudly when it is missing.
 * @param id - Element id.
 * @returns The element.
 */
function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} not found`);
  return node;
}

const inputId = (id: string): HTMLInputElement => byId(id) as HTMLInputElement;
const clickId = (id: string): void => { byId(id).click(); };
const maybe = (selector: string): HTMLElement | null => document.querySelector(selector) as HTMLElement | null;

/**
 * Resolves a jedison editor container by its instance path (e.g. '#/banks/leumi').
 * @param path - The jedison instance path.
 * @returns The container element, or null when absent.
 */
function jedi(path: string): HTMLElement | null {
  return document.querySelector(`#view [data-path="${path}"]`) as HTMLElement | null;
}

/**
 * Sets a jedison-rendered control's value and dispatches the change event the
 * library listens for (showErrors defaults to 'change').
 * @param id - The control element id (jedison derives it from the path).
 * @param value - The value to set.
 * @returns Nothing.
 */
function setControl(id: string, value: string): void {
  const node = inputId(id);
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Sets a plain (non-jedison) input's value without dispatching events.
 * @param id - Element id.
 * @param value - Value to set.
 * @returns Nothing.
 */
function setValue(id: string, value: string): void {
  inputId(id).value = value;
}

/**
 * Reads the most recent PUT /api/config body the SPA submitted.
 * @returns The parsed config payload.
 */
function putBody(): Record<string, unknown> {
  const calls = fetchMock.mock.calls as Array<[string, FetchInit | undefined]>;
  const put = [...calls].reverse().find((call) => call[0] === '/api/config' && call[1]?.method === 'PUT');
  if (!put?.[1]?.body) throw new Error('no PUT /api/config body captured');
  return JSON.parse(put[1].body) as Record<string, unknown>;
}

/**
 * Reports whether the SPA requested the given path (optionally by method).
 * @param path - Request path to look for.
 * @param method - Optional HTTP method to match.
 * @returns True when a matching request was made.
 */
function called(path: string, method?: string): boolean {
  const calls = fetchMock.mock.calls as Array<[string, FetchInit | undefined]>;
  return calls.some((c) => c[0] === path && (method ? c[1]?.method === method : true));
}

/**
 * Runs a click action under fake timers so any toast lifecycle fully drains.
 * @param id - Id of the button to click.
 * @returns Resolves once queued timers complete.
 */
async function clickWithTimers(id: string): Promise<void> {
  vi.useFakeTimers();
  clickId(id);
  await vi.advanceTimersByTimeAsync(100);
  vi.useRealTimers();
}

beforeEach(() => {
  vi.resetModules();
  installHarness();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── Tests ──────────────────────────────────────────────────────────── */

describe('PortalApp bootstrap and authentication', () => {
  it('renders the jedison form when already authorized', async () => {
    await boot();
    expect(byId('app').classList.contains('hidden')).toBe(false);
    expect(byId('login').classList.contains('hidden')).toBe(true);
    expect(byId('title').textContent).toBe('Israeli Bank Importer Config');
    expect(byId('subtitle').textContent).toBe('2 banks configured');
    expect(maybe('#view [data-path="#"]')).not.toBeNull();
  });

  it('fetches the schema and config and seeds jedison with the masked data', async () => {
    await boot();
    expect(called('/api/schema')).toBe(true);
    expect(called('/api/config')).toBe(true);
    expect(inputId('root-actual-init-password').value).toBe(MASK);
    expect(inputId('root-actual-init-password').type).toBe('password');
  });

  it('moves focus to the title heading after login', async () => {
    await boot();
    const title = byId('title');
    expect(title.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(title);
  });

  it('shows the password step when unauthorized in password mode', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    expect(byId('login').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(false);
    expect(byId('google-btn').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('Sign in to manage your importer configuration.');
  });

  it('shows the google step when unauthorized in google mode', async () => {
    unauth({ authMode: 'google', google: false });
    await boot();
    expect(byId('google-btn').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('Sign in with Google to manage your configuration.');
  });

  it('acknowledges a satisfied google factor in both mode', async () => {
    unauth({ authMode: 'both', google: true, password: false, email: 'me@x.co' });
    await boot();
    expect(byId('login-hint').textContent).toBe('✓ Signed in as me@x.co. Now enter the portal password.');
  });

  it('guides both mode when only the password is satisfied', async () => {
    unauth({ authMode: 'both', google: false, password: true });
    await boot();
    expect(byId('login-hint').textContent).toBe('✓ Password accepted. Now sign in with Google.');
  });

  it('prompts both factors when neither is satisfied in both mode', async () => {
    unauth({ authMode: 'both', google: false, password: false });
    await boot();
    expect(byId('login-hint').textContent).toBe('Sign in with Google, then enter the portal password.');
  });

  it('falls back to the password step when the status probe fails', async () => {
    state.statusOk = false;
    await boot();
    expect(byId('login').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(false);
  });

  it('shows a recoverable load error when the schema cannot be fetched', async () => {
    state.schemaOk = false;
    await boot();
    expect(byId('login').classList.contains('hidden')).toBe(false);
    expect(byId('reload-btn').classList.contains('hidden')).toBe(false);
    expect(byId('login-err').textContent).toContain('Could not load configuration');
  });
});

describe('PortalApp login submission', () => {
  it('opens the app after a correct password', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    state.status = { authorized: true, authMode: 'password' };
    setValue('pw', 'hunter2');
    clickId('pw-btn');
    await settle();
    await settle();
    expect(called('/auth/login', 'POST')).toBe(true);
    expect(byId('app').classList.contains('hidden')).toBe(false);
  });

  it('shows an error and stays on login after a wrong password', async () => {
    unauth({ authMode: 'password', password: false });
    state.loginOk = false;
    await boot();
    setValue('pw', 'nope');
    clickId('pw-btn');
    await settle();
    expect(byId('login-err').textContent).toBe('Invalid portal password');
    expect(byId('app').classList.contains('hidden')).toBe(true);
  });

  it('submits the password when Enter is pressed', async () => {
    unauth({ authMode: 'password', password: false });
    state.status = { authorized: true, authMode: 'password' };
    await boot();
    setValue('pw', 'hunter2');
    byId('pw').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    await settle();
    expect(called('/auth/login', 'POST')).toBe(true);
  });

  it('ignores a submit while the button is already busy', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    inputId('pw-btn').disabled = true;
    byId('pw').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(called('/auth/login', 'POST')).toBe(false);
  });
});

describe('PortalApp secret reveal toggles', () => {
  it('wraps every secret input and reveals then re-masks on toggle', async () => {
    await boot();
    const input = inputId('root-actual-init-password');
    const wrap = input.parentElement as HTMLElement;
    expect(wrap.classList.contains('secret-wrap')).toBe(true);
    const eye = wrap.querySelector('.reveal') as HTMLButtonElement;
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    eye.click();
    expect(input.type).toBe('text');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(eye.getAttribute('aria-label')).toBe('Hide secret');
    eye.click();
    expect(input.type).toBe('password');
    expect(eye.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('PortalApp conditional visibility (x-show-when)', () => {
  it('hides the google subtree in password mode and reveals it in both mode', async () => {
    await boot();
    expect((jedi('#/portal/google') as HTMLElement).style.display).toBe('none');
    setControl('root-portal-authMode', 'both');
    expect((jedi('#/portal/google') as HTMLElement).style.display).toBe('');
    setControl('root-portal-authMode', 'password');
    expect((jedi('#/portal/google') as HTMLElement).style.display).toBe('none');
  });
});

describe('PortalApp navigation', () => {
  it('builds a jump link per top-level section', async () => {
    await boot();
    const links = document.querySelectorAll('#nav [data-section]');
    expect(links.length).toBe(Object.keys(SCHEMA.properties as object).length);
  });

  it('scrolls the target section into view on click', async () => {
    await boot();
    const btn = byId('nav').querySelector('[data-section="banks"]') as HTMLElement;
    btn.click();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});

describe('PortalApp bank tools', () => {
  it('offers only banks that are not already configured', async () => {
    await boot();
    const opts = [...document.querySelectorAll('#add-bank-select option')].map((o) => (o as HTMLOptionElement).value);
    expect(opts).not.toContain('hapoalim');
    expect(opts).not.toContain('leumi');
    expect(opts).toContain('discount');
    expect([...document.querySelectorAll('[data-remove-bank]')].map((n) => (n as HTMLElement).dataset.removeBank)).toEqual(['hapoalim', 'leumi']);
  });

  it('adds a constrained bank and persists it on save', async () => {
    await boot();
    inputId('add-bank-select').value = 'discount';
    clickId('add-bank-btn');
    await settle();
    expect(jedi('#/banks/discount')).not.toBeNull();
    expect([...document.querySelectorAll('#add-bank-select option')].map((o) => (o as HTMLOptionElement).value)).not.toContain('discount');
    expect(byId('subtitle').textContent).toBe('3 banks configured');
    await clickWithTimers('save');
    expect(putBody().banks).toHaveProperty('discount');
  });

  it('ignores the add button when no bank is selected', async () => {
    await boot();
    inputId('add-bank-select').value = '';
    clickId('add-bank-btn');
    await settle();
    expect(byId('subtitle').textContent).toBe('2 banks configured');
  });

  it('removes a bank and persists the removal on save', async () => {
    await boot();
    (byId('bank-tools').querySelector('[data-remove-bank="hapoalim"]') as HTMLElement).click();
    await settle();
    expect(jedi('#/banks/hapoalim')).toBeNull();
    expect(byId('subtitle').textContent).toBe('1 bank configured');
    await clickWithTimers('save');
    expect(putBody().banks).not.toHaveProperty('hapoalim');
  });
});

describe('PortalApp save', () => {
  it('round-trips an untouched secret as the mask', async () => {
    await boot();
    await clickWithTimers('save');
    const actual = putBody().actual as { init: { password: string } };
    expect(actual.init.password).toBe(MASK);
    expect(byId('status').textContent).toBe('✅ Saved');
    expect(byId('status').className).toContain('ok');
  });

  it('sends a freshly typed secret verbatim', async () => {
    await boot();
    setControl('root-actual-init-password', 'brand-new-secret');
    await clickWithTimers('save');
    const actual = putBody().actual as { init: { password: string } };
    expect(actual.init.password).toBe('brand-new-secret');
  });

  it('surfaces a save failure in the status line and a toast', async () => {
    await boot();
    state.saveOk = false;
    await clickWithTimers('save');
    expect(byId('status').textContent).toBe('❌ Disk full');
    expect(byId('status').className).toContain('err');
    expect(maybe('#toast .toast.err')).not.toBeNull();
  });
});

describe('PortalApp validate', () => {
  it('reports a valid configuration', async () => {
    await boot();
    state.validateResults = [{ status: 'pass', check: 'schema', message: 'ok' }];
    await clickWithTimers('validate-btn');
    expect(byId('status').textContent).toBe('✅ Configuration valid');
    expect(called('/api/validate', 'POST')).toBe(true);
  });

  it('reports the first failing check', async () => {
    await boot();
    state.validateResults = [{ status: 'fail', check: 'portal', message: 'Bad host' }];
    await clickWithTimers('validate-btn');
    expect(byId('status').textContent).toBe('❌ 1 problem: Bad host');
    expect(byId('status').className).toContain('err');
  });

  it('surfaces a validate request failure', async () => {
    await boot();
    state.validateOk = false;
    await clickWithTimers('validate-btn');
    expect(byId('status').className).toContain('err');
    expect(maybe('#toast .toast.err')).not.toBeNull();
  });
});

describe('PortalApp logout, reload and drawer wiring', () => {
  it('logs out then reloads the page', async () => {
    await boot();
    clickId('logout');
    await settle();
    expect(called('/auth/logout', 'POST')).toBe(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads even when the logout request fails', async () => {
    state.logoutOk = false;
    await boot();
    clickId('logout');
    await settle();
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads from the load-error reload button', async () => {
    state.schemaOk = false;
    await boot();
    clickId('reload-btn');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('opens and closes the mobile drawer', async () => {
    await boot();
    clickId('menu');
    expect(byId('app').classList.contains('nav-open')).toBe(true);
    clickId('scrim');
    expect(byId('app').classList.contains('nav-open')).toBe(false);
  });

  it('closes the drawer on Escape', async () => {
    await boot();
    clickId('menu');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(byId('app').classList.contains('nav-open')).toBe(false);
  });

  it('closes the drawer when the viewport grows to desktop', async () => {
    await boot();
    clickId('menu');
    expect(byId('app').classList.contains('nav-open')).toBe(true);
    mediaChange?.({ matches: true });
    expect(byId('app').classList.contains('nav-open')).toBe(false);
  });
});

describe('PortalApp edge-case coverage', () => {
  it('defaults the login step to password when the status omits authMode', async () => {
    unauth({ password: false, google: false });
    await boot();
    expect(byId('pw').classList.contains('hidden')).toBe(false);
    expect(byId('login-hint').textContent).toBe('Sign in to manage your importer configuration.');
  });

  it('acknowledges a satisfied google factor without an email in both mode', async () => {
    unauth({ authMode: 'both', google: true, password: false, email: '' });
    await boot();
    expect(byId('login-hint').textContent).toBe('✓ Signed in. Now enter the portal password.');
  });

  it('shows the google step alone when google is already satisfied', async () => {
    unauth({ authMode: 'google', google: true });
    await boot();
    expect(byId('pw').classList.contains('hidden')).toBe(true);
    expect(byId('google-btn').classList.contains('hidden')).toBe(true);
  });

  it('falls back to a generic title when the schema has none', async () => {
    const stripped = cloneSchema();
    delete stripped.title;
    state.schemaBody = stripped;
    await boot();
    expect(byId('title').textContent).toBe('Configuration');
  });

  it('reports an HTTP status when a save failure omits an error body', async () => {
    await boot();
    state.saveOk = false;
    state.saveErrorless = true;
    await clickWithTimers('save');
    expect(byId('status').textContent).toBe('❌ HTTP 500');
  });

  it('treats a null validation response as valid', async () => {
    await boot();
    state.validateResults = null;
    await clickWithTimers('validate-btn');
    expect(byId('status').textContent).toBe('✅ Configuration valid');
  });

  it('pluralises the problem count when several checks fail', async () => {
    await boot();
    state.validateResults = [
      { status: 'fail', check: 'a', message: 'First problem' },
      { status: 'fail', check: 'b', message: 'Second problem' },
    ];
    await clickWithTimers('validate-btn');
    expect(byId('status').textContent).toBe('❌ 2 problems: First problem');
  });

  it('ignores a second open while the drawer is already open', async () => {
    await boot();
    clickId('menu');
    clickId('menu');
    expect(byId('app').classList.contains('nav-open')).toBe(true);
  });

  it('does not submit the login on a non-Enter key', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    byId('pw').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await settle();
    expect(called('/auth/login', 'POST')).toBe(false);
  });

  it('keeps the drawer untouched when the viewport stays narrow', async () => {
    await boot();
    clickId('menu');
    mediaChange?.({ matches: false });
    expect(byId('app').classList.contains('nav-open')).toBe(true);
  });

  it('skips scrolling when the target section is not rendered', async () => {
    await boot();
    (jedi('#/proxy') as HTMLElement).remove();
    (byId('nav').querySelector('[data-section="proxy"]') as HTMLElement).click();
    expect(byId('app').classList.contains('nav-open')).toBe(false);
  });

  it('opens the drawer even when the nav has no focusable link', async () => {
    await boot();
    byId('nav').innerHTML = '';
    clickId('menu');
    expect(byId('app').classList.contains('nav-open')).toBe(true);
  });

  it('offers no add options when the banks schema lacks bank options', async () => {
    const stripped = cloneSchema();
    const props = stripped.properties as Record<string, Record<string, unknown>>;
    delete props.banks['x-bank-options'];
    state.schemaBody = stripped;
    await boot();
    expect(document.querySelectorAll('#add-bank-select option').length).toBe(1);
  });

  it('renders no bank tools when the schema has no banks section', async () => {
    const stripped = cloneSchema();
    delete (stripped.properties as Record<string, unknown>).banks;
    state.schemaBody = stripped;
    await boot();
    expect(maybe('#add-bank-select')).toBeNull();
    expect(byId('subtitle').textContent).toBe('0 banks configured');
  });
});

describe('PortalApp SPA shell module contract', () => {
  // app.js boots with a top-level `await init()`, valid only when the browser
  // loads it as an ES module. Lock the runtime contract so a revert of the
  // script tag to a classic <script> is caught — SonarCloud S7785.
  it('loads /app.js as an ES module', () => {
    const shell = new DOMParser().parseFromString(readFileSync(INDEX_PATH, 'utf8'), 'text/html');
    const appScript = shell.querySelector('script[src="/app.js"]');
    expect(appScript).not.toBeNull();
    expect(appScript?.getAttribute('type')).toBe('module');
  });

  // Every shell <button> sits outside a <form>; pin each to type="button" so a
  // stray future <form> wrapper can never turn a click into a navigation.
  it('declares every shell button as type="button"', () => {
    const shell = new DOMParser().parseFromString(readFileSync(INDEX_PATH, 'utf8'), 'text/html');
    const buttons = [...shell.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.getAttribute('type') === 'button')).toBe(true);
  });
});
