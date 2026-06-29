'use strict';
// Config Portal SPA — vanilla JS, responsive. Loads masked config, edits it,
// PUTs the whole object back. Secrets show as ******** and are preserved.
const $ = (id) => document.getElementById(id);
const SECTIONS = ['banks', 'actual', 'notifications', 'spendingWatch', 'categorization'];
let config = {};
let current = 'banks';

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  return res.status === 204 ? {} : res.json();
}

async function init() {
  const { authMode } = await api('/auth/mode');
  $('google-btn').classList.toggle('hidden', authMode === 'password');
  $('pw').classList.toggle('hidden', authMode === 'google');
  $('pw-btn').classList.toggle('hidden', authMode === 'google');
  $('login-hint').textContent = authMode === 'both' ? 'Sign in with Google, then password.' : 'Sign in to manage config.';
  try { await load(); } catch { $('login').classList.remove('hidden'); }
}

$('pw-btn').onclick = async () => {
  try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) }); await load(); }
  catch (e) { $('login-err').textContent = String(e.message); }
};
$('logout').onclick = async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); };
$('save').onclick = save;

async function load() {
  config = await api('/api/config');
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  buildNav(); render();
}

function buildNav() {
  const labels = { banks: '🏦 Banks', actual: '💰 Actual', notifications: '🔔 Alerts', spendingWatch: '👀 Watch', categorization: '🏷️ Categories' };
  ['nav', 'bottomnav'].forEach((id) => {
    $(id).innerHTML = '';
    SECTIONS.forEach((s) => { const b = document.createElement('button'); b.textContent = labels[s]; b.onclick = () => { current = s; render(); }; if (s === current) b.classList.add('active'); $(id).appendChild(b); });
  });
}

function render() {
  $('title').textContent = current;
  buildNav();
  if (current === 'banks') return renderBanks();
  $('view').innerHTML = '';
  fields($('view'), config[current] || (config[current] = {}), current);
}

function fields(host, obj, prefix) {
  Object.keys(obj).forEach((k) => {
    if (k.startsWith('_') || typeof obj[k] === 'object') return;
    host.appendChild(rowFor(obj, k, prefix + '.' + k));
  });
}

function rowFor(obj, key, label) {
  const row = document.createElement('div'); row.className = 'row';
  const l = document.createElement('label'); l.textContent = label;
  const i = document.createElement('input'); i.value = obj[key] == null ? '' : obj[key];
  i.oninput = () => { obj[key] = i.value; };
  row.append(l, i); return row;
}

function renderBanks() {
  const v = $('view'); v.innerHTML = '';
  Object.keys(config.banks || {}).forEach((name) => v.appendChild(bankCard(name)));
  const add = document.createElement('button'); add.className = 'btn primary'; add.textContent = '+ Add bank';
  add.onclick = () => { const n = prompt('Bank id (e.g. leumi)'); if (n) { (config.banks ||= {})[n] = { twoFactorAuth: false, daysBack: 14 }; render(); } };
  v.appendChild(add);
}

function bankCard(name) {
  const c = document.createElement('div'); c.className = 'card';
  const h = document.createElement('h3'); h.textContent = name;
  const del = document.createElement('button'); del.className = 'btn danger'; del.textContent = 'Remove';
  del.onclick = () => { delete config.banks[name]; render(); };
  h.appendChild(del); c.appendChild(h);
  fields(c, config.banks[name], name);
  return c;
}

async function save() {
  $('status').textContent = 'Saving…';
  try { await api('/api/config', { method: 'PUT', body: JSON.stringify(config) }); $('status').textContent = '✅ Saved'; }
  catch (e) { $('status').textContent = '❌ ' + e.message; }
}

init();
