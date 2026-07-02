'use strict';

// Config Portal SPA (vanilla JS, no build step). The entire UI is rendered from
// the server's Config Manifest (GET /api/manifest) over the live config
// (GET /api/config), so a new config field appears automatically with zero UI
// changes — the manifest is the single source of truth. Secrets are shown as
// ******** and preserved on save unless the user overwrites them.

const DOC_BASE =
  'https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/';

// Inline eye icon so the secret reveal toggle renders on every OS/browser
// (emoji glyphs are unavailable in some headless/server font sets).
const EYE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

// Sentinel the server sends for an existing secret and honours on save: an
// untouched masked field is re-sent unchanged so the stored secret is kept.
const MASK = '********';

let manifest = { sections: [], banks: [], bankRequirements: {} };
let config = {};
let current = '';
let bankSelected = '';
let bankQuery = '';

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
    const err = new Error(body.error || `HTTP ${res.status}`);
    if (Array.isArray(body.errors)) err.details = body.errors;
    throw err;
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

/**
 * Joins a dotted config path segment.
 * @param {string} prefix parent path
 * @param {string} key child key
 * @returns {string} joined path
 */
function joinPath(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}

/**
 * Escapes a dynamic value for safe interpolation into a quoted CSS attribute
 * selector, so a config key containing `"`, `\`, `]` or other special characters
 * cannot make querySelector throw a SyntaxError. Uses the platform CSS.escape
 * when available, with a minimal quote/backslash fallback for environments
 * (e.g. jsdom) that do not implement it.
 * @param {string} value the raw dynamic segment (e.g. a bank key or dotted path)
 * @returns {string} the escaped value, safe inside a double-quoted attribute selector
 */
function esc(value) {
  const str = String(value);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
  return str.replace(/["\\]/g, String.raw`\$&`);
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
  const mode = status.authMode || 'password';
  const needGoogle = mode !== 'password' && !status.google;
  // In `both` mode, sequence Google first: keep the password field hidden until
  // the Google factor is satisfied, so the user completes one step at a time.
  const needPassword = mode !== 'google' && !status.password && !needGoogle;
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
  const wasFocused = document.activeElement === btn;
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
    // Restore focus only when the login view is still shown (a failed attempt);
    // on success load() has already moved focus onto the app heading.
    if (wasFocused && !$('login').classList.contains('hidden')) restoreActionFocus(btn);
  }
}

/**
 * Loads the manifest + config and shows the app.
 * @returns {Promise<void>} resolves when rendered
 */
async function load() {
  manifest = await api('/api/manifest');
  config = await api('/api/config');
  current = manifest.sections[0]?.key || '';
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  render();
  focusApp();
}

/**
 * Moves keyboard focus onto the app's main heading after login so assistive
 * tech lands on the page content instead of the now-hidden login button.
 * @returns {void}
 */
function focusApp() {
  focusTitle();
}

/**
 * Makes the section heading programmatically focusable and moves focus to it, so
 * a re-render that rebuilds the view never drops keyboard focus to <body>
 * (WCAG 2.4.3) and screen readers announce the current section.
 * @returns {void}
 */
function focusTitle() {
  const title = $('title');
  title.setAttribute('tabindex', '-1');
  title.focus();
}

/**
 * Re-renders the current section, then restores keyboard focus to the first
 * control matching `selector` within the view, falling back to the heading when
 * that control no longer exists so focus is never lost to <body> (WCAG 2.4.3).
 * @param {string} selector CSS selector, evaluated inside #view, of the control
 *   to focus after the re-render
 * @returns {void}
 */
function renderFocus(selector) {
  render();
  const target = $('view').querySelector(selector);
  if (target && typeof target.focus === 'function') target.focus();
  else focusTitle();
}

/**
 * Restores keyboard focus after an async action re-enables its trigger button,
 * so disabling the focused button never strands focus on <body> (WCAG 2.4.3):
 * returns focus to the button when it is still present and enabled, otherwise to
 * the status region (made programmatically focusable) as a safe fallback.
 * @param {HTMLElement} btn the action button that was focused before disabling
 * @returns {void}
 */
function restoreActionFocus(btn) {
  if (btn && btn.isConnected && !btn.disabled) {
    btn.focus();
    return;
  }
  const status = $('status');
  status.setAttribute('tabindex', '-1');
  status.focus();
}

/**
 * Persists the whole config via PUT /api/config.
 * @returns {Promise<void>} resolves when saved
 */
async function save() {
  const btn = $('save');
  const label = btn.textContent;
  const wasFocused = document.activeElement === btn;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  $('status').textContent = 'Saving…';
  $('status').className = 'status';
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify(config) });
    $('status').textContent = '✅ Saved';
    $('status').className = 'status ok';
    toast('Changes saved', 'ok');
  } catch (e) {
    highlightInvalid(missingBankPaths());
    const lines = Array.isArray(e.details) && e.details.length ? e.details : [e.message];
    renderSaveError(lines);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    // A rejected save may have moved focus onto the first invalid field; only
    // rescue focus back to the button when nothing inside the view claimed it.
    if (wasFocused && !viewHasFocus()) restoreActionFocus(btn);
  }
}

