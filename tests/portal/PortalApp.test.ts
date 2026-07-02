// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeBankTarget } from '../helpers/factories.js';

/* ── Paths + index.html body (kept in sync with the real SPA shell) ── */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_PATH = join(HERE, '../../src/Portal/Public/app.js');
const INDEX_PATH = join(HERE, '../../src/Portal/Public/index.html');

const PARSED_INDEX = new DOMParser().parseFromString(readFileSync(INDEX_PATH, 'utf8'), 'text/html');
PARSED_INDEX.querySelectorAll('script').forEach((node) => {
  node.remove();
});
const BODY_HTML = PARSED_INDEX.body.innerHTML;

/* ── Fixture + fetch types ──────────────────────────────────────────── */

interface FieldDef {
  key: string;
  label: string;
  kind: string;
  options?: string[];
  fields?: FieldDef[];
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
  showWhen?: { field: string; in: string[] };
}

interface SectionDef {
  key: string;
  label: string;
  kind: string;
  icon?: string;
  doc?: string;
  help?: string;
  fields?: FieldDef[];
  itemFields?: FieldDef[];
  bankFields?: FieldDef[];
  targetFields?: FieldDef[];
}

interface ManifestDef {
  sections: SectionDef[];
  banks: string[];
  bankRequirements: Record<string, { required: string[] }>;
}

interface FailSpec {
  status: number;
  body: unknown;
  throwJson: boolean;
}

interface PortalState {
  statusOk: boolean;
  status: Record<string, unknown>;
  manifestOk: boolean;
  manifest: ManifestDef;
  config: Record<string, unknown>;
  loginOk: boolean;
  loginFail: FailSpec;
  saveOk: boolean;
  saveFail: FailSpec;
  logoutOk: boolean;
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
 * Builds a rich manifest that exercises every section kind (object, list,
 * bankMap) and every field kind the SPA can render.
 * @returns A fresh manifest fixture.
 */
function makeManifest(): ManifestDef {
  return {
    banks: ['hapoalim', 'leumi', 'discount'],
    bankRequirements: {
      hapoalim: { required: ['username', 'password'] },
      leumi: { required: ['userCode', 'password'] },
      discount: { required: ['daysBack', 'id'] },
    },
    sections: [
      {
        key: 'general',
        label: 'General',
        icon: '⚙️',
        kind: 'object',
        doc: 'GeneralSettings.md',
        help: 'Core importer behavior',
        fields: [
          { key: 'enabled', label: 'Enabled', kind: 'boolean' },
          { key: 'mode', label: 'Run mode', kind: 'select', options: ['fast', 'thorough'] },
          { key: 'apiKey', label: 'API key', kind: 'secret', required: true },
          { key: 'authToken', label: 'Auth token', kind: 'string', required: true, help: 'Required token' },
          { key: 'retries', label: 'Retries', kind: 'number', min: 0, max: 10, help: 'Retry attempts' },
          { key: 'startDate', label: 'Start date', kind: 'date' },
          { key: 'note', label: 'Note', kind: 'string', help: 'Free text' },
          { key: 'deepPath', label: 'Deep scan path', kind: 'string', showWhen: { field: 'mode', in: ['thorough'] } },
          {
            key: 'advanced',
            label: 'Advanced',
            kind: 'group',
            fields: [
              { key: 'timeout', label: 'Timeout', kind: 'number' },
              { key: 'proxy', label: 'Proxy', kind: 'group', fields: [{ key: 'host', label: 'Host', kind: 'string' }] },
            ],
          },
          { key: 'tags', label: 'Tag', kind: 'list', help: 'Plain string list' },
          {
            key: 'rules',
            label: 'Rule',
            kind: 'list',
            fields: [
              { key: 'pattern', label: 'Pattern', kind: 'string' },
              { key: 'active', label: 'Active', kind: 'boolean' },
            ],
          },
        ],
      },
      {
        key: 'watch',
        label: 'Spending watch',
        icon: '👀',
        kind: 'list',
        itemFields: [
          { key: 'label', label: 'Label', kind: 'string' },
          { key: 'limit', label: 'Limit', kind: 'number' },
        ],
      },
      {
        key: 'alerts',
        label: 'Alerts',
        icon: '🔔',
        kind: 'list',
        itemFields: [{ key: 'name', label: 'Name', kind: 'string' }],
      },
      {
        key: 'banks',
        label: 'Banks',
        icon: '🏦',
        kind: 'bankMap',
        doc: 'Banks.md',
        bankFields: [
          { key: 'username', label: 'Username', kind: 'string' },
          { key: 'userCode', label: 'User code', kind: 'string' },
          { key: 'id', label: 'ID', kind: 'string' },
          { key: 'password', label: 'Password', kind: 'secret' },
          { key: 'daysBack', label: 'Days back', kind: 'number' },
          { key: 'twoFactorAuth', label: 'Two-factor auth', kind: 'boolean' },
        ],
        targetFields: [
          { key: 'actualAccountId', label: 'Actual account ID', kind: 'string' },
          { key: 'accounts', label: 'Accounts', kind: 'string' },
          { key: 'reconcile', label: 'Reconcile', kind: 'boolean' },
        ],
      },
      {
        key: 'extras',
        label: 'Extras',
        kind: 'object',
        fields: [
          { key: 'label', label: 'Label', kind: 'string' },
          { key: 'channel', label: 'Channel', kind: 'select', options: ['email', 'sms'] },
          { key: 'token', label: 'Token', kind: 'secret' },
          { key: 'count', label: 'Count', kind: 'number' },
          { key: 'when', label: 'When', kind: 'date' },
          { key: 'flag', label: 'Flag', kind: 'boolean' },
          { key: 'opts', label: 'Options', kind: 'group', fields: [{ key: 'verbose', label: 'Verbose', kind: 'boolean' }] },
          { key: 'extraTags', label: 'Extra tag', kind: 'list' },
        ],
      },
      {
        key: 'about',
        label: 'About',
        kind: 'object',
        doc: 'Overview.md',
      },
      {
        key: '',
        label: 'Root',
        kind: 'object',
        fields: [{ key: 'rootField', label: 'Root field', kind: 'string' }],
      },
    ],
  };
}

/**
 * Builds a config whose shape matches {@link makeManifest}, with stored values
 * for the general/watch/banks sections (extras/alerts/root are intentionally
 * absent to exercise the SPA's lazy create-on-render branches).
 *
 * The per-bank field sets are deliberately explicit (not factory-generated):
 * hapoalim carries only username/password so the add-field control still lists
 * the remaining manifest fields, while leumi carries every declared field so
 * that control collapses to null. Target shapes come from the shared factory.
 * @returns A fresh config fixture.
 */
function makeConfig(): Record<string, unknown> {
  return {
    general: {
      enabled: true,
      mode: 'thorough',
      apiKey: 'sk-secret-123',
      authToken: 'tok-abc',
      retries: 3,
      startDate: '2024-03-01',
      note: 'imported nightly',
      deepPath: '/deep/scan',
      advanced: { timeout: 45, proxy: { host: 'proxy.local' } },
      tags: ['salary', 'rent'],
      rules: [{ pattern: 'GROCERY', active: true }],
    },
    watch: [{ label: 'Dining', limit: 500 }],
    banks: {
      hapoalim: {
        username: 'avi-cohen',
        password: 'bank-pass-1',
        targets: [fakeBankTarget({ actualAccountId: 'acct-1', accounts: 'all', reconcile: false })],
      },
      leumi: { username: 'dana', userCode: 'D123', id: 'ID9', password: 'p', daysBack: 30, twoFactorAuth: true },
    },
    rootField: 'root-value',
  };
}

/* ── Module-scoped harness state ────────────────────────────────────── */

let state: PortalState;
let fetchMock: Mock;
let reloadSpy: Mock;
let mediaChange: ((event: { matches: boolean }) => void) | undefined;

/**
 * Produces a minimal Response-like object the SPA's api() helper understands.
 * @param status - HTTP status code.
 * @param body - Parsed JSON body to resolve.
 * @param throwJson - When true, json() rejects to exercise the parse-failure path.
 * @returns A fake response.
 */
function makeResponse(status: number, body: unknown, throwJson = false): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: throwJson ? (): Promise<unknown> => Promise.reject(new Error('bad json')) : (): Promise<unknown> => Promise.resolve(body),
  };
}

