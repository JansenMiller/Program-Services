'use strict';
// Shared helpers for tests that need their own server and database.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startServer({ env = {}, dataDir } = {}) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', LOGIN_IP_LIMIT: '10000', DEMO_PASSWORD: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d)); proc.stderr.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(base + '/healthz'); if (r.ok) break; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 149) throw new Error('server did not start:\n' + out);
  }
  return {
    base, dir, log: () => out,
    stop() { try { proc.kill(); } catch (e) { /* ignore */ } },
    cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ } },
    client() { return new Client(base); },
  };
}

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.csrf = ''; }
  async req(method, url, { body, headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    if (method !== 'GET') { h['Content-Type'] = 'application/json'; if (this.csrf) h['X-CSRF-Token'] = this.csrf; }
    const res = await fetch(this.base + url, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body || {}), redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; this.cookie = c.startsWith('sid=') && c !== 'sid=' ? c : ''; }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, headers: res.headers, text, json };
  }
  async login(email, password) {
    const r = await this.req('POST', '/api/login', { body: { email, password } });
    if (r.status === 200) { const me = await this.req('GET', '/api/me'); this.csrf = me.json ? me.json.csrf : ''; }
    return r;
  }
}

module.exports = { startServer, Client };
