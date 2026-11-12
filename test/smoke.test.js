'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'boss@example.test', password: 'Bootstrap-Pass-123', name: 'Boss Person' };
const NEWPW = 'correct horse battery staple';
let proc, dataDir;

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, { body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET') { h['Content-Type'] = h['Content-Type'] || 'application/json'; if (this.csrf && !('X-CSRF-Token' in h)) h['X-CSRF-Token'] = this.csrf; }
    const res = await fetch(BASE + url, { method, headers: h, body: method === 'GET' ? undefined : (raw ? body : JSON.stringify(body || {})), redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0].startsWith('sid=') && sc.split(';')[0] !== 'sid=' ? sc.split(';')[0] : '';
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, headers: res.headers, text, json };
  }
  async login(email, password) {
    const r = await this.req('POST', '/api/login', { body: { email, password } });
    if (r.status === 200) { const me = await this.req('GET', '/api/me'); this.csrf = me.json ? me.json.csrf : ''; }
    return r;
  }
  async me() { const r = await this.req('GET', '/api/me'); if (r.json && r.json.csrf) this.csrf = r.json.csrf; return r; }
}

function rawGet(rawPath) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: rawPath, method: 'GET' }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, text: d }));
    });
    r.on('error', reject); r.end();
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_ENV: 'test', LOGIN_IP_LIMIT: '10000', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: ADMIN.name },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d)); proc.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start:\n' + out);
});
after(() => { if (proc) proc.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

const state = {};

test('health and public surface', async () => {
  const c = new Client();
  assert.equal((await c.req('GET', '/healthz')).status, 200);
  const login = await c.req('GET', '/login.html');
  assert.equal(login.status, 200);
  assert.match(login.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(login.headers.get('x-frame-options'), 'DENY');
  assert.equal((await c.req('GET', '/assets/brand.css')).status, 200);
  assert.equal((await c.req('GET', '/assets/logo.svg')).status, 200);
  for (const f of ['RocGrotesk-Bold.otf', 'RocGrotesk-CondensedBold.otf', 'PTSerif-Regular.ttf', 'SpaceMono-Regular.ttf']) {
    const r = await c.req('GET', '/assets/fonts/' + f);
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get('content-type'), /^font\//, f);
  }
  assert.equal((await c.req('GET', '/assets/topo.svg')).status, 200);
  assert.equal((await c.req('GET', '/assets/favicon.svg')).status, 200);
  // browsers can reuse unchanged brand files
  const css = await fetch(BASE + '/assets/brand.css');
  const etag = css.headers.get('etag');
  assert.ok(etag, 'brand.css has an ETag');
  assert.equal((await fetch(BASE + '/assets/brand.css', { headers: { 'If-None-Match': etag } })).status, 304);
  // large assets are compressed for browsers that accept it
  const gz = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/assets/brand.css', headers: { 'Accept-Encoding': 'gzip' } }, (res) => { res.resume(); resolve(res.headers['content-encoding']); }).on('error', reject);
  });
  assert.equal(gz, 'gzip');
});

test('signed-out visitors are sent to login and APIs say 401', async () => {
  const c = new Client();
  for (const p of ['/', '/ideas.html', '/tools/certificates/', '/admin/users.html', '/index.js', '/server.js', '/portal.db']) {
    const r = await c.req('GET', p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), '/login.html', p);
  }
  assert.equal((await c.req('GET', '/api/me')).status, 401);
  assert.equal((await c.req('GET', '/api/ideas')).status, 401);
  assert.equal((await c.req('GET', '/api/admin/users')).status, 401);
});

test('bad logins get one generic message', async () => {
  const c = new Client();
  const a = await c.login('nobody@example.test', 'whatever-pass-1234');
  const b = await c.login(ADMIN.email, 'wrong-password-123');
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  assert.equal((await c.req('POST', '/api/login', { body: {} })).status, 401);
});