/**
 * Routes a portal request to a canned response based on the harness state.
 * @param path - Request path.
 * @param method - HTTP method.
 * @returns The fake response for the route.
 */
function route(path: string, method: string): FakeResponse {
  if (path === '/auth/status') {
    return state.statusOk ? makeResponse(200, state.status) : makeResponse(503, { error: 'status unavailable' });
  }
  if (path === '/api/manifest') {
    return state.manifestOk ? makeResponse(200, state.manifest) : makeResponse(500, { error: 'manifest unavailable' });
  }
  if (path === '/api/config' && method === 'PUT') {
    return state.saveOk ? makeResponse(204, {}) : makeResponse(state.saveFail.status, state.saveFail.body, state.saveFail.throwJson);
  }
  if (path === '/api/config') {
    return makeResponse(200, state.config);
  }
  if (path === '/auth/login') {
    return state.loginOk ? makeResponse(200, { ok: true }) : makeResponse(state.loginFail.status, state.loginFail.body, state.loginFail.throwJson);
  }
  if (path === '/auth/logout') {
    return state.logoutOk ? makeResponse(204, {}) : makeResponse(500, { error: 'logout failed' });
  }
  return makeResponse(404, { error: 'not found' });
}

/**
 * Resets harness state and installs the DOM, fetch, matchMedia and location
 * stubs the SPA touches at import time.
 * @returns Nothing.
 */
function installHarness(): void {
  state = {
    statusOk: true,
    status: { authorized: true, authMode: 'password', google: false, password: true, email: '' },
    manifestOk: true,
    manifest: makeManifest(),
    config: makeConfig(),
    loginOk: true,
    loginFail: { status: 401, body: { error: 'Invalid portal password' }, throwJson: false },
    saveOk: true,
    saveFail: { status: 500, body: { error: 'Disk full' }, throwJson: false },
    logoutOk: true,
  };
  document.body.innerHTML = BODY_HTML;
  mediaChange = undefined;
  reloadSpy = vi.fn();
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
 * fetch chain to settle.
 * @returns Resolves once the initial render (or login view) is in place.
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
const selectId = (id: string): HTMLSelectElement => byId(id) as HTMLSelectElement;

/**
 * Resolves the first element matching a selector, failing when absent.
 * @param selector - CSS selector.
 * @returns The element.
 */
function query(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`${selector} not found`);
  return node as HTMLElement;
}

const maybe = (selector: string): HTMLElement | null => document.querySelector(selector) as HTMLElement | null;

const clickId = (id: string): void => { byId(id).click(); };

/**
 * Sets a text/number input value and dispatches the input event the SPA binds.
 * @param target - Element id or the element itself.
 * @param value - Value to enter.
 * @returns Nothing.
 */
