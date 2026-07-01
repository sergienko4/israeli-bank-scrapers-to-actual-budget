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

let manifest = { sections: [], banks: [], bankRequirements: {} };
let config = {};
let current = '';

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
  const title = $('title');
  title.setAttribute('tabindex', '-1');
  title.focus();
}

/**
 * Persists the whole config via PUT /api/config.
 * @returns {Promise<void>} resolves when saved
 */
async function save() {
  const btn = $('save');
  const label = btn.textContent;
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
  }
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
  const required = manifest.bankRequirements?.[name]?.required || [];
  required.forEach((key) => {
    if (isBlank(bank[key])) out.push(`banks.${name}.${key}`);
  });
  (bank.targets || []).forEach((target, idx) => {
    if (isBlank(target.actualAccountId)) out.push(`banks.${name}.targets.${idx}.actualAccountId`);
  });
}

/**
 * Flags the given field paths as invalid: navigates to the banks section (so the
 * offending inputs are rendered), marks each, and focuses the first so a rejected
 * save lands the user on the field(s) to fix.
 * @param {string[]} paths dotted config paths to flag
 * @returns {void}
 */
function highlightInvalid(paths) {
  if (!paths.length) return;
  if (current !== 'banks') selectSection('banks');
  clearInvalid();
  const nodes = paths.map(markInvalidByPath).filter(Boolean);
  if (nodes[0]) nodes[0].focus();
}

/**
 * Clears any previously-flagged invalid controls in the current view.
 * @returns {void}
 */
function clearInvalid() {
  document.querySelectorAll('.invalid').forEach((node) => {
    node.classList.remove('invalid');
    node.removeAttribute('aria-invalid');
  });
}

/**
 * Marks the input at a dotted config path as invalid, if it is currently rendered.
 * @param {string} path dotted config path
 * @returns {HTMLElement|null} the flagged element, or null when not rendered
 */
function markInvalidByPath(path) {
  const node = document.querySelector(`[data-path="${path}"]`);
  if (!node) return null;
  node.classList.add('invalid');
  node.setAttribute('aria-invalid', 'true');
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
    render();
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
    setScalar(obj, field, i.value);
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
  i.value = obj[field.key] == null ? '' : String(obj[field.key]);
  i.oninput = () => {
    obj[field.key] = i.value;
  };
  const eye = button('', 'btn ghost reveal');
  eye.innerHTML = EYE_SVG;
  eye.setAttribute('aria-label', 'Show secret');
  eye.setAttribute('aria-pressed', 'false');
  eye.onclick = () => {
    const reveal = i.type === 'password';
    i.type = reveal ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(reveal));
    eye.setAttribute('aria-label', reveal ? 'Hide secret' : 'Show secret');
  };
  wrap.append(i, eye);
  return wrap;
}

/**
 * Coerces and stores a scalar value, dropping empty numbers.
 * @param {object} obj object
 * @param {object} field field
 * @param {string} raw raw input value
 * @returns {void}
 */
function setScalar(obj, field, raw) {
  if (field.kind === 'number') {
    if (raw === '') delete obj[field.key];
    else obj[field.key] = Number(raw);
    return;
  }
  obj[field.key] = raw;
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
    arr.push(field.fields ? {} : '');
    render();
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
    arr.splice(idx, 1);
    render();
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
    arr.push({});
    render();
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
  del.onclick = () => {
    arr.splice(idx, 1);
    render();
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
 * Renders the banks section: a card per bank plus an add-bank control.
 * @param {object} sec banks section descriptor
 * @param {HTMLElement} view container
 * @returns {void}
 */
function renderBanks(sec, view) {
  const banks = config.banks || (config.banks = {});
  Object.keys(banks).forEach((name) => view.appendChild(bankCard(sec, name)));
  view.appendChild(addBankControl(sec));
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
  head.appendChild(el('h3', null, name));
  const del = button('Remove', 'btn danger');
  del.dataset.removeBank = name;
  del.onclick = () => {
    delete config.banks[name];
    render();
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
    bank[sel.value] = defaultFor(fieldByKey(sec.bankFields, sel.value));
    render();
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
  if (field.kind === 'number') return 0;
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
    targets.push({ actualAccountId: '', accounts: 'all', reconcile: false });
    render();
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
  (sec.targetFields || []).forEach((f) =>
    row.appendChild(fieldNode(f, targets[idx], path)),
  );
  const del = button('Remove target', 'btn danger');
  del.onclick = () => {
    targets.splice(idx, 1);
    render();
  };
  row.appendChild(del);
  return row;
}

/**
 * Builds the "add a bank" dropdown + button from the supported bank list.
 * @param {object} sec banks section descriptor
 * @returns {HTMLDivElement} the add-bank control
 */
function addBankControl(sec) {
  const wrap = el('div', 'add-bank');
  const sel = el('select');
  sel.id = 'add-bank-select';
  sel.setAttribute('aria-label', 'Select a bank to add');
  const ph = el('option', null, 'Add a bank…');
  ph.value = '';
  sel.appendChild(ph);
  const existing = config.banks || {};
  (manifest.banks || [])
    .filter((b) => !existing[b])
    .forEach((b) => {
      const o = el('option', null, b);
      o.value = b;
      sel.appendChild(o);
    });
  const add = button('+ Add bank', 'btn primary');
  add.id = 'add-bank-btn';
  add.onclick = () => {
    if (sel.value) addBank(sel.value);
    else toast('Select a bank to add first', 'err');
  };
  wrap.append(sel, add);
  return wrap;
}

/**
 * Adds a bank, templating its required credential fields and one empty target.
 * @param {string} name bank id
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
  current = 'banks';
  render();
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