test('bootstrap supervisor must change password before anything else', async () => {
  const c = new Client();
  const r = await c.login(ADMIN.email, ADMIN.password);
  assert.equal(r.status, 200);
  assert.equal(r.json.mustChange, true);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  assert.match(r.headers.get('set-cookie'), /SameSite=Strict/);
  const home = await c.req('GET', '/');
  assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/change-password.html');
  assert.equal((await c.req('GET', '/change-password.html')).status, 200);
  const api = await c.req('GET', '/api/ideas');
  assert.equal(api.status, 403); assert.equal(api.json.error, 'password_change_required');

  assert.equal((await c.req('POST', '/api/change-password', { body: { current: 'nope-nope-nope', next: NEWPW } })).status, 400);
  assert.equal((await c.req('POST', '/api/change-password', { body: { current: ADMIN.password, next: 'short' } })).status, 400);
  assert.equal((await c.req('POST', '/api/change-password', { body: { current: ADMIN.password, next: 'passwordpassword' } })).status, 400);
  assert.equal((await c.req('POST', '/api/change-password', { body: { current: ADMIN.password, next: NEWPW } })).status, 200);
  assert.equal((await c.req('GET', '/')).status, 200);
  assert.equal((await c.req('GET', '/api/ideas')).status, 200);
});