/**
 * Whether keyboard focus currently rests on a control inside the rendered view,
 * used so a post-save focus restore does not steal focus from an invalid field
 * the save-failure highlighter just focused.
 * @returns {boolean} true when the active element is within #view
 */
function viewHasFocus() {
  const view = $('view');
  return Boolean(view) && view.contains(document.activeElement);
}

/**
 * Renders one or more save-failure reasons into the status bar as a readable
 * list plus a toast, instead of one opaque semicolon-joined line, so the user
 * can see exactly which field(s)/bank(s) the server rejected.
 * @param {string[]} lines human-readable failure reasons
 * @returns {void}
 */
function renderSaveError(lines) {
  const status = $('status');
  status.textContent = '';
  status.className = 'status err';
  status.appendChild(el('strong', null, '❌ Save failed:'));
  const list = el('ul', 'error-list');
  lines.forEach((line) => list.appendChild(el('li', null, line)));
  status.appendChild(list);
  const summary = lines.length > 1 ? `Save failed: ${lines.length} problems` : lines[0];
  toast(summary, 'err');
}

/**
 * Whether a value is missing for gating purposes: null, undefined, or blank.
 * @param {*} value candidate value
 * @returns {boolean} true when the value is null/undefined or whitespace-only
 */
function isBlank(value) {
  return value == null || String(value).trim() === '';
}

/**
 * Scans every configured bank for empty required credential fields and empty
 * target account ids, returning their dotted config paths so a save the server
 * rejected for missing values can point the user straight at the offenders.
 * @returns {string[]} dotted paths of empty required bank/target fields
 */
function missingBankPaths() {
  const paths = [];
  const banks = config.banks || {};
  Object.keys(banks).forEach((name) => collectBankMissing(name, banks[name], paths));
  return paths;
}

/**
 * Appends a bank's empty required-field and empty target-account paths to an
 * accumulator.
 * @param {string} name bank id
 * @param {object} bank bank config
 * @param {string[]} out accumulator of dotted paths
 * @returns {void}
 */
function collectBankMissing(name, bank, out) {
  const req = manifest.bankRequirements?.[name] ?? manifest.bankRequirements?.[name.toLowerCase()];
  const required = req?.required || [];
  required.forEach((key) => {
    if (isBlank(bank[key])) out.push(`banks.${name}.${key}`);
  });
  (bank.targets || []).forEach((target, idx) => {
    if (isBlank(target.actualAccountId)) out.push(`banks.${name}.targets.${idx}.actualAccountId`);
  });
}

/**
 * Flags rejected fields after a failed save: navigates to the banks section and
 * selects the FIRST offending bank so its inputs are rendered, marks that bank's
 * invalid fields, and focuses the first so the user lands on a field to fix. The
 * complete list of offending fields across every bank is shown in the save-error
 * status list, since only the selected bank's inputs are in the DOM to mark.
 * @param {string[]} paths dotted config paths to flag
 * @returns {void}
 */
function highlightInvalid(paths) {
  if (!paths.length) return;
  const bank = firstBankKey(paths);
  if (bank) bankSelected = bank;
  current = 'banks';
  render();
  clearInvalid();
  const firstInvalid = paths.map(markInvalidByPath).find(Boolean);
  if (firstInvalid) firstInvalid.focus();
}

/**
 * Returns the bank key named by the first `banks.<key>.…` path, so a rejected
 * save can select the offending bank whose fields must be rendered to be flagged.
 * @param {string[]} paths dotted config paths
 * @returns {string} the first bank key, or '' when no path targets a bank
 */
function firstBankKey(paths) {
  const hit = paths.find((path) => path.startsWith('banks.'));
  return hit ? hit.split('.')[1] : '';
}

/**
 * Clears any previously-flagged invalid controls in the current view.
 * @returns {void}
 */
function clearInvalid() {
  document.querySelectorAll('.invalid').forEach((node) => {
    node.classList.remove('invalid');
    node.removeAttribute('aria-invalid');
    node.removeAttribute('aria-describedby');
  });
}

/**
 * Marks the input at a dotted config path as invalid, if it is currently
 * rendered, and ties it to the save-error status list via aria-describedby so a
 * screen reader announces why the field was rejected (WCAG 3.3.1).
 * @param {string} path dotted config path
 * @returns {HTMLElement|null} the flagged element, or null when not rendered
 */
function markInvalidByPath(path) {
  const node = document.querySelector(`[data-path="${esc(path)}"]`);
  if (!node) return null;
  node.classList.add('invalid');
  node.setAttribute('aria-invalid', 'true');
  node.setAttribute('aria-describedby', 'status');
  return node;
}

/**
 * Shows an auto-dismissing toast notification.
 * @param {string} message text to display
 * @param {string} [kind] 'ok', 'err', or '' for neutral
 * @returns {void}
 */
function toast(message, kind) {
  const node = el('div', `toast ${kind || ''}`.trim(), message);
  $('toast').appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 250);
  }, 2600);
}

/**
 * Finds a section by key, falling back to the first section.
 * @param {string} key section key
 * @returns {object} the matching section
 */
function sectionByKey(key) {
  return manifest.sections.find((s) => s.key === key) || manifest.sections[0];
}

