'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const db = require('./lib/db');
const auth = require('./lib/auth');
const { ROLES, toolsFor, rolesForPath } = require('./lib/tools');
const calendar = require('./lib/calendar');
const reentry = require('./lib/reentry');
const demo = require('./lib/demo');

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const IP_LIMIT = Number(process.env.LOGIN_IP_LIMIT) || 30; // login attempts per IP per 15 minutes
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.otf', '.ttf']);

// ---------- helpers ----------
function audit(actor, action, detail, ip) {
  db.prepare('INSERT INTO audit (ts,actor,action,detail,ip) VALUES (?,?,?,?,?)')
    .run(Date.now(), actor || null, action, detail || null, ip || null);
}
// Behind Render's proxy the LAST x-forwarded-for entry is the one the proxy added; earlier entries can be forged by the client.
const clientIp = (req) => (String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }
function readJson(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject({ status: 413, error: 'Request too large.' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch (e) { reject({ status: 400, error: 'Invalid JSON.' }); }
    });
    req.on('error', () => reject({ status: 400, error: 'Bad request.' }));
  });
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${PROD ? '; Secure' : ''}`);
}
const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${PROD ? '; Secure' : ''}`);
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

// per-IP login throttle (in memory; resets on restart)
const ipHits = new Map();
function ipThrottled(ip) {
  const t = Date.now(); let h = ipHits.get(ip);
  if (!h || h.reset < t) { h = { n: 0, reset: t + 15 * 60 * 1000 }; ipHits.set(ip, h); }
  h.n += 1;
  return h.n > IP_LIMIT;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of ipHits) if (v.reset < t) ipHits.delete(k); auth.purgeSessions(); }, 10 * 60 * 1000).unref();

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, mustChange: !!u.mustChange, facility: u.facility || '', demo: !!u.demo });
const listUsers = () => db.prepare('SELECT id,email,name,role,facility,demo,active,must_change,last_login,created_at FROM users ORDER BY name COLLATE NOCASE').all()
  .map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, facility: u.facility || '', demo: !!u.demo, active: !!u.active, mustChange: !!u.must_change, lastLogin: u.last_login, createdAt: u.created_at }));
const activeSupervisors = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='supervisor' AND active=1").get().c;