function typeText(target: string | HTMLElement, value: string): void {
  const node = (typeof target === 'string' ? inputId(target) : target) as HTMLInputElement;
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Sets a select value and dispatches a change event.
 * @param target - Element id or the select element itself.
 * @param value - Option value to select.
 * @returns Nothing.
 */
function changeSelect(target: string | HTMLElement, value: string): void {
  const node = (typeof target === 'string' ? selectId(target) : target) as HTMLSelectElement;
  node.value = value;
  node.dispatchEvent(new Event('change', { bubbles: true }));
}

const toggleCheckbox = (id: string): void => {
  const node = inputId(id);
  node.checked = !node.checked;
  node.dispatchEvent(new Event('change', { bubbles: true }));
};

const pressEnter = (node: HTMLElement): void => { node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
const pressEscape = (): void => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); };

/**
 * Clicks the sidebar navigation button for a section key.
 * @param key - Section key (may be the empty string for the root section).
 * @returns Nothing.
 */
function clickNav(key: string): void {
  const btn = byId('nav').querySelector(`[data-section="${key}"]`);
  if (!btn) throw new Error(`nav button "${key}" not found`);
  (btn as HTMLElement).click();
}

/**
 * Saves the config under fake timers so the toast lifecycle fully drains.
 * @returns Resolves once save + toast timers complete.
 */
async function saveConfig(): Promise<void> {
  vi.useFakeTimers();
  clickId('save');
  await vi.runAllTimersAsync();
  vi.useRealTimers();
}

/**
 * Reads the most recent PUT /api/config body the SPA submitted.
 * @returns The parsed config payload.
 */
function putBody(): unknown {
  const calls = fetchMock.mock.calls as Array<[string, FetchInit | undefined]>;
  const put = [...calls].reverse().find((call) => call[0] === '/api/config' && call[1]?.method === 'PUT');
  if (!put?.[1]?.body) throw new Error('no PUT /api/config body captured');
  return JSON.parse(put[1].body);
}

/**
 * Walks a nested value by keys/indices.
 * @param root - Root value.
 * @param keys - Path of keys/indices to descend.
 * @returns The value at the path (or undefined).
 */
function dig(root: unknown, ...keys: Array<string | number>): unknown {
  let cur: unknown = root;
  for (const key of keys) cur = (cur as Record<string | number, unknown>)[key];
  return cur;
}

const asArray = (value: unknown): unknown[] => value as unknown[];
const putSomePut = (): boolean =>
  (fetchMock.mock.calls as Array<[string, FetchInit | undefined]>).some((c) => c[0] === '/api/config' && c[1]?.method === 'PUT');

/**
 * Typed accessor for the harness config's banks map.
 * @returns The banks record on the current fixture config.
 */
function configBanks(): Record<string, Record<string, unknown>> {
  return state.config.banks as Record<string, Record<string, unknown>>;
}

/**
 * Reads a master-list row button by its bank id.
 * @param id - Catalog bank id or legacy config key.
 * @returns The row button element.
 */
function bankRow(id: string): HTMLElement {
  return query(`[data-bank-row="${id}"]`);
}

/**
 * The bank ids currently rendered in the master list, in order.
 * @returns The data-bank-row values of every visible row.
 */