// ---------- navigation ----------

/**
 * Rebuilds the sidebar navigation from the manifest sections.
 * @returns {void}
 */
function buildNav() {
  const host = $('nav');
  host.innerHTML = '';
  manifest.sections.forEach((s) => {
    const label = `${s.icon || ''} ${s.label}`.trim();
    const b = button(label, s.key === current ? 'active' : '');
    b.dataset.section = s.key;
    if (s.key === current) b.setAttribute('aria-current', 'page');
    b.onclick = () => selectSection(s.key);
    host.appendChild(b);
  });
}

/**
 * Activates a section and closes the mobile drawer.
 * @param {string} key section key
 * @returns {void}
 */
function selectSection(key) {
  current = key;
  closeDrawer();
  render();
  focusTitle();
}

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

// ---------- render dispatch ----------

/**
 * Renders the current section by its structural kind.
 * @returns {void}
 */
function render() {
  const sec = sectionByKey(current);
  current = sec.key;
  $('title').textContent = sec.label;
  $('subtitle').textContent = sectionSubtitle(sec);
  $('status').textContent = '';
  $('status').className = 'status';
  buildNav();
  const view = $('view');
  view.innerHTML = '';
  if (sec.doc) view.appendChild(docLink(sec.doc));
  if (sec.kind === 'bankMap') {
    renderBanks(sec, view);
  } else if (sec.kind === 'list') {
    renderSectionList(sec, view);
  } else {
    renderObject(sec, view);
  }
}

/**
 * Builds a short contextual subtitle for the section header.
 * @param {object} sec section descriptor
 * @returns {string} subtitle text (may be empty)
 */
function sectionSubtitle(sec) {
  if (sec.kind === 'bankMap') {
    const n = Object.keys(config.banks || {}).length;
    return `${n} bank${n === 1 ? '' : 's'} configured`;
  }
  if (sec.kind === 'list') {
    const n = (config[sec.key] || []).length;
    return `${n} item${n === 1 ? '' : 's'}`;
  }
  return sec.help || '';
}

/**
 * Builds the "read the docs" link for a section.
 * @param {string} doc doc path under docs/
 * @returns {HTMLAnchorElement} the link
 */
function docLink(doc) {
  const a = el('a', 'doc', '📖 Read the documentation');
  a.href = DOC_BASE + doc;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = doc;
  return a;
}

// ---------- object sections ----------

/**
 * Renders an `object` section's fields. Section key '' targets the config root.
 * @param {object} sec section descriptor
 * @param {HTMLElement} view container
 * @returns {void}
 */
function renderObject(sec, view) {
  const obj = sec.key === '' ? config : (config[sec.key] || (config[sec.key] = {}));
  const panel = el('div', 'card panel');
  (sec.fields || [])
    .filter((f) => isFieldVisible(f, obj))
    .forEach((f) => panel.appendChild(fieldNode(f, obj, sec.key)));
  view.appendChild(panel);
}

/**
 * Reports whether a field renders, honoring an optional `showWhen` condition
 * that gates visibility on a sibling field's current value.
 * @param {object} field manifest field (may carry showWhen)
 * @param {object} obj object the field and its sibling controller live on
 * @returns {boolean} true when the field should render
 */
function isFieldVisible(field, obj) {
  const cond = field.showWhen;
  return !cond || cond.in.includes(obj[cond.field]);
}

/**
 * Renders a single field (leaf, group, or list) bound to an object.
 * @param {object} field manifest field
 * @param {object} obj object the field lives on
 * @param {string} prefix dotted path of the parent
 * @returns {HTMLElement} the rendered node
 */
function fieldNode(field, obj, prefix) {
  const path = joinPath(prefix, field.key);
  if (field.kind === 'group') return groupNode(field, obj, path);
  if (field.kind === 'list') return listFieldNode(field, obj, path);
  return rowNode(field, obj, path);
}

/**
 * Renders a nested group as a fieldset.
 * @param {object} field group field
 * @param {object} obj parent object
 * @param {string} path dotted path
 * @returns {HTMLFieldSetElement} the fieldset
 */
function groupNode(field, obj, path) {
  const sub = obj[field.key] || (obj[field.key] = {});
  const fs = el('fieldset', 'group');
  fs.dataset.path = path;
  fs.appendChild(el('legend', null, field.label));
  (field.fields || [])
    .filter((f) => isFieldVisible(f, sub))
    .forEach((f) => fs.appendChild(fieldNode(f, sub, path)));
  return fs;
}

/**
 * Renders a labelled input row for a leaf field.
 * @param {object} field leaf field
 * @param {object} obj object the field lives on
 * @param {string} path dotted path
 * @returns {HTMLDivElement} the row
 */
function rowNode(field, obj, path) {
  const row = el('div', 'row');
  const label = el('label', null, field.label + (field.required ? ' *' : ''));
  label.setAttribute('for', path);
  row.appendChild(label);
  const node = inputNode(field, obj, path);
  if (field.required) markRequired(node);
  row.appendChild(node);
  if (field.help) row.appendChild(el('small', 'help', field.help));
  return row;
}