// ---------- API ----------
async function api(req, res, p, sess, ip) {
  const m = req.method;

  if (p === '/api/login' && m === 'POST') {
    const body = await readJson(req);
    const generic = { error: 'Invalid email or password, or the account is temporarily locked.' };
    if (ipThrottled(ip)) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const email = cleanText(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    if (!email || !password) return json(res, 401, generic);
    const r = await auth.login(email, password);
    if (!r.ok) {
      audit(email, r.lockStarted ? 'login_lockout' : 'login_fail', null, ip);
      return json(res, 401, generic);
    }
    const s = auth.createSession(r.user.id);
    setSessionCookie(res, s.token);
    audit(email, 'login_ok', null, ip);
    return json(res, 200, { ok: true, mustChange: !!r.user.must_change, csrf: s.csrf });
  }

  if (!sess) return json(res, 401, { error: 'Not signed in.' });
  const u = sess.user;

  if (m !== 'GET') {
    if (!eqSafe(req.headers['x-csrf-token'] || '', sess.csrf)) return json(res, 403, { error: 'Session check failed. Reload the page.' });
  }
  if (u.mustChange && !['/api/me', '/api/change-password', '/api/logout'].includes(p)) {
    return json(res, 403, { error: 'password_change_required' });
  }

  if (p === '/api/me' && m === 'GET') {
    return json(res, 200, { user: publicUser(u), csrf: sess.csrf, tools: toolsFor(u.role).map(({ roles, variants, ...t }) => t) });
  }
  if (p === '/api/logout' && m === 'POST') {
    const tok = auth.parseCookies(req.headers.cookie).sid; auth.destroySession(tok); clearSessionCookie(res);
    audit(u.email, 'logout', null, ip);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/change-password' && m === 'POST') {
    const b = await readJson(req);
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id);
    if (!(await auth.verifyPassword(String(b.current || ''), row.password_hash))) {
      audit(u.email, 'password_change_fail', null, ip);
      return json(res, 400, { error: 'Your current password is not correct.' });
    }
    const next = String(b.next || '');
    const problem = auth.passwordProblem(next, u.email);
    if (problem) return json(res, 400, { error: problem });
    if (next === String(b.current)) return json(res, 400, { error: 'Choose a password different from your current one.' });
    db.prepare('UPDATE users SET password_hash=?, must_change=0, failed_count=0, locked_until=0 WHERE id=?').run(await auth.hashPassword(next), u.id);
    auth.destroyUserSessions(u.id, sess.tokenHash);
    audit(u.email, 'password_changed', null, ip);
    return json(res, 200, { ok: true });
  }

  // ----- chapel calendars and facility list -----
  if (await calendar.handle({ req, res, p, sess, ip, json, readJson, audit })) return;

  // ----- monthly tracking report (social workers and supervisors) -----
  if (await reentry.handle({ req, res, p, sess, ip, json, readJson, audit })) return;

  // ----- shortcut ideas (any signed-in role) -----
  if (p === '/api/ideas' && m === 'GET') {
    const sup = u.role === 'supervisor';
    const rows = db.prepare(
      `SELECT i.id,i.title,i.details,i.status,i.created_at,us.name,us.role FROM ideas i JOIN users us ON us.id=i.user_id
        ${sup ? '' : 'WHERE i.user_id = ?'} ORDER BY i.created_at DESC LIMIT 500`).all(...(sup ? [] : [u.id]));
    return json(res, 200, { ideas: rows.map((r) => ({ id: r.id, title: r.title, details: r.details, status: r.status, createdAt: r.created_at, by: r.name, byRole: r.role })), canManage: sup });
  }
  if (p === '/api/ideas' && m === 'POST') {
    const b = await readJson(req);
    const title = cleanText(b.title, 120); const details = cleanText(b.details, 2000);
    if (title.length < 3) return json(res, 400, { error: 'Please give your idea a short title.' });
    db.prepare('INSERT INTO ideas (user_id,title,details,created_at) VALUES (?,?,?,?)').run(u.id, title, details, Date.now());
    return json(res, 201, { ok: true });
  }

  // ----- supervisor only -----
  if (p.startsWith('/api/admin/')) {
    if (u.role !== 'supervisor') return json(res, 403, { error: 'Not allowed.' });

    if (p === '/api/admin/users' && m === 'GET') return json(res, 200, { users: listUsers(), me: u.id });
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await readJson(req);
      const email = cleanText(b.email, 200).toLowerCase(); const name = cleanText(b.name, 80); const role = b.role;
      const facility = role === 'supervisor' ? '' : cleanText(b.facility, 80);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
      if (!name) return json(res, 400, { error: 'Enter the person\'s name.' });
      if (!ROLES.includes(role)) return json(res, 400, { error: 'Choose a role.' });
      if (role === 'chaplain' && !facility) return json(res, 400, { error: 'Choose the chaplain\'s facility.' });
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return json(res, 409, { error: 'An account with that email already exists.' });
      const temp = auth.tempPassword();
      db.prepare('INSERT INTO users (email,name,role,facility,password_hash,must_change,created_at) VALUES (?,?,?,?,?,1,?)').run(email, name, role, facility, await auth.hashPassword(temp), Date.now());
      audit(u.email, 'user_created', `${email} (${role}${facility ? ', ' + facility : ''})`, ip);
      return json(res, 201, { ok: true, email, tempPassword: temp });
    }
    let mm;
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/(reset|active|role|facility)$/)) && m === 'POST') {
      const id = Number(mm[1]); const action = mm[2];
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!target) return json(res, 404, { error: 'User not found.' });
      const b = await readJson(req);
      if (action === 'reset') {
        const temp = auth.tempPassword();
        db.prepare('UPDATE users SET password_hash=?, must_change=1, failed_count=0, locked_until=0 WHERE id=?').run(await auth.hashPassword(temp), id);
        auth.destroyUserSessions(id);
        audit(u.email, 'user_reset', target.email, ip);
        return json(res, 200, { ok: true, email: target.email, tempPassword: temp });
      }
      if (action === 'active') {
        const on = !!b.active;
        if (!on && id === u.id) return json(res, 400, { error: 'You cannot turn off your own account.' });
        if (!on && target.role === 'supervisor' && target.active && activeSupervisors() <= 1) return json(res, 400, { error: 'At least one supervisor must stay active.' });
        db.prepare('UPDATE users SET active=? WHERE id=?').run(on ? 1 : 0, id);
        if (!on) auth.destroyUserSessions(id);
        audit(u.email, on ? 'user_enabled' : 'user_disabled', target.email, ip);
        return json(res, 200, { ok: true });
      }
      if (action === 'facility') {
        const fac = cleanText(b.facility, 80);
        if (target.role === 'chaplain' && !fac) return json(res, 400, { error: 'A chaplain needs a facility.' });
        db.prepare('UPDATE users SET facility=? WHERE id=?').run(target.role === 'supervisor' ? '' : fac, id);
        audit(u.email, 'user_facility', `${target.email} -> ${fac}`, ip);
        return json(res, 200, { ok: true });
      }
      if (action === 'role') {
        if (!ROLES.includes(b.role)) return json(res, 400, { error: 'Choose a role.' });
        if (id === u.id) return json(res, 400, { error: 'You cannot change your own role.' });
        if (target.role === 'supervisor' && b.role !== 'supervisor' && target.active && activeSupervisors() <= 1) return json(res, 400, { error: 'At least one supervisor must stay active.' });
        if (b.role === 'chaplain' && !target.facility) return json(res, 400, { error: 'Set a facility first, then make this person a chaplain.' });
        db.prepare('UPDATE users SET role=?, facility=CASE WHEN ?=\'supervisor\' THEN \'\' ELSE facility END WHERE id=?').run(b.role, b.role, id);
        audit(u.email, 'user_role', `${target.email} -> ${b.role}`, ip);
        return json(res, 200, { ok: true });
      }
    }
    if ((mm = p.match(/^\/api\/admin\/ideas\/(\d+)\/status$/)) && m === 'POST') {
      const b = await readJson(req);
      if (!['new', 'planned', 'done', 'declined'].includes(b.status)) return json(res, 400, { error: 'Invalid status.' });
      const r = db.prepare('UPDATE ideas SET status=? WHERE id=?').run(b.status, Number(mm[1]));
      return r.changes ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Idea not found.' });
    }
  }
  return json(res, 404, { error: 'Not found.' });
}

