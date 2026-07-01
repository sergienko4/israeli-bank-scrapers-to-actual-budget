'use strict';

// Config Portal SPA (vanilla JS, no build step). The whole config form is
// rendered by the vendored jedison library (germanbisurgi/jedison) driven by the
// auto-generated JSON Schema served at GET /api/schema over the live config
// (GET /api/config). A new config field appears automatically with zero UI
// changes — the schema is the single source of truth. Secrets are shown as
// ******** and preserved on save unless the user overwrites them.

import Jedison from './vendor/jedison/jedison.js';

// Inline eye icon so the secret reveal toggle renders on every OS/browser
// (emoji glyphs are unavailable in some headless/server font sets).
const EYE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

let schema = { properties: {} };
let config = {};
let editor = null;
let showWhenRules = [];

/**
 * Looks up a DOM element by id.
 * @param {string} id element id
 * @returns {HTMLElement} the element
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Calls a portal JSON endpoint, throwing on non-2xx.
 * @param {string} path request path
 * @param {object} [opts] fetch options
 * @returns {Promise<object>} parsed JSON body ({} for 204)
 */
async function api(path, opts = {}) {
  // Only declare a JSON body when one is actually sent: a bodyless POST (e.g.
  // logout) with content-type application/json trips Fastify's empty-body guard.
  const headers = opts.body == null ? {} : { 'content-type': 'application/json' };
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? {} : res.json();
}

// ---------- element helpers ----------

/**
 * Creates an element with an optional class and text.
 * @param {string} tag tag name
 * @param {string} [cls] class name
 * @param {string} [text] text content
 * @returns {HTMLElement} the new element
 */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Creates a non-submitting button.
 * @param {string} text label
 * @param {string} [cls] class name
 * @returns {HTMLButtonElement} the button
 */