/**
 * Flags the control inside a row as required for assistive tech, reaching the
 * inner input when the field renders inside a wrapper (e.g. a secret toggle).
 * @param {HTMLElement} node input/select element, or a wrapper containing one
 * @returns {void}
 */
function markRequired(node) {
  const input = node.matches('input, select') ? node : node.querySelector('input, select');
  if (input) input.setAttribute('aria-required', 'true');
}

/**
 * Builds the right input element for a leaf field's kind.
 * @param {object} field leaf field
 * @param {object} obj object the field lives on
 * @param {string} path dotted path
 * @returns {HTMLElement} the input element
 */
function inputNode(field, obj, path) {
  if (field.kind === 'boolean') return checkboxNode(field, obj, path);
  if (field.kind === 'select') return selectNode(field, obj, path);
  if (field.kind === 'secret') return secretNode(field, obj, path);
  return textNode(field, obj, path);
}

/**
 * Builds a checkbox bound to a boolean field.
 * @param {object} field field
 * @param {object} obj object
 * @param {string} path dotted path
 * @returns {HTMLInputElement} the checkbox
 */
function checkboxNode(field, obj, path) {
  const i = el('input');
  i.type = 'checkbox';
  i.id = path;
  i.dataset.path = path;
  i.checked = Boolean(obj[field.key]);
  i.onchange = () => {
    obj[field.key] = i.checked;
  };
  return i;
}

/**
 * Builds a select bound to an enum field.
 * @param {object} field field
 * @param {object} obj object
 * @param {string} path dotted path
 * @returns {HTMLSelectElement} the select
 */
function selectNode(field, obj, path) {
  const s = el('select');
  s.id = path;
  s.dataset.path = path;
  [''].concat(field.options || []).forEach((o) => {
    const op = el('option', null, o || '—');
    op.value = o;
    s.appendChild(op);
  });
  s.value = obj[field.key] == null ? '' : String(obj[field.key]);
  s.onchange = () => {
    obj[field.key] = s.value;
    renderFocus(`[data-path="${esc(path)}"]`);
  };
  return s;
}

/**
 * Maps a field kind to its native input type.
 * @param {string} kind field kind
 * @returns {string} the input type ('number', 'date', or 'text')
 */
function inputType(kind) {
  if (kind === 'number') return 'number';
  if (kind === 'date') return 'date';
  return 'text';
}

/**
 * Builds a text/number/date input bound to a scalar field.
 * @param {object} field field
 * @param {object} obj object
 * @param {string} path dotted path
 * @returns {HTMLInputElement} the input
 */
function textNode(field, obj, path) {
  const i = el('input');
  i.id = path;
  i.dataset.path = path;
  i.type = inputType(field.kind);
  if (field.min != null) i.min = String(field.min);
  if (field.max != null) i.max = String(field.max);
  i.value = obj[field.key] == null ? '' : String(obj[field.key]);
  i.oninput = () => {
    const invalid = setScalar(obj, field, i.value, i.validity.badInput);
    i.classList.toggle('invalid', invalid);
    if (invalid) i.setAttribute('aria-invalid', 'true');
    else i.removeAttribute('aria-invalid');
  };
  return i;
}

/**
 * Builds a masked secret input with a reveal toggle.
 * @param {object} field field
 * @param {object} obj object
 * @param {string} path dotted path
 * @returns {HTMLSpanElement} the wrapped input
 */
function secretNode(field, obj, path) {
  const wrap = el('span', 'secret');
  const i = el('input');
  i.id = path;
  i.dataset.path = path;
  i.type = 'password';
  i.autocomplete = 'off';
  const masked = obj[field.key] === MASK;
  if (masked) {
    i.value = '';
    i.placeholder = '•••••••• (unchanged)';
  } else {
    i.value = obj[field.key] == null ? '' : String(obj[field.key]);
  }
  i.oninput = () => {
    obj[field.key] = masked && i.value === '' ? MASK : i.value;
  };
  const eye = secretReveal(field, i);
  wrap.append(i, eye);
  // A masked field carries an explicit clear affordance plus a persistent,
  // announced hint — without them a stored secret can be changed but never
  // cleared, and the keep-on-blank cue vanishes on focus.
  if (masked) {
    const hint = secretHint(path);
    i.setAttribute('aria-describedby', hint.id);
    wrap.append(secretClear(field, obj, path), hint);
  }
  return wrap;
}

/**
 * Builds the reveal toggle for a secret input, labelled with the field name so a
 * card with several secrets exposes distinct controls to assistive tech
 * (WCAG 2.4.6 / 4.1.2) rather than a generic "Show secret".
 * @param {object} field the secret field descriptor (for its label)
 * @param {HTMLInputElement} input the secret input the toggle controls
 * @returns {HTMLButtonElement} the reveal toggle
 */