// ---------- static pages ----------
function serveStatic(req, res, p) {
  let rel = p.endsWith('/') ? p + 'index.html' : p;
  const abs = path.normalize(path.join(PUBLIC, rel));
  if (!abs.startsWith(PUBLIC + path.sep) || path.basename(abs).startsWith('.')) return notFound(res);
  fs.stat(abs, (err, st) => {
    if (err) return notFound(res);
    if (st.isDirectory()) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
    const ext = path.extname(abs).toLowerCase();
    if (!MIME[ext]) return notFound(res);
    const headers = { 'Content-Type': MIME[ext], Vary: 'Accept-Encoding' };
    if (p.startsWith('/assets/')) {
      // Public brand files: let browsers keep them, but always check for a newer copy.
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      headers.ETag = etag;
      headers['Cache-Control'] = p.startsWith('/assets/fonts/') ? 'public, max-age=86400' : 'no-cache';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    } else {
      headers['Cache-Control'] = 'no-store';
    }
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gzip) headers['Content-Encoding'] = 'gzip'; else headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(abs);
    stream.on('error', () => res.destroy());
    if (gzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res); else stream.pipe(res);
  });
}
function notFound(res) {
  const body = 'Not found';
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

// ---------- request handler ----------
async function handle(req, res) {
  securityHeaders(res);
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p.includes('\0')) { res.writeHead(400); return res.end(); }
  const ip = clientIp(req);

  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }

  const isApi = p.startsWith('/api/');
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });

  if (req.method === 'POST') {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'JSON required.' });
    const origin = req.headers.origin;
    if (origin) { try { if (new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin request blocked.' }); } catch (e) { return json(res, 403, { error: 'Bad origin.' }); } }
  }

  const sess = auth.getSession(auth.parseCookies(req.headers.cookie).sid);

  if (isApi) {
    try { return await api(req, res, p, sess, ip); }
    catch (e) {
      if (e && e.status) return json(res, e.status, { error: e.error });
      console.error('API error:', e && e.message);
      return json(res, 500, { error: 'Something went wrong.' });
    }
  }

  // pages and assets
  if (p === '/login.html' || p.startsWith('/assets/')) return serveStatic(req, res, p);
  if (!sess) return redirect(res, '/login.html');
  if (sess.user.mustChange && p !== '/change-password.html') return redirect(res, '/change-password.html');
  const allowed = rolesForPath(p);
  if (allowed && !allowed.includes(sess.user.role)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('You do not have access to this page.');
  }
  return serveStatic(req, res, p);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => { console.error('Unhandled:', e && e.message); if (!res.headersSent) { res.writeHead(500); } res.end(); });
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;

// First supervisor account, only when the database has no users yet.
(async function bootstrap() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const email = cleanText(process.env.ADMIN_EMAIL || '', 200).toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || '';
  if (count === 0 && email && pw) {
    db.prepare('INSERT INTO users (email,name,role,password_hash,must_change,created_at) VALUES (?,?,?,?,1,?)')
      .run(email, cleanText(process.env.ADMIN_NAME || 'Supervisor', 80), 'supervisor', await auth.hashPassword(pw), Date.now());
    audit('system', 'bootstrap_admin', email, null);
    console.log('Created first supervisor account for ' + email + ' (password must be changed at first sign-in).');
  } else if (count === 0) {
    console.warn('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD, or run: node scripts/create-user.js');
  }
  await demo.sync(process.env.DEMO_PASSWORD);
  server.listen(PORT, () => console.log(`ADOC staff portal listening on ${PORT}${PROD ? ' (production)' : ''}`));
})();