function bankRowIds(): string[] {
  return Array.from(document.querySelectorAll('.bank-row')).map(
    (row) => row.getAttribute('data-bank-row') ?? '',
  );
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
  it('renders the first section when already authorized', async () => {
    await boot();
    expect(byId('app').classList.contains('hidden')).toBe(false);
    expect(byId('login').classList.contains('hidden')).toBe(true);
    expect(byId('title').textContent).toBe('General');
    expect(byId('subtitle').textContent).toBe('Core importer behavior');
  });

  it('shows the password step when unauthorized in password mode', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    expect(byId('login').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(false);
    expect(byId('pw-btn').classList.contains('hidden')).toBe(false);
    expect(byId('google-btn').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('Sign in to manage your importer configuration.');
  });

  it('shows only the Google step in google mode', async () => {
    unauth({ authMode: 'google', google: false });
    await boot();
    expect(byId('google-btn').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('Sign in with Google to manage your configuration.');
  });

  it('asks for Google first (password hidden) in both mode', async () => {
    unauth({ authMode: 'both', google: false, password: false });
    await boot();
    expect(byId('google-btn').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(true);
    expect(byId('pw-btn').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('Sign in with Google, then enter the portal password.');
  });

  it('acknowledges a signed-in Google user (with email) in both mode', async () => {
    unauth({ authMode: 'both', google: true, password: false, email: 'avi@example.com' });
    await boot();
    expect(byId('google-btn').classList.contains('hidden')).toBe(true);
    expect(byId('pw').classList.contains('hidden')).toBe(false);
    expect(byId('login-hint').textContent).toBe('✓ Signed in as avi@example.com. Now enter the portal password.');
  });

  it('acknowledges a signed-in Google user without email in both mode', async () => {
    unauth({ authMode: 'both', google: true, password: false, email: '' });
    await boot();
    expect(byId('login-hint').textContent).toBe('✓ Signed in. Now enter the portal password.');
  });

  it('acknowledges an accepted password and asks for Google in both mode', async () => {
    unauth({ authMode: 'both', google: false, password: true });
    await boot();
    expect(byId('google-btn').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('✓ Password accepted. Now sign in with Google.');
  });

  it('falls back to the password step when the status check fails', async () => {
    state.statusOk = false;
    await boot();
    expect(byId('login').classList.contains('hidden')).toBe(false);
    expect(byId('pw').classList.contains('hidden')).toBe(false);
    expect(byId('login-hint').textContent).toBe('Sign in to manage your importer configuration.');
  });

  it('shows a recoverable load error when the config cannot be loaded', async () => {
    state.manifestOk = false;
    await boot();
    expect(byId('reload-btn').classList.contains('hidden')).toBe(false);
    expect(byId('google-btn').classList.contains('hidden')).toBe(true);
    expect(byId('login-hint').textContent).toBe('Signed in, but your configuration could not be loaded.');
    expect(byId('login-err').textContent).toContain('Could not load configuration');
  });

  it('defaults to the password step when the status omits an auth mode', async () => {
    unauth({ password: false });
    await boot();
    expect(byId('pw').classList.contains('hidden')).toBe(false);
    expect(byId('login-hint').textContent).toBe('Sign in to manage your importer configuration.');
  });

  it('focuses no field when an unauthorized status leaves no step to complete', async () => {
    unauth({ authMode: 'both', google: true, password: true });
    await boot();
    expect(byId('login').classList.contains('hidden')).toBe(false);
    expect(byId('google-btn').classList.contains('hidden')).toBe(true);
    expect(byId('pw').classList.contains('hidden')).toBe(true);
  });

  it('shows a load error when the manifest contains no sections', async () => {
    state.manifest = { sections: [], banks: [], bankRequirements: {} };
    await boot();
    expect(byId('reload-btn').classList.contains('hidden')).toBe(false);
    expect(byId('login-err').textContent).toContain('Could not load configuration');
  });
});

describe('PortalApp login flow', () => {
  it('submits the password and opens the app on success', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    typeText('pw', 'correct-horse-battery');
    state.status = { authorized: true };
    clickId('pw-btn');
    await settle();
    await settle();
    expect(byId('app').classList.contains('hidden')).toBe(false);
    expect(byId('login').classList.contains('hidden')).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0] === '/auth/login')).toBe(true);
  });

  it('submits the password when Enter is pressed', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    typeText('pw', 'enter-key-pass');
    state.status = { authorized: true };
    pressEnter(byId('pw'));
    await settle();
    await settle();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/auth/login')).toBe(true);
  });

  it('ignores a submit while the sign-in button is disabled', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    inputId('pw-btn').disabled = true;
    pressEnter(byId('pw'));
    await settle();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/auth/login')).toBe(false);
  });

  it('does not submit when a non-Enter key is pressed in the password box', async () => {
    unauth({ authMode: 'password', password: false });
    await boot();
    typeText('pw', 'irrelevant');
    byId('pw').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await settle();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/auth/login')).toBe(false);
  });

  it('shows the server message when the password is rejected', async () => {
    unauth({ authMode: 'password', password: false });
    state.loginOk = false;
    await boot();
    typeText('pw', 'wrong-pass');
    clickId('pw-btn');
    await settle();
    await settle();
    expect(byId('login-err').textContent).toBe('Invalid portal password');
    expect(inputId('pw-btn').disabled).toBe(false);
    expect(byId('pw-btn').textContent).toBe('Sign in');
  });

  it('shows a generic HTTP error when the server sends no message', async () => {
    unauth({ authMode: 'password', password: false });
    state.loginOk = false;
    state.loginFail = { status: 503, body: {}, throwJson: false };
    await boot();
    typeText('pw', 'x');
    clickId('pw-btn');
    await settle();
    await settle();
    expect(byId('login-err').textContent).toBe('HTTP 503');
  });

  it('recovers when the error body is not valid JSON', async () => {
    unauth({ authMode: 'password', password: false });
    state.loginOk = false;
    state.loginFail = { status: 500, body: null, throwJson: true };
    await boot();
    typeText('pw', 'x');
    clickId('pw-btn');
    await settle();
    await settle();
    expect(byId('login-err').textContent).toBe('HTTP 500');
  });
});