function secretReveal(field, input) {
  const eye = button('', 'btn ghost reveal');
  eye.innerHTML = EYE_SVG;
  eye.setAttribute('aria-label', `Show ${field.label}`);
  eye.setAttribute('aria-pressed', 'false');
  eye.onclick = () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(reveal));
    eye.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${field.label}`);
  };
  return eye;
}

/**
 * Builds the persistent "keep the current secret" hint for a masked field,
 * referenced via aria-describedby so the keep-on-blank behavior is announced
 * reliably instead of relying on a placeholder that disappears on focus.
 * @param {string} path dotted config path of the secret field
 * @returns {HTMLElement} the hint element (id = `${path}-hint`)
 */
function secretHint(path) {
  const hint = el('small', 'secret-hint', 'Leave blank to keep the current secret.');
  hint.id = `${path}-hint`;
  return hint;
}

/**
 * Builds a clear button for a masked secret, letting the user erase a stored
 * value: it writes a real empty string (not the MASK sentinel the server maps
 * back to the existing secret) and re-renders so the field becomes a normal
 * empty input that persists as cleared.
 * @param {object} field the secret field descriptor (for its label)
 * @param {object} obj the object holding the secret value
 * @param {string} path dotted config path of the secret field
 * @returns {HTMLButtonElement} the clear button
 */
function secretClear(field, obj, path) {
  const clear = button('✕', 'btn ghost secret-clear');
  clear.setAttribute('aria-label', `Clear ${field.label}`);
  clear.onclick = () => {
    obj[field.key] = '';
    renderFocus(`[data-path="${esc(path)}"]`);
  };
  return clear;
}

/**
 * Coerces and stores a scalar value. Empty numbers are dropped; a non-empty
 * invalid number (bad input state or non-finite) is rejected — the key is
 * removed rather than persisted as NaN (which JSON serializes to null).
 * @param {object} obj object
 * @param {object} field field
 * @param {string} raw raw input value
 * @param {boolean} badInput whether the numeric input element reports bad input
 * @returns {boolean} true when a non-empty numeric input was rejected as invalid
 */
function setScalar(obj, field, raw, badInput) {
  if (field.kind !== 'number') {
    obj[field.key] = raw;
    return false;
  }
  if (raw === '') {
    delete obj[field.key];
    return false;
  }
  const num = Number(raw);
  if (badInput || !Number.isFinite(num)) {
    delete obj[field.key];
    return true;
  }
  obj[field.key] = num;
  return false;
}

// ---------- list fields (scalar lists + object lists) ----------

/**
 * Renders a list field: object items when `fields` is present, else strings.
 * @param {object} field list field
 * @param {object} obj parent object
 * @param {string} path dotted path
 * @returns {HTMLDivElement} the list editor
 */
function listFieldNode(field, obj, path) {
  const arr = obj[field.key] || (obj[field.key] = []);
  const wrap = el('div', 'list');
  wrap.dataset.path = path;
  wrap.appendChild(el('div', 'list-head', field.label));
  if (field.help) wrap.appendChild(el('small', 'help', field.help));
  arr.forEach((_, idx) =>
    wrap.appendChild(listItemNode(field, arr, idx, `${path}.${idx}`)),
  );
  const add = button(`+ Add ${field.label}`, 'btn');
  add.dataset.add = path;
  add.onclick = () => {
    const idx = arr.length;
    arr.push(field.fields ? {} : '');
    const p = esc(`${path}.${idx}`);
    renderFocus(`[data-path="${p}"], [data-path^="${p}."]`);
  };
  wrap.appendChild(add);
  return wrap;
}

/**
 * Renders one list item (object sub-fields or a single string input).
 * @param {object} field list field
 * @param {Array} arr backing array
 * @param {number} idx item index
 * @param {string} path dotted path
 * @returns {HTMLDivElement} the item row
 */
function listItemNode(field, arr, idx, path) {
  const row = el('div', 'list-item');
  if (field.fields) {
    field.fields.forEach((sub) => row.appendChild(fieldNode(sub, arr[idx], path)));
  } else {
    row.appendChild(scalarItemInput(field, arr, idx, path));
  }
  const del = button('✕', 'btn danger');
  del.setAttribute('aria-label', `Remove ${field.label} ${idx + 1}`);
  del.onclick = () => {
    if (!confirm(`Remove ${field.label} ${idx + 1}?`)) return;
    arr.splice(idx, 1);
    renderFocus(`[data-add="${esc(path.slice(0, path.lastIndexOf('.')))}"]`);
  };
  row.appendChild(del);
  return row;
}

/**
 * Builds a text input bound to a string list element.
 * @param {object} field the list field (for an accessible name)
 * @param {Array} arr backing array
 * @param {number} idx element index
 * @param {string} path dotted path
 * @returns {HTMLInputElement} the input
 */
function scalarItemInput(field, arr, idx, path) {
  const i = el('input');
  i.type = 'text';
  i.dataset.path = path;
  i.setAttribute('aria-label', `${field.label} ${idx + 1}`);
  i.value = arr[idx] == null ? '' : String(arr[idx]);
  i.oninput = () => {
    arr[idx] = i.value;
  };
  return i;
}

// ---------- list sections (e.g. spendingWatch) ----------

/**
 * Renders a `list` section as a list of item cards.
 * @param {object} sec section descriptor
 * @param {HTMLElement} view container
 * @returns {void}
 */
function renderSectionList(sec, view) {
  const arr = config[sec.key] || (config[sec.key] = []);
  arr.forEach((_, idx) => view.appendChild(listCard(sec, arr, idx)));
  const add = button(`+ Add ${sec.label}`, 'btn primary');
  add.dataset.add = sec.key;
  add.onclick = () => {
    const idx = arr.length;
    arr.push({});
    const it = esc(`${sec.key}.${idx}`);
    renderFocus(`[data-item="${it}"] input, [data-item="${it}"] select, [data-item="${it}"] textarea`);
  };
  view.appendChild(add);
}

/**
 * Renders one card for a `list` section item.
 * @param {object} sec section descriptor
 * @param {Array} arr backing array
 * @param {number} idx item index
 * @returns {HTMLDivElement} the card
 */
function listCard(sec, arr, idx) {
  const card = el('div', 'card');
  card.dataset.item = `${sec.key}.${idx}`;
  const head = el('div', 'card-head');
  head.appendChild(el('h3', null, `${sec.label} ${idx + 1}`));
  const del = button('Remove', 'btn danger');
  del.setAttribute('aria-label', `Remove ${sec.label} ${idx + 1}`);
  del.onclick = () => {
    if (!confirm(`Remove ${sec.label} ${idx + 1}?`)) return;
    arr.splice(idx, 1);
    renderFocus(`[data-add="${esc(sec.key)}"]`);
  };
  head.appendChild(del);
  card.appendChild(head);
  (sec.itemFields || []).forEach((f) =>
    card.appendChild(fieldNode(f, arr[idx], `${sec.key}.${idx}`)),
  );
  return card;
}

// ---------- banks (bankMap) ----------

/**
 * Renders the banks section as a searchable master–detail: a bounded, scrollable
 * catalog list (added banks marked ✓, others addable) beside an editor for the
 * one selected bank. Normalizes the selection so the first configured bank is
 * auto-selected on entry and re-selected after a removal.
 * @param {object} sec banks section descriptor
 * @param {HTMLElement} view container
 * @returns {void}
 */
function renderBanks(sec, view) {
  const banks = config.banks || (config.banks = {});
  if (!Object.hasOwn(banks, bankSelected)) bankSelected = Object.keys(banks)[0] || '';
  const wrap = el('div', 'banks');
  wrap.append(bankMasterPanel(sec), bankDetailPanel(sec));
  view.appendChild(wrap);
}

/**
 * Builds the master panel: a labelled search box over a bounded, scrollable list
 * of catalog rows. Typing re-renders only the row list, preserving search focus.
 * @param {object} sec banks section descriptor
 * @returns {HTMLDivElement} the master panel
 */
function bankMasterPanel(sec) {
  const master = el('div', 'bank-master');
  const search = el('input', 'bank-search');
  search.id = 'bank-search';
  search.type = 'search';
  search.placeholder = 'Search banks…';
  search.setAttribute('aria-label', 'Search banks');
  search.value = bankQuery;
  const status = el('p', 'bank-list-status visually-hidden');
  status.id = 'bank-list-status';
  status.setAttribute('aria-live', 'polite');
  const list = el('ul', 'bank-list');
  list.setAttribute('aria-label', 'Banks');
  search.oninput = () => {
    bankQuery = search.value;
    renderBankRows(list, sec);
  };
  renderBankRows(list, sec);
  master.append(search, status, list);
  return master;
}

/**
 * Rebuilds the catalog row list from the current search filter, one `<li>` per
 * matching bank id, showing an explicit empty-result row when nothing matches and
 * announcing the visible count on the polite live region for screen readers.
 * @param {HTMLUListElement} list the row container to fill
 * @param {object} sec banks section descriptor
 * @returns {void}
 */
function renderBankRows(list, sec) {
  list.textContent = '';
  const ids = filterBankIds();
  ids.forEach((id) => {
    const li = el('li');
    li.appendChild(bankRow(sec, id));
    list.appendChild(li);
  });
  if (!ids.length) list.appendChild(el('li', 'bank-empty-row', 'No banks match your search.'));
  announceBankCount(ids.length);
}

/**
 * Announces how many catalog rows are visible on the polite live region so a
 * screen-reader user hears the result of a search that changed the list (WCAG
 * 4.1.3). No-op before the region is mounted (initial off-DOM build).
 * @param {number} count number of visible rows
 * @returns {void}
 */
function announceBankCount(count) {
  const status = document.getElementById('bank-list-status');
  if (!status) return;
  const noun = count === 1 ? 'bank matches' : 'banks match';
  status.textContent = `${count} ${noun} your search.`;
}

/**
 * Builds one interactive catalog row: an added bank selects itself for review;
 * an addable bank is templated and then selected.
 * @param {object} sec banks section descriptor
 * @param {string} id catalog bank id, or a legacy config key
 * @returns {HTMLButtonElement} the row button
 */
function bankRow(sec, id) {
  const key = configKeyForBank(id);
  const selected = Boolean(key) && key === bankSelected;
  const b = button('', bankRowClass(Boolean(key), selected));
  b.dataset.bankRow = id;
  if (key) b.dataset.bankAdded = 'true';
  if (selected) b.setAttribute('aria-current', 'true');
  b.append(el('span', 'bank-row-name', bankDisplayName(id)), bankRowStatus(Boolean(key)));
  b.onclick = () => selectBankRow(id, key);
  return b;
}

/**
 * Composes a row's class list from its added and selected states.
 * @param {boolean} added whether the bank is already configured
 * @param {boolean} selected whether the row is the active selection
 * @returns {string} the space-separated class list
 */
function bankRowClass(added, selected) {
  const base = added ? 'bank-row added' : 'bank-row addable';
  return selected ? `${base} active` : base;
}

/**
 * Builds a row's status badge, pairing an icon with visually-hidden text so the
 * added/addable state is conveyed without relying on color alone.
 * @param {boolean} added whether the bank is already configured
 * @returns {HTMLSpanElement} the status badge
 */
function bankRowStatus(added) {
  const status = el('span', 'bank-row-status');
  const glyph = el('span', null, added ? '✓' : '+');
  glyph.setAttribute('aria-hidden', 'true');
  status.append(glyph, el('span', 'visually-hidden', added ? 'added' : 'add'));
  return status;
}

/**
 * Selects a catalog row, adding the bank first when it is not yet configured,
 * then re-renders so the detail pane shows that bank.
 * @param {string} id catalog bank id, or a legacy config key
 * @param {string} [key] the existing config key when the bank is already added
 * @returns {void}
 */
function selectBankRow(id, key) {
  if (key) {
    bankSelected = key;
  } else {
    addBank(id);
    bankSelected = id;
  }
  render();
  focusBankDetail();
}

/**
 * Moves focus into the detail pane after a bank select/add/remove re-render —
 * onto the first editable control, or the search box when no bank is selected —
 * so keyboard and screen-reader users are never dropped to <body> (WCAG 2.4.3),
 * and reveals the pane so a tapped bank is visible on a narrow single-column
 * layout (where the detail renders below the list).
 * @returns {void}
 */
function focusBankDetail() {
  const detail = document.querySelector('.bank-detail');
  const field = detail?.querySelector('input, select, textarea');
  const target = field || document.getElementById('bank-search');
  if (!target) return;
  if (detail) revealDetail(detail);
  target.focus();
}

/**
 * Scrolls the detail pane into view, tolerating environments (jsdom) where
 * scrollIntoView is unavailable or unimplemented.
 * @param {HTMLElement} detail the detail pane element
 * @returns {void}
 */
function revealDetail(detail) {
  if (typeof detail.scrollIntoView !== 'function') return;
  try {
    detail.scrollIntoView({ block: 'nearest' });
  } catch {
    // jsdom stubs scrollIntoView as unimplemented — safe to ignore in tests.
  }
}

/**
 * Builds the detail pane: the selected bank's editor, or an empty-state prompt.
 * @param {object} sec banks section descriptor
 * @returns {HTMLDivElement} the detail pane
 */
function bankDetailPanel(sec) {
  const detail = el('div', 'bank-detail');
  if (bankSelected && Object.hasOwn(config.banks || {}, bankSelected)) {
    detail.appendChild(bankCard(sec, bankSelected));
  } else {
    detail.appendChild(el('div', 'bank-empty',
      'No bank selected — choose a bank to review it, or pick one to add.'));
  }
  return detail;
}

/**
 * Returns the bank ids to show in the master list: the full catalog plus any
 * legacy config keys that match no catalog id, narrowed by the case-insensitive
 * search query.
 * @returns {string[]} the visible row ids
 */
function filterBankIds() {
  const query = bankQuery.trim().toLowerCase();
  const ids = (manifest.banks || []).concat(orphanBankKeys());
  return ids.filter((id) => id.toLowerCase().includes(query));
}

/**
 * Returns the configured bank keys that match no catalog id (legacy/unknown
 * banks), so they stay reachable and removable from the list.
 * @returns {string[]} orphan config keys
 */
function orphanBankKeys() {
  const catalog = manifest.banks || [];
  return Object.keys(config.banks || {}).filter(
    (key) => !catalog.includes(key.toLowerCase()),
  );
}

/**
 * Returns the actual config key backing a catalog id, matched case-insensitively
 * so a camelCase alias (e.g. `oneZero`) resolves to its lowercase catalog id.
 * @param {string} id catalog bank id, or a legacy config key
 * @returns {string|undefined} the config key, or undefined when not configured
 */
function configKeyForBank(id) {
  return Object.keys(config.banks || {}).find((key) => key.toLowerCase() === id.toLowerCase());
}

/**
 * The human-facing label for a bank id, taken from the manifest's per-bank
 * requirements, with the raw id as a fallback for unknown/legacy keys.
 * @param {string} id bank id (catalog id or config key)
 * @returns {string} the display name
 */
function bankDisplayName(id) {
  const req = manifest.bankRequirements?.[id] ?? manifest.bankRequirements?.[id.toLowerCase()];
  return req?.displayName || id;
}

/**
 * Renders one bank card with its present fields, an add-field menu, and targets.
 * @param {object} sec banks section descriptor
 * @param {string} name bank id
 * @returns {HTMLDivElement} the bank card
 */
function bankCard(sec, name) {
  const card = el('div', 'card');
  card.dataset.bank = name;
  const head = el('div', 'card-head');
  head.appendChild(el('h3', null, bankDisplayName(name)));
  const del = button('Remove', 'btn danger');
  del.dataset.removeBank = name;
  del.onclick = () => {
    if (!confirm(`Remove ${bankDisplayName(name)} and its saved credentials and targets?`)) return;
    delete config.banks[name];
    render();
    focusBankDetail();
  };
  head.appendChild(del);
  card.appendChild(head);
  const bank = config.banks[name];
  presentBankFields(sec, bank).forEach((f) =>
    card.appendChild(fieldNode(f, bank, `banks.${name}`)),
  );
  card.appendChild(addFieldControl(sec, bank, name));
  card.appendChild(targetsEditor(sec, bank, name));
  return card;
}

/**
 * The bank catalog fields currently present on a bank.
 * @param {object} sec banks section descriptor
 * @param {object} bank bank config
 * @returns {Array} present bank fields
 */
function presentBankFields(sec, bank) {
  return (sec.bankFields || []).filter((f) =>
    Object.hasOwn(bank, f.key),
  );
}

/**
 * Builds a dropdown of catalog fields not yet present on the bank.
 * @param {object} sec banks section descriptor
 * @param {object} bank bank config
 * @param {string} name bank id
 * @returns {HTMLDivElement} the add-field control
 */
function addFieldControl(sec, bank, name) {
  const wrap = el('div', 'add-field');
  const missing = (sec.bankFields || []).filter(
    (f) => !Object.hasOwn(bank, f.key),
  );
  if (!missing.length) return wrap;
  const sel = el('select');
  sel.dataset.addField = name;
  sel.setAttribute('aria-label', `Add a field to ${name}`);
  const ph = el('option', null, '+ Add field…');
  ph.value = '';
  sel.appendChild(ph);
  missing.forEach((f) => {
    const o = el('option', null, f.label);
    o.value = f.key;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    if (!sel.value) return;
    const added = sel.value;
    bank[added] = defaultFor(fieldByKey(sec.bankFields, added));
    const p = esc(`banks.${name}.${added}`);
    renderFocus(`[data-path="${p}"]`);
  };
  wrap.appendChild(sel);
  return wrap;
}

/**
 * Finds a field by key in a field list.
 * @param {Array} fields field list
 * @param {string} key field key
 * @returns {object} the field
 */
function fieldByKey(fields, key) {
  return (fields || []).find((f) => f.key === key);
}

/**
 * Default value for a freshly-added field of a given kind.
 * @param {object} field field
 * @returns {boolean|number|string} default value
 */
function defaultFor(field) {
  if (!field) return '';
  if (field.kind === 'boolean') return false;
  if (field.kind === 'number') return field.min == null ? 0 : field.min;
  return '';
}

/**
 * Renders the per-bank Actual targets editor.
 * @param {object} sec banks section descriptor
 * @param {object} bank bank config
 * @param {string} name bank id
 * @returns {HTMLDivElement} the targets editor
 */
function targetsEditor(sec, bank, name) {
  const wrap = el('div', 'targets');
  wrap.appendChild(el('h4', null, 'Targets'));
  const targets = bank.targets || (bank.targets = []);
  targets.forEach((_, idx) =>
    wrap.appendChild(targetRow(sec, targets, idx, `banks.${name}.targets.${idx}`)),
  );
  const add = button('+ Add target', 'btn');
  add.dataset.addTarget = name;
  add.onclick = () => {
    const idx = targets.length;
    targets.push({ actualAccountId: '', accounts: 'all', reconcile: false });
    const t = esc(`banks.${name}.targets.${idx}`);
    renderFocus(`[data-target="${t}"] input, [data-target="${t}"] select`);
  };
  wrap.appendChild(add);
  return wrap;
}

/**
 * Renders one target row inside a bank card.
 * @param {object} sec banks section descriptor
 * @param {Array} targets backing array
 * @param {number} idx target index
 * @param {string} path dotted path
 * @returns {HTMLDivElement} the target row
 */
function targetRow(sec, targets, idx, path) {
  const row = el('div', 'card target');
  row.dataset.target = path;
  row.appendChild(el('h4', 'target-head', `Target ${idx + 1}`));
  (sec.targetFields || []).forEach((f) =>
    row.appendChild(fieldNode(f, targets[idx], path)),
  );
  const del = button('Remove target', 'btn danger');
  del.setAttribute('aria-label', `Remove target ${idx + 1}`);
  del.onclick = () => {
    if (!confirm(`Remove target ${idx + 1}?`)) return;
    targets.splice(idx, 1);
    renderFocus(`[data-add-target="${esc(path.split('.')[1])}"]`);
  };
  row.appendChild(del);
  return row;
}

/**
 * Adds a bank, templating its required credential fields and one empty target.
 * The caller is responsible for selecting it and re-rendering.
 * @param {string} name canonical bank id
 * @returns {void}
 */
function addBank(name) {
  const req = manifest.bankRequirements?.[name] || {};
  const bank = {
    daysBack: 14,
    twoFactorAuth: false,
    targets: [{ actualAccountId: '', accounts: 'all', reconcile: false }],
  };
  (req.required || []).forEach((k) => {
    if (!(k in bank)) bank[k] = '';
  });
  (config.banks || (config.banks = {}))[name] = bank;
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