test('CSRF, content-type and origin checks on writes', async () => {
  const c = new Client();
  await c.login(ADMIN.email, NEWPW);
  const body = { title: 'Test idea', details: 'x' };
  assert.equal((await c.req('POST', '/api/ideas', { body, headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await c.req('POST', '/api/ideas', { body, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await c.req('POST', '/api/ideas', { body, headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await c.req('POST', '/api/ideas', { body: 'title=x', raw: true, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
  assert.equal((await c.req('POST', '/api/ideas', { body, headers: { Origin: BASE } })).status, 201);
});

test('supervisor can add staff; duplicates and bad input are refused', async () => {
  const c = new Client();
  await c.login(ADMIN.email, NEWPW);
  const cw = await c.req('POST', '/api/admin/users', { body: { name: 'Casey Worker', email: 'Casey@Example.test', role: 'caseworker' } });
  assert.equal(cw.status, 201);
  assert.equal(cw.json.email, 'casey@example.test');
  assert.equal(cw.json.tempPassword.length, 14);
  state.cw = cw.json;
  // a chaplain must belong to a facility
  assert.equal((await c.req('POST', '/api/admin/users', { body: { name: 'No Facility', email: 'nofac@example.test', role: 'chaplain' } })).status, 400);
  const ch = await c.req('POST', '/api/admin/users', { body: { name: 'Chip Chaplain', email: 'chip@example.test', role: 'chaplain', facility: 'Test Facility' } });
  assert.equal(ch.status, 201); state.ch = ch.json;
  assert.equal((await c.req('POST', '/api/admin/users', { body: { name: 'Dup', email: 'casey@example.test', role: 'caseworker' } })).status, 409);
  assert.equal((await c.req('POST', '/api/admin/users', { body: { name: 'Bad', email: 'not-an-email', role: 'caseworker' } })).status, 400);
  assert.equal((await c.req('POST', '/api/admin/users', { body: { name: 'Bad', email: 'x@example.test', role: 'god' } })).status, 400);
  const list = await c.req('GET', '/api/admin/users');
  assert.equal(list.json.users.length, 3);
  assert.ok(!JSON.stringify(list.json).includes('scrypt'), 'password hashes must never be returned');
});

test('role guards: caseworker', async () => {
  const c = new Client();
  assert.equal((await c.login(state.cw.email, state.cw.tempPassword)).json.mustChange, true);
  assert.equal((await c.req('POST', '/api/change-password', { body: { current: state.cw.tempPassword, next: NEWPW + '-cw' } })).status, 200);
  assert.equal((await c.req('GET', '/tools/certificates/')).status, 200);
  assert.equal((await c.req('GET', '/tools/certificates/certificate.js')).status, 200);
  const bgSvg = await c.req('GET', '/tools/certificates/certificate-bg.svg');
  assert.equal(bgSvg.status, 200);
  assert.match(bgSvg.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal((await c.req('GET', '/tools/chapel-calendar/')).status, 403);
  assert.equal((await c.req('GET', '/tools/nope/')).status, 403);
  assert.equal((await c.req('GET', '/admin/users.html')).status, 403);
  assert.equal((await c.req('GET', '/admin/users.js')).status, 403);
  assert.equal((await c.req('GET', '/api/admin/users')).status, 403);
  assert.equal((await c.req('POST', '/api/admin/users', { body: { name: 'X', email: 'x@example.test', role: 'supervisor' } })).status, 403);
  assert.equal((await c.req('POST', '/api/admin/users/1/role', { body: { role: 'caseworker' } })).status, 403);
  const me = await c.me();
  assert.deepEqual(me.json.tools.map((t) => t.id).sort(), ['certificates', 'ideas', 'reentry-report']);
});

test('role guards: chaplain', async () => {
  const c = new Client();
  await c.login(state.ch.email, state.ch.tempPassword);
  await c.req('POST', '/api/change-password', { body: { current: state.ch.tempPassword, next: NEWPW + '-ch' } });
  assert.equal((await c.req('GET', '/tools/chapel-calendar/')).status, 200);
  assert.equal((await c.req('GET', '/tools/certificates/')).status, 403);
  assert.equal((await c.req('GET', '/tools/certificates/certificate-bg.svg')).status, 403);
  assert.equal((await c.req('GET', '/admin/users.html')).status, 403);
});

test('shortcut ideas: staff see only their own, supervisor sees all and triages', async () => {
  const cw = new Client(), ch = new Client(), sup = new Client();
  await cw.login(state.cw.email, NEWPW + '-cw');
  await ch.login(state.ch.email, NEWPW + '-ch');
  await sup.login(ADMIN.email, NEWPW);
  assert.equal((await cw.req('POST', '/api/ideas', { body: { title: 'ab' } })).status, 400);
  assert.equal((await cw.req('POST', '/api/ideas', { body: { title: 'Monthly rosters', details: '<script>alert(1)</script>' } })).status, 201);
  const mine = await cw.req('GET', '/api/ideas');
  assert.equal(mine.json.ideas.length, 1);
  assert.equal(mine.json.canManage, false);
  assert.equal((await ch.req('GET', '/api/ideas')).json.ideas.length, 0);
  const all = await sup.req('GET', '/api/ideas');
  assert.ok(all.json.ideas.length >= 2);
  assert.equal(all.json.canManage, true);
  const id = mine.json.ideas[0].id;
  assert.equal((await cw.req('POST', `/api/admin/ideas/${id}/status`, { body: { status: 'done' } })).status, 403);
  assert.equal((await sup.req('POST', `/api/admin/ideas/${id}/status`, { body: { status: 'bogus' } })).status, 400);
  assert.equal((await sup.req('POST', `/api/admin/ideas/${id}/status`, { body: { status: 'planned' } })).status, 200);
  assert.equal((await cw.req('GET', '/api/ideas')).json.ideas[0].status, 'planned');
});

test('turning an account off ends its sessions; reset forces a new password', async () => {
  const cw = new Client(), sup = new Client();
  await cw.login(state.cw.email, NEWPW + '-cw');
  await sup.login(ADMIN.email, NEWPW);
  const users = (await sup.req('GET', '/api/admin/users')).json.users;
  const cwId = users.find((u) => u.email === state.cw.email).id;
  const meId = users.find((u) => u.email === ADMIN.email).id;
  assert.equal((await sup.req('POST', `/api/admin/users/${cwId}/active`, { body: { active: false } })).status, 200);
  assert.equal((await cw.req('GET', '/api/me')).status, 401);
  assert.equal((await new Client().login(state.cw.email, NEWPW + '-cw')).status, 401);
  assert.equal((await sup.req('POST', `/api/admin/users/${cwId}/active`, { body: { active: true } })).status, 200);
  const reset = await sup.req('POST', `/api/admin/users/${cwId}/reset`, { body: {} });
  assert.equal(reset.status, 200);
  const again = new Client();
  assert.equal((await again.login(state.cw.email, NEWPW + '-cw')).status, 401);
  const r = await again.login(state.cw.email, reset.json.tempPassword);
  assert.equal(r.status, 200); assert.equal(r.json.mustChange, true);
  // self-protection
  assert.equal((await sup.req('POST', `/api/admin/users/${meId}/active`, { body: { active: false } })).status, 400);
  assert.equal((await sup.req('POST', `/api/admin/users/${meId}/role`, { body: { role: 'caseworker' } })).status, 400);
  // making someone a chaplain needs a facility first
  assert.equal((await sup.req('POST', `/api/admin/users/${cwId}/role`, { body: { role: 'chaplain' } })).status, 400);
  assert.equal((await sup.req('POST', `/api/admin/users/${cwId}/facility`, { body: { facility: 'Test Facility' } })).status, 200);
  assert.equal((await sup.req('POST', `/api/admin/users/${cwId}/role`, { body: { role: 'chaplain' } })).status, 200);
  assert.equal((await sup.req('POST', '/api/admin/users/99999/reset', { body: {} })).status, 404);
});

test('five wrong passwords lock the account, even for the right password', async () => {
  const sup = new Client();
  await sup.login(ADMIN.email, NEWPW);
  const u = await sup.req('POST', '/api/admin/users', { body: { name: 'Lock Test', email: 'lock@example.test', role: 'caseworker' } });
  const c = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await c.login('lock@example.test', 'wrong-wrong-wrong')).status, 401);
  const r = await c.login('lock@example.test', u.json.tempPassword);
  assert.equal(r.status, 401);
  assert.match(r.json.error, /Invalid email or password/);
});

test('logout ends the session', async () => {
  const c = new Client();
  await c.login(ADMIN.email, NEWPW);
  const old = c.cookie;
  assert.equal((await c.req('POST', '/api/logout')).status, 200);
  const stale = new Client(); stale.cookie = old;
  assert.equal((await stale.req('GET', '/api/me')).status, 401);
});

test('path traversal and hidden files are not served', async () => {
  const c = new Client(); await c.login(ADMIN.email, NEWPW);
  const tries = ['/assets/../server.js', '/%2e%2e/server.js', '/assets/..%2fserver.js', '/..%2f..%2fetc/passwd', '/lib/auth.js', '/package.json', '/%00', '/.env'];
  for (const p of tries) {
    const r = await rawGet(p); // signed-out raw request: must never leak
    assert.ok([302, 400, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!/require\(|scrypt|"name":/.test(r.text), `${p} leaked content`);
  }
  for (const p of ['/lib/auth.js', '/package.json', '/server.js', '/.env', '/portal.db']) {
    const r = await c.req('GET', p);
    assert.equal(r.status, 404, `${p} signed in`);
  }
  const r2 = await new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: PORT, path: '/assets/..%2fserver.js', headers: { Cookie: c.cookie } }, (res) => { let d = ''; res.on('data', (x) => (d += x)); res.on('end', () => resolve({ status: res.statusCode, text: d })); });
    q.on('error', reject); q.end();
  });
  assert.ok(!/require\(/.test(r2.text) && r2.status !== 200, 'encoded traversal while signed in');
});

test('static pages reference no inline scripts', async () => {
  const c = new Client(); await c.login(ADMIN.email, NEWPW);
  for (const p of ['/', '/login.html', '/ideas.html', '/admin/users.html', '/tools/certificates/', '/tools/chapel-calendar/', '/change-password.html']) {
    const r = await c.req('GET', p);
    assert.equal(r.status, 200, p);
    const scripts = [...r.text.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    assert.ok(scripts.length > 0, p);
    scripts.forEach((s) => assert.match(s, /\ssrc=/, `${p}: inline script ${s}`));
    assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(r.text), `${p}: inline event handler`);
  }
});