describe('PortalApp save flow', () => {
  it('persists the config and shows a success status with a toast', async () => {
    await boot();
    vi.useFakeTimers();
    clickId('save');
    await vi.advanceTimersByTimeAsync(50);
    expect(byId('status').textContent).toContain('Saved');
    expect(byId('status').className).toContain('ok');
    const toastNode = byId('toast').querySelector('.toast');
    expect(toastNode).not.toBeNull();
    expect(toastNode?.classList.contains('show')).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(byId('toast').querySelector('.toast')).toBeNull();
    vi.useRealTimers();
    expect(putSomePut()).toBe(true);
  });

  it('shows an error status and toast when saving fails', async () => {
    state.saveOk = false;
    await boot();
    vi.useFakeTimers();
    clickId('save');
    await vi.advanceTimersByTimeAsync(50);
    expect(byId('status').textContent).toContain('Disk full');
    expect(byId('status').className).toContain('err');
    expect(byId('toast').querySelector('.toast.err')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
  });
});

describe('PortalApp navigation and drawer', () => {
  it('switches sections and marks the active nav item', async () => {
    await boot();
    clickNav('watch');
    expect(byId('title').textContent).toBe('Spending watch');
    expect(byId('subtitle').textContent).toBe('1 item');
    const active = byId('nav').querySelector('[data-section="watch"]');
    expect(active?.classList.contains('active')).toBe(true);
    expect(active?.getAttribute('aria-current')).toBe('page');
  });

  it('opens the mobile drawer from the menu button', async () => {
    await boot();
    clickId('menu');
    expect(byId('app').classList.contains('nav-open')).toBe(true);
    expect(byId('menu').getAttribute('aria-expanded')).toBe('true');
    expect(byId('nav').querySelector('button')).toBe(document.activeElement);
  });

  it('ignores a second open while the drawer is already open', async () => {
    await boot();
    clickId('menu');
    clickId('menu');
    expect(byId('app').classList.contains('nav-open')).toBe(true);
  });

  it('closes the drawer when the scrim is clicked', async () => {
    await boot();
    clickId('menu');
    clickId('scrim');
    expect(byId('app').classList.contains('nav-open')).toBe(false);
    expect(byId('menu').getAttribute('aria-expanded')).toBe('false');
    expect(byId('menu')).toBe(document.activeElement);
  });

  it('closing an already-closed drawer is a no-op', async () => {
    await boot();
    clickId('scrim');
    expect(byId('app').classList.contains('nav-open')).toBe(false);
    expect(byId('menu').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the drawer on Escape when open', async () => {
    await boot();
    clickId('menu');
    pressEscape();
    expect(byId('app').classList.contains('nav-open')).toBe(false);
  });

  it('ignores Escape when the drawer is closed', async () => {
    await boot();
    pressEscape();
    expect(byId('app').classList.contains('nav-open')).toBe(false);
    expect(byId('menu').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the drawer when the viewport grows to desktop', async () => {
    await boot();
    clickId('menu');
    mediaChange?.({ matches: true });
    expect(byId('app').classList.contains('nav-open')).toBe(false);
  });

  it('keeps the drawer open when a non-matching media change fires', async () => {
    await boot();
    clickId('menu');
    mediaChange?.({ matches: false });
    expect(byId('app').classList.contains('nav-open')).toBe(true);
  });
});

describe('PortalApp object section fields', () => {
  it('renders a control for every field kind plus the docs link', async () => {
    await boot();
    expect(query('a.doc').getAttribute('href')).toContain('GeneralSettings.md');
    expect(inputId('general.enabled').type).toBe('checkbox');
    expect(inputId('general.enabled').checked).toBe(true);
    expect(selectId('general.mode').value).toBe('thorough');
    expect(inputId('general.apiKey').type).toBe('password');
    expect(inputId('general.apiKey').value).toBe('sk-secret-123');
    expect(inputId('general.apiKey').getAttribute('aria-required')).toBe('true');
    expect(inputId('general.authToken').type).toBe('text');
    expect(inputId('general.authToken').getAttribute('aria-required')).toBe('true');
    expect(inputId('general.retries').type).toBe('number');
    expect(inputId('general.retries').min).toBe('0');
    expect(inputId('general.retries').max).toBe('10');
    expect(inputId('general.startDate').type).toBe('date');
    expect(inputId('general.startDate').value).toBe('2024-03-01');
    expect(query('[data-path="general.advanced"]').tagName).toBe('FIELDSET');
    expect(byId('general.advanced.timeout').getAttribute('type')).toBe('number');
    expect(maybe('[data-path="general.advanced.proxy"]')).not.toBeNull();
    expect(byId('general.advanced.proxy.host')).not.toBeNull();
  });

  it('hides a conditional field when its controller value changes', async () => {
    await boot();
    expect(maybe('#general\\.deepPath')).not.toBeNull();
    changeSelect('general.mode', 'fast');
    expect(document.getElementById('general.deepPath')).toBeNull();
    expect(selectId('general.mode').value).toBe('fast');
  });

  it('persists a toggled checkbox value', async () => {
    await boot();
    toggleCheckbox('general.enabled');
    await saveConfig();
    expect(dig(putBody(), 'general', 'enabled')).toBe(false);
  });

  it('stores a numeric value entered into a number field', async () => {
    await boot();
    typeText('general.retries', '7');
    await saveConfig();
    expect(dig(putBody(), 'general', 'retries')).toBe(7);
  });

  it('removes a number field from the config when cleared', async () => {
    await boot();
    typeText('general.retries', '');
    await saveConfig();
    expect(dig(putBody(), 'general', 'retries')).toBeUndefined();
  });

  it('stores text typed into a string field', async () => {
    await boot();
    typeText('general.note', 'updated note');
    await saveConfig();
    expect(dig(putBody(), 'general', 'note')).toBe('updated note');
  });

  it('stores a new secret value', async () => {
    await boot();
    typeText('general.apiKey', 'rotated-secret');
    await saveConfig();
    expect(dig(putBody(), 'general', 'apiKey')).toBe('rotated-secret');
  });

  it('reveals and hides a secret when the eye toggle is clicked', async () => {
    await boot();
    const eye = query('.secret .reveal');
    const secret = inputId('general.apiKey');
    expect(secret.type).toBe('password');
    eye.click();
    expect(secret.type).toBe('text');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(eye.getAttribute('aria-label')).toBe('Hide secret');
    eye.click();
    expect(secret.type).toBe('password');
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    expect(eye.getAttribute('aria-label')).toBe('Show secret');
  });

  it('renders empty controls for a section with no stored values', async () => {
    await boot();
    clickNav('extras');
    expect(inputId('extras.label').value).toBe('');
    expect(selectId('extras.channel').value).toBe('');
    expect(inputId('extras.token').value).toBe('');
    expect(inputId('extras.count').value).toBe('');
    expect(inputId('extras.when').value).toBe('');
    expect(inputId('extras.flag').checked).toBe(false);
    expect(maybe('[data-path="extras.opts"]')).not.toBeNull();
    expect(byId('extras.opts.verbose')).not.toBeNull();
  });

  it('binds the root section to the config root', async () => {
    await boot();
    clickNav('');
    expect(byId('title').textContent).toBe('Root');
    expect(inputId('rootField').value).toBe('root-value');
  });

  it('renders a fieldless object section with only its docs link', async () => {
    await boot();
    clickNav('about');
    expect(byId('title').textContent).toBe('About');
    expect(query('a.doc').getAttribute('href')).toContain('Overview.md');
    expect(byId('view').querySelectorAll('input, select').length).toBe(0);
  });
});

describe('PortalApp list fields', () => {
  it('renders scalar and object list items', async () => {
    await boot();
    expect((query('[aria-label="Tag 1"]') as HTMLInputElement).value).toBe('salary');
    expect((query('[aria-label="Tag 2"]') as HTMLInputElement).value).toBe('rent');
    expect(inputId('general.rules.0.pattern').value).toBe('GROCERY');
    expect(inputId('general.rules.0.active').checked).toBe(true);
  });

  it('renders an empty input for a null scalar list entry', async () => {
    (state.config.general as Record<string, unknown>).tags = ['payday', null];
    await boot();
    expect((query('[aria-label="Tag 1"]') as HTMLInputElement).value).toBe('payday');
    expect((query('[aria-label="Tag 2"]') as HTMLInputElement).value).toBe('');
  });

  it('adds a scalar list item', async () => {
    await boot();
    query('[data-add="general.tags"]').click();
    expect(maybe('[aria-label="Tag 3"]')).not.toBeNull();
    await saveConfig();
    expect(asArray(dig(putBody(), 'general', 'tags'))).toHaveLength(3);
  });

  it('edits a scalar list item', async () => {
    await boot();
    typeText(query('[aria-label="Tag 1"]'), 'groceries');
    await saveConfig();
    expect(dig(putBody(), 'general', 'tags', 0)).toBe('groceries');
  });

  it('removes a scalar list item', async () => {
    await boot();
    query('[aria-label="Remove Tag 1"]').click();
    await saveConfig();
    expect(asArray(dig(putBody(), 'general', 'tags'))).toEqual(['rent']);
  });

  it('adds an object list item', async () => {
    await boot();
    query('[data-add="general.rules"]').click();
    expect(byId('general.rules.1.pattern')).not.toBeNull();
    await saveConfig();
    expect(asArray(dig(putBody(), 'general', 'rules'))).toHaveLength(2);
  });

  it('removes an object list item', async () => {
    await boot();
    query('[aria-label="Remove Rule 1"]').click();
    await saveConfig();
    expect(asArray(dig(putBody(), 'general', 'rules'))).toHaveLength(0);
  });

  it('creates the backing array for a list field with no stored value', async () => {
    await boot();
    clickNav('extras');
    expect(maybe('[data-path="extras.extraTags"]')).not.toBeNull();
    expect(maybe('[aria-label="Extra tag 1"]')).toBeNull();
    query('[data-add="extras.extraTags"]').click();
    expect(maybe('[aria-label="Extra tag 1"]')).not.toBeNull();
  });
});

describe('PortalApp list sections', () => {
  it('renders a card per list-section item', async () => {
    await boot();
    clickNav('watch');
    expect(maybe('[data-item="watch.0"]')).not.toBeNull();
    expect(inputId('watch.0.label').value).toBe('Dining');
    expect(inputId('watch.0.limit').value).toBe('500');
  });

  it('adds a list-section item', async () => {
    await boot();
    clickNav('watch');
    query('[data-add="watch"]').click();
    expect(maybe('[data-item="watch.1"]')).not.toBeNull();
    expect(byId('subtitle').textContent).toBe('2 items');
    await saveConfig();
    expect(asArray(dig(putBody(), 'watch'))).toHaveLength(2);
  });

  it('removes a list-section item', async () => {
    await boot();
    clickNav('watch');
    query('[data-item="watch.0"] .danger').click();
    expect(byId('subtitle').textContent).toBe('0 items');
    await saveConfig();
    expect(asArray(dig(putBody(), 'watch'))).toHaveLength(0);
  });

  it('creates the backing array for a list section with no stored value', async () => {
    await boot();
    clickNav('alerts');
    expect(byId('title').textContent).toBe('Alerts');
    expect(maybe('[data-add="alerts"]')).not.toBeNull();
    expect(maybe('[data-item="alerts.0"]')).toBeNull();
    query('[data-add="alerts"]').click();
    expect(maybe('[data-item="alerts.0"]')).not.toBeNull();
  });
});

describe('PortalApp banks section', () => {
  it('renders a searchable master list and auto-selects the first bank', async () => {
    await boot();
    clickNav('banks');
    expect(byId('subtitle').textContent).toBe('2 banks configured');
    expect(maybe('#bank-search')).not.toBeNull();
    // A row for every catalog bank, added ones marked, others addable.
    expect(bankRowIds()).toEqual(['hapoalim', 'leumi', 'discount']);
    expect(bankRow('hapoalim').dataset.bankAdded).toBe('true');
    expect(bankRow('hapoalim').classList.contains('added')).toBe(true);
    expect(query('[data-bank-row="hapoalim"] .visually-hidden').textContent).toBe('added');
    expect(bankRow('discount').classList.contains('addable')).toBe(true);
    expect(maybe('[data-bank-row="discount"][data-bank-added]')).toBeNull();
    expect(query('[data-bank-row="discount"] .visually-hidden').textContent).toBe('add');
    // The first configured bank is auto-selected: its detail card renders alone.
    expect(bankRow('hapoalim').getAttribute('aria-current')).toBe('true');
    expect(bankRow('hapoalim').classList.contains('active')).toBe(true);
    expect(inputId('banks.hapoalim.username').value).toBe('avi-cohen');
    expect(inputId('banks.hapoalim.password').value).toBe('bank-pass-1');
    expect(maybe('[data-add-field="hapoalim"]')).not.toBeNull();
    expect(inputId('banks.hapoalim.targets.0.actualAccountId').value).toBe('acct-1');
    expect(document.querySelectorAll('.bank-detail [data-bank]')).toHaveLength(1);
  });

  it('adds a numeric field to the selected bank defaulting to zero', async () => {
    await boot();
    clickNav('banks');
    changeSelect(query('[data-add-field="hapoalim"]'), 'daysBack');
    expect(inputId('banks.hapoalim.daysBack').value).toBe('0');
    await saveConfig();
    expect(dig(putBody(), 'banks', 'hapoalim', 'daysBack')).toBe(0);
  });

  it('adds a boolean field to the selected bank defaulting to false', async () => {
    await boot();
    clickNav('banks');
    changeSelect(query('[data-add-field="hapoalim"]'), 'twoFactorAuth');
    expect(inputId('banks.hapoalim.twoFactorAuth').checked).toBe(false);
    await saveConfig();
    expect(dig(putBody(), 'banks', 'hapoalim', 'twoFactorAuth')).toBe(false);
  });

  it('adds a string field to the selected bank defaulting to empty', async () => {
    await boot();
    clickNav('banks');
    changeSelect(query('[data-add-field="hapoalim"]'), 'userCode');
    expect(inputId('banks.hapoalim.userCode').value).toBe('');
    await saveConfig();
    expect(dig(putBody(), 'banks', 'hapoalim', 'userCode')).toBe('');
  });

  it('ignores the add-field placeholder option', async () => {
    await boot();
    clickNav('banks');
    changeSelect(query('[data-add-field="hapoalim"]'), '');
    expect(maybe('#banks\\.hapoalim\\.daysBack')).toBeNull();
  });

  it('switches the detail when an added row is selected, showing only that bank', async () => {
    await boot();
    clickNav('banks');
    expect(maybe('[data-bank="hapoalim"]')).not.toBeNull();
    bankRow('leumi').click();
    expect(maybe('[data-bank="leumi"]')).not.toBeNull();
    expect(maybe('[data-bank="hapoalim"]')).toBeNull();
    expect(document.querySelectorAll('.bank-detail [data-bank]')).toHaveLength(1);
    // leumi carries every catalog field, so its add-field control collapses.
    expect(maybe('[data-add-field="leumi"]')).toBeNull();
    expect(maybe('[data-add-target="leumi"]')).not.toBeNull();
    expect(bankRow('leumi').getAttribute('aria-current')).toBe('true');
  });

  it('filters the master list by the search query', async () => {
    await boot();
    clickNav('banks');
    expect(bankRowIds()).toHaveLength(3);
    typeText('bank-search', 'leu');
    expect(bankRowIds()).toEqual(['leumi']);
    typeText('bank-search', 'zzz');
    expect(bankRowIds()).toHaveLength(0);
    // The search input itself survives keystroke re-renders.
    expect(maybe('#bank-search')).not.toBeNull();
  });

  it('shows an empty-result row and announces the count when no bank matches', async () => {
    await boot();
    clickNav('banks');
    typeText('bank-search', 'zzz');
    expect(bankRowIds()).toHaveLength(0);
    expect(maybe('.bank-empty-row')?.textContent).toBe('No banks match your search.');
    expect(byId('bank-list-status').textContent).toBe('0 banks match your search.');
    typeText('bank-search', 'leu');
    expect(maybe('.bank-empty-row')).toBeNull();
    expect(byId('bank-list-status').textContent).toBe('1 bank matches your search.');
  });

  it('moves focus into the detail editor when a bank is selected (never <body>)', async () => {
    await boot();
    clickNav('banks');
    bankRow('discount').click();
    const active = document.activeElement;
    expect(active).not.toBe(document.body);
    expect(query('.bank-detail').contains(active)).toBe(true);
    // Focus lands on an editable field, never the destructive Remove button.
    expect(['INPUT', 'SELECT', 'TEXTAREA']).toContain(active?.tagName);
    expect((active as HTMLElement).matches('[data-remove-bank]')).toBe(false);
  });

  it('moves focus to the search box after removing the only bank', async () => {
    delete configBanks().leumi;
    await boot();
    clickNav('banks');
    query('[data-remove-bank="hapoalim"]').click();
    expect(maybe('.bank-empty')).not.toBeNull();
    expect(document.activeElement).toBe(byId('bank-search'));
  });

  it('removes a bank and reselects a remaining one', async () => {
    await boot();
    clickNav('banks');
    bankRow('leumi').click();
    query('[data-remove-bank="leumi"]').click();
    expect(maybe('[data-bank="leumi"]')).toBeNull();
    expect(bankRow('leumi').dataset.bankAdded).toBeUndefined();
    expect(byId('subtitle').textContent).toBe('1 bank configured');
    expect(maybe('[data-bank="hapoalim"]')).not.toBeNull();
    await saveConfig();
    expect(dig(putBody(), 'banks', 'leumi')).toBeUndefined();
  });

  it('falls back to the empty state after removing the only bank', async () => {
    delete configBanks().leumi;
    await boot();
    clickNav('banks');
    query('[data-remove-bank="hapoalim"]').click();
    expect(maybe('[data-bank]')).toBeNull();
    expect(maybe('.bank-empty')).not.toBeNull();
  });

  it('adds a bank by clicking an addable row, templating fields and one target', async () => {
    await boot();
    clickNav('banks');
    bankRow('discount').click();
    expect(maybe('[data-bank="discount"]')).not.toBeNull();
    expect(bankRow('discount').dataset.bankAdded).toBe('true');
    expect(byId('subtitle').textContent).toBe('3 banks configured');
    await saveConfig();
    expect(dig(putBody(), 'banks', 'discount', 'daysBack')).toBe(14);
    expect(dig(putBody(), 'banks', 'discount', 'twoFactorAuth')).toBe(false);
    expect(dig(putBody(), 'banks', 'discount', 'id')).toBe('');
    expect(asArray(dig(putBody(), 'banks', 'discount', 'targets'))).toHaveLength(1);
  });

  it('templates a bank that has no requirements entry', async () => {
    state.manifest.banks.push('isracard');
    await boot();
    clickNav('banks');
    bankRow('isracard').click();
    expect(maybe('[data-bank="isracard"]')).not.toBeNull();
    await saveConfig();
    expect(dig(putBody(), 'banks', 'isracard', 'daysBack')).toBe(14);
    expect(asArray(dig(putBody(), 'banks', 'isracard', 'targets'))).toHaveLength(1);
  });

  it('matches a camelCase config key to its lowercase catalog id without duplicating', async () => {
    state.manifest.banks.push('onezero');
    configBanks().oneZero = {
      username: 'oz-user',
      password: 'oz-pass',
      targets: [fakeBankTarget({ actualAccountId: 'acct-oz', accounts: 'all', reconcile: false })],
    };
    await boot();
    clickNav('banks');
    // The already-configured camelCase bank shows as added, not addable.
    expect(bankRow('onezero').dataset.bankAdded).toBe('true');
    expect(bankRow('onezero').classList.contains('added')).toBe(true);
    expect(bankRow('onezero').classList.contains('addable')).toBe(false);
    // Selecting it edits the existing camelCase entry — no lowercase duplicate.
    bankRow('onezero').click();
    expect(inputId('banks.oneZero.username').value).toBe('oz-user');
    await saveConfig();
    expect(dig(putBody(), 'banks', 'oneZero', 'username')).toBe('oz-user');
    expect(dig(putBody(), 'banks', 'onezero')).toBeUndefined();
  });

  it('lists an unknown/legacy config bank as an added, editable, removable row', async () => {
    configBanks().legacybank = {
      username: 'legacy-user',
      targets: [fakeBankTarget({ actualAccountId: 'acct-legacy', accounts: 'all', reconcile: false })],
    };
    await boot();
    clickNav('banks');
    expect(bankRow('legacybank').dataset.bankAdded).toBe('true');
    bankRow('legacybank').click();
    expect(inputId('banks.legacybank.username').value).toBe('legacy-user');
    query('[data-remove-bank="legacybank"]').click();
    expect(maybe('[data-bank="legacybank"]')).toBeNull();
  });

  it('adds a target to the selected bank', async () => {
    await boot();
    clickNav('banks');
    query('[data-add-target="hapoalim"]').click();
    expect(maybe('[data-target="banks.hapoalim.targets.1"]')).not.toBeNull();
    await saveConfig();
    expect(asArray(dig(putBody(), 'banks', 'hapoalim', 'targets'))).toHaveLength(2);
  });

  it('removes a target from the selected bank', async () => {
    await boot();
    clickNav('banks');
    query('[data-target="banks.hapoalim.targets.0"] .danger').click();
    await saveConfig();
    expect(asArray(dig(putBody(), 'banks', 'hapoalim', 'targets'))).toHaveLength(0);
  });

  it('renders the empty state and only addable rows when no banks are configured', async () => {
    delete state.config.banks;
    await boot();
    clickNav('banks');
    expect(byId('subtitle').textContent).toBe('0 banks configured');
    expect(maybe('[data-bank]')).toBeNull();
    expect(maybe('.bank-empty')).not.toBeNull();
    expect(maybe('#bank-search')).not.toBeNull();
    expect(document.querySelectorAll('.bank-row.addable')).toHaveLength(3);
    expect(maybe('[data-bank-row][data-bank-added]')).toBeNull();
  });
});

describe('PortalApp logout and reload wiring', () => {
  it('logs out then reloads the page', async () => {
    await boot();
    clickId('logout');
    await settle();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/auth/logout')).toBe(true);
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
    state.manifestOk = false;
    await boot();
    clickId('reload-btn');
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('PortalApp SPA shell module contract', () => {
  // app.js boots with a top-level `await init()`, which is only valid when the
  // browser loads it as an ES module. The ESLint guardrail keeps `await init()`
  // in app.js, but a revert of this script tag to a classic `<script>` would
  // make top-level await a browser syntax error while every lint/canary gate
  // (which parse app.js as a module on its own) still pass. Lock the other half
  // of the runtime contract here — SonarCloud S7785.
  it('loads /app.js as an ES module', () => {
    const shell = new DOMParser().parseFromString(readFileSync(INDEX_PATH, 'utf8'), 'text/html');
    const appScript = shell.querySelector('script[src="/app.js"]');
    expect(appScript).not.toBeNull();
    expect(appScript?.getAttribute('type')).toBe('module');
  });

  // Every shell <button> sits outside a <form>, but an implicit `type="submit"`
  // would still let a stray future <form> wrapper turn a click into a navigation
  // that drops unsaved edits. Pin each control to type="button" so intent is
  // explicit and click handlers stay the only behaviour.
  it('declares every shell button as type="button"', () => {
    const shell = new DOMParser().parseFromString(readFileSync(INDEX_PATH, 'utf8'), 'text/html');
    const buttons = [...shell.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every(button => button.getAttribute('type') === 'button')).toBe(true);
  });
});