function button(text, cls) {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

// ---------- auth / bootstrap ----------

/**
 * Boots the app: refreshes auth state, then loads config or shows the login step.
 * @returns {Promise<void>} resolves when boot is complete
 */
async function init() {
  await refreshAuth();
}

/**
 * Re-reads auth status and either opens the app (when every required factor is
 * satisfied) or shows the remaining login step. Called on boot, after returning
 * from Google, and after a password submit so `both` mode advances cleanly.
 * @returns {Promise<void>} resolves when the view is updated
 */
async function refreshAuth() {
  const status = await api('/auth/status').catch(() => ({ authMode: 'password' }));
  if (status.authorized) {
    try {
      await load();
      return;
    } catch {
      showLoadError();
      return;
    }
  }
  showLogin(status);
}

/**
 * Shows the login panel with only the step(s) still required for the auth mode,
 * marking a satisfied factor so `both` mode guides Google → password clearly.
 * @param {object} status auth status {authMode, google, password, email}
 * @returns {void}
 */
function showLogin(status) {
  const mode = status.authMode ?? 'password';
  const needGoogle = mode !== 'password' && !status.google;
  const needPassword = mode !== 'google' && !status.password;
  $('google-btn').classList.toggle('hidden', !needGoogle);
  $('pw').classList.toggle('hidden', !needPassword);
  $('pw-btn').classList.toggle('hidden', !needPassword);
  $('reload-btn').classList.add('hidden');
  $('login-hint').textContent = loginHint(status);
  $('login').classList.remove('hidden');
  if (needGoogle) $('google-btn').focus();
  else if (needPassword) $('pw').focus();
}

/**
 * Shows a recoverable error when the user is authenticated but the config could
 * not be loaded, offering a reload instead of a dead-end blank login card.
 * @returns {void}
 */
function showLoadError() {
  $('google-btn').classList.add('hidden');
  $('pw').classList.add('hidden');
  $('pw-btn').classList.add('hidden');
  $('reload-btn').classList.remove('hidden');
  $('login-hint').textContent = 'Signed in, but your configuration could not be loaded.';
  $('login-err').textContent = 'Could not load configuration. Check the server logs, then reload.';
  $('login').classList.remove('hidden');
  $('reload-btn').focus();
}

/**
 * Builds the login hint, acknowledging any factor already satisfied in `both`.
 * @param {object} status auth status {authMode, google, password, email}
 * @returns {string} the hint text
 */
function loginHint(status) {
  if (status.authMode === 'both') {
    if (status.google) {
      const who = status.email ? ` as ${status.email}` : '';
      return `✓ Signed in${who}. Now enter the portal password.`;
    }
    if (status.password) return '✓ Password accepted. Now sign in with Google.';
    return 'Sign in with Google, then enter the portal password.';
  }
  if (status.authMode === 'google') return 'Sign in with Google to manage your configuration.';
  return 'Sign in to manage your importer configuration.';
}

/**
 * Submits the portal password, then refreshes auth: opens the app when the mode
 * is now fully satisfied, or advances to the next required step otherwise (so a
 * correct password in `both` mode is acknowledged, not shown as an error).
 * @returns {Promise<void>} resolves when handled
 */
async function login() {
  const btn = $('pw-btn');
  if (btn.disabled) return;
  const label = btn.textContent;
  $('login-err').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: $('pw').value }),
    });
    await refreshAuth();
  } catch (e) {
    $('login-err').textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/**
 * Loads the schema + config and renders the app.
 * @returns {Promise<void>} resolves when rendered
 */
async function load() {
  schema = await api('/api/schema');
  config = await api('/api/config');
  showWhenRules = collectShowWhen(schema, '#', []);
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('title').textContent = schema.title ?? 'Configuration';
  render();
  focusApp();
}

/**
 * Moves keyboard focus onto the app's main heading after login so assistive
 * tech lands on the page content instead of the now-hidden login button.
 * @returns {void}
 */
function focusApp() {
  const title = $('title');
  title.setAttribute('tabindex', '-1');
  title.focus();
}

// ---------- render ----------

/**
 * Destroys any previous editor and renders the whole config form via jedison,
 * then wires the secret toggles, conditional visibility, nav, and bank tools.
 * @returns {void}
 */
function render() {
  const view = $('view');
  destroyEditor();
  view.innerHTML = '';
  const tools = el('div', 'bank-tools');
  tools.id = 'bank-tools';
  const container = el('div', 'jedi-form');
  view.append(tools, container);
  editor = new Jedison.Create({
    container,
    theme: new Jedison.Theme(),
    schema,
    data: config,
    showErrors: 'change',
    objectAdd: false,
  });
  onEditorReady(container);
}

/**
 * Runs the post-construction wiring: secret reveal toggles, conditional
 * visibility, sidebar nav, bank tools, subtitle, and the reactive change hook.
 * @param {HTMLElement} container the jedison mount point
 * @returns {void}
 */
function onEditorReady(container) {
  enhanceSecrets(container);
  applyShowWhen();
  buildNav();
  buildBankTools();
  updateSubtitle();
  editor.on('change', () => {
    enhanceSecrets(container);
    applyShowWhen();
  });
}

/**
 * Destroys the current jedison instance if present so a re-render never leaks
 * editors or duplicate DOM.
 * @returns {void}
 */
function destroyEditor() {
  if (editor) {
    editor.destroy();
    editor = null;
  }
}

/**
 * Shows a short subtitle summarising how many banks are configured.
 * @returns {void}
 */
function updateSubtitle() {
  const n = Object.keys(editorBanks()).length;
  $('subtitle').textContent = `${n} bank${n === 1 ? '' : 's'} configured`;
}

// ---------- secret reveal toggles ----------

/**
 * Adds a reveal toggle to every jedison-rendered password input once.
 * @param {HTMLElement} container the jedison mount point
 * @returns {void}
 */
function enhanceSecrets(container) {
  container.querySelectorAll('input[type="password"]').forEach(addReveal);
}

/**
 * Injects an eye toggle button after a password input (idempotent).
 * @param {HTMLInputElement} input the password input
 * @returns {void}
 */
function addReveal(input) {
  if (input.dataset.reveal === 'on') return;
  input.dataset.reveal = 'on';
  const wrap = el('span', 'secret-wrap');
  input.insertAdjacentElement('beforebegin', wrap);
  wrap.appendChild(input);
  const eye = button('', 'btn ghost reveal');
  eye.innerHTML = EYE_SVG;
  eye.setAttribute('aria-label', 'Show secret');
  eye.setAttribute('aria-pressed', 'false');
  eye.onclick = () => toggleReveal(input, eye);
  wrap.appendChild(eye);
}

/**
 * Toggles a secret input between masked and revealed states.
 * @param {HTMLInputElement} input the password input
 * @param {HTMLButtonElement} eye the toggle button
 * @returns {void}
 */
function toggleReveal(input, eye) {
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  eye.setAttribute('aria-pressed', String(reveal));
  eye.setAttribute('aria-label', reveal ? 'Hide secret' : 'Show secret');
}

// ---------- conditional visibility (x-show-when) ----------

/**
 * Walks the schema collecting every `x-show-when` rule as instance paths so the
 * SPA can toggle any conditional subtree generically, with zero per-field wiring.
 * @param {object} node the (sub)schema being inspected
 * @param {string} path the instance path of this node (e.g. '#/portal/google')
 * @param {Array} out accumulator of {path, controller, in} rules
 * @returns {Array} the accumulated rules
 */
function collectShowWhen(node, path, out) {
  if (!node || typeof node !== 'object') return out;
  const cond = node['x-show-when'];
  if (cond) out.push({ path, controller: controllerPath(path, cond.field), in: cond.in });
  const props = node.properties ?? {};
  Object.keys(props).forEach((key) => collectShowWhen(props[key], `${path}/${key}`, out));
  return out;
}

/**
 * Resolves the instance path of a sibling controller field for a conditional.
 * @param {string} path the conditional subtree's instance path
 * @param {string} field the controller field name (sibling of the subtree)
 * @returns {string} the controller's instance path
 */
function controllerPath(path, field) {
  const parent = path.slice(0, path.lastIndexOf('/'));
  return `${parent}/${field}`;
}

/**
 * Applies every collected `x-show-when` rule against the current value.
 * @returns {void}
 */
function applyShowWhen() {
  const value = editor.getValue();
  showWhenRules.forEach((rule) => toggleRule(value, rule));
}

/**
 * Toggles a single conditional subtree's visibility from its controller value.
 * @param {object} value the current whole-config value
 * @param {object} rule a {path, controller, in} rule
 * @returns {void}
 */
function toggleRule(value, rule) {
  const node = document.querySelector(`#view [data-path="${rule.path}"]`);
  if (!node) return;
  const visible = rule.in.includes(valueAt(value, rule.controller));
  node.style.display = visible ? '' : 'none';
  node.toggleAttribute('hidden', !visible);
}

/**
 * Reads a value out of the config by a jedison instance path ('#/a/b').
 * @param {object} root the whole-config value
 * @param {string} path a '#/'-prefixed slash path
 * @returns {*} the value at the path, or undefined
 */
function valueAt(root, path) {
  const keys = path.replace(/^#\//, '').split('/');
  let cur = root;
  for (const key of keys) {
    if (cur == null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined;
    cur = Reflect.get(cur, key);
  }
  return cur;
}

// ---------- navigation (scroll anchors) ----------

/**
 * Rebuilds the sidebar as jump links to each top-level schema section.
 * @returns {void}
 */
function buildNav() {
  const host = $('nav');
  host.innerHTML = '';
  const props = schema.properties ?? {};
  Object.keys(props).forEach((key) => {
    const b = button(props[key].title ?? key, '');
    b.dataset.section = key;
    b.onclick = () => jumpTo(key);
    host.appendChild(b);
  });
}

/**
 * Scrolls a top-level section into view and closes the mobile drawer.
 * @param {string} key the top-level schema property key
 * @returns {void}
 */
function jumpTo(key) {
  closeDrawer();
  const node = document.querySelector(`#view [data-path="#/${key}"]`);
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- bank tools (constrained add / remove) ----------

/**
 * Reads the current banks map from the live editor value.
 * @returns {object} the banks map (empty object when none)
 */
function editorBanks() {
  return editor.getValue().banks ?? {};
}

/**
 * Rebuilds the bank toolbar: a Validate action, an add-bank control, and a
 * remove chip per configured bank.
 * @returns {void}
 */
function buildBankTools() {
  const host = $('bank-tools');
  host.innerHTML = '';
  const banks = schema.properties?.banks;
  if (!banks) return;
  host.appendChild(validateControl());
  host.appendChild(addBankControl(banks));
  const present = editorBanks();
  Object.keys(present).forEach((name) => host.appendChild(bankRemoveChip(name)));
}

/**
 * Builds the "Validate configuration" action.
 * @returns {HTMLDivElement} the validate control
 */
function validateControl() {
  const wrap = el('div', 'validate-tool');
  const btn = button('Validate configuration', 'btn ghost');
  btn.id = 'validate-btn';
  btn.onclick = validate;
  wrap.appendChild(btn);
  return wrap;
}

/**
 * Builds the constrained add-bank control: a select of not-yet-added bank ids
 * (from the schema's x-bank-options) plus an Add button.
 * @param {object} banks the banks (map) schema node
 * @returns {HTMLDivElement} the add-bank control
 */
function addBankControl(banks) {
  const wrap = el('div', 'add-bank');
  const sel = el('select');
  sel.id = 'add-bank-select';
  sel.setAttribute('aria-label', 'Select a bank to add');
  const ph = el('option', null, 'Add a bank…');
  ph.value = '';
  sel.appendChild(ph);
  addBankOptions(sel, banks);
  const add = button('+ Add bank', 'btn primary');
  add.id = 'add-bank-btn';
  add.onclick = () => { if (sel.value) addBank(sel.value); };
  wrap.append(sel, add);
  return wrap;
}

/**
 * Populates the add-bank select with supported bank ids not already present.
 * @param {HTMLSelectElement} sel the select to fill
 * @param {object} banks the banks (map) schema node
 * @returns {void}
 */
function addBankOptions(sel, banks) {
  const present = editorBanks();
  (banks['x-bank-options'] ?? [])
    .filter((id) => !Object.hasOwn(present, id))
    .forEach((id) => {
      const o = el('option', null, id);
      o.value = id;
      sel.appendChild(o);
    });
}

/**
 * Builds a remove chip for a configured bank.
 * @param {string} name the bank id
 * @returns {HTMLDivElement} the remove chip
 */
function bankRemoveChip(name) {
  const chip = el('div', 'bank-chip');
  chip.appendChild(el('span', 'bank-chip-name', name));
  const del = button('Remove', 'btn danger');
  del.dataset.removeBank = name;
  del.setAttribute('aria-label', `Remove ${name}`);
  del.onclick = () => removeBank(name);
  chip.appendChild(del);
  return chip;
}

/**
 * Adds a bank: snapshots the edited value, inserts an empty entry, re-renders.
 * @param {string} name the bank id to add
 * @returns {void}
 */
function addBank(name) {
  config = editor.getValue();
  config.banks = config.banks ?? {};
  if (!Object.hasOwn(config.banks, name)) config.banks[name] = {};
  render();
}

/**
 * Removes a bank: snapshots the edited value, deletes the entry, re-renders.
 * @param {string} name the bank id to remove
 * @returns {void}
 */
function removeBank(name) {
  config = editor.getValue();
  if (config.banks) delete config.banks[name];
  render();
}

// ---------- validate ----------

/**
 * Runs offline validation of the edited config against POST /api/validate and
 * reports the outcome in the status line and a toast.
 * @returns {Promise<void>} resolves when validation completes
 */
async function validate() {
  const btn = $('validate-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Validating…';
  try {
    const results = await api('/api/validate', {
      method: 'POST',
      body: JSON.stringify(editor.getValue()),
    });
    reportValidation(results);
  } catch (e) {
    setStatus(`❌ ${e.message}`, 'err');
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/**
 * Surfaces validation results, treating any `fail` entry as a problem.
 * @param {Array} results the /api/validate result list
 * @returns {void}
 */
function reportValidation(results) {
  const failures = (results ?? []).filter((r) => r.status === 'fail');
  if (failures.length === 0) {
    setStatus('✅ Configuration valid', 'ok');
    toast('Configuration valid', 'ok');
    return;
  }
  const msg = `${failures.length} problem${failures.length === 1 ? '' : 's'}: ${failures[0].message}`;
  setStatus(`❌ ${msg}`, 'err');
  toast(msg, 'err');
}

// ---------- save ----------

/**
 * Persists the whole config via PUT /api/config. Untouched secrets remain the
 * ******** mask and are restored server-side, so they round-trip untouched.
 * @returns {Promise<void>} resolves when saved
 */
async function save() {
  const btn = $('save');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  setStatus('Saving…', '');
  try {
    config = editor.getValue();
    await api('/api/config', { method: 'PUT', body: JSON.stringify(config) });
    setStatus('✅ Saved', 'ok');
    toast('Changes saved', 'ok');
  } catch (e) {
    setStatus(`❌ ${e.message}`, 'err');
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/**
 * Sets the status line text and severity class.
 * @param {string} text the message
 * @param {string} kind 'ok', 'err', or '' for neutral
 * @returns {void}
 */
function setStatus(text, kind) {
  const node = $('status');
  node.textContent = text;
  node.className = `status ${kind}`.trim();
}

/**
 * Shows an auto-dismissing toast notification.
 * @param {string} message text to display
 * @param {string} [kind] 'ok', 'err', or '' for neutral
 * @returns {void}
 */
function toast(message, kind) {
  const node = el('div', `toast ${kind ?? ''}`.trim(), message);
  $('toast').appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 250);
  }, 2600);
}

// ---------- mobile drawer ----------

/**
 * Opens the mobile navigation drawer and moves focus into it.
 * @returns {void}
 */
function openDrawer() {
  const app = $('app');
  if (app.classList.contains('nav-open')) return;
  app.classList.add('nav-open');
  $('menu').setAttribute('aria-expanded', 'true');
  $('main').inert = true;
  const first = $('nav').querySelector('button');
  if (first) first.focus();
}

/**
 * Closes the mobile navigation drawer, returning focus to the menu button.
 * @returns {void}
 */
function closeDrawer() {
  const app = $('app');
  const wasOpen = app.classList.contains('nav-open');
  app.classList.remove('nav-open');
  $('menu').setAttribute('aria-expanded', 'false');
  $('main').inert = false;
  if (wasOpen) $('menu').focus();
}

// ---------- wiring ----------

$('pw-btn').onclick = login;
$('pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
$('logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => ({}));
  location.reload();
};
$('save').onclick = save;
$('menu').onclick = openDrawer;
$('scrim').onclick = closeDrawer;
$('reload-btn').onclick = () => location.reload();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('app').classList.contains('nav-open')) closeDrawer();
});
// Reset the mobile drawer's inert/overlay state if the viewport grows to desktop
// while the drawer is open, so the main panel never gets stuck non-interactive.
matchMedia('(min-width: 761px)').addEventListener('change', (e) => {
  if (e.matches) closeDrawer();
});

// Boot the SPA. Top-level await (this file is loaded as an ES module via
// <script type="module">) so a failed initial auth/render rejects the module
// rather than leaving an unhandled floating promise — SonarCloud S7785.
await init();
