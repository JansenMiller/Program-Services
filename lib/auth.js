'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEYLEN = 64;
const IDLE_MS = 30 * 60 * 1000;          // sign out after 30 minutes of inactivity
const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // and after 12 hours regardless
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const COMMON = ['password', 'qwerty', 'letmein', 'welcome', 'adoc', 'alabama', 'corrections', '123456'];

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB, keyB] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(keyB, 'base64');
    const key = await scrypt(pw, Buffer.from(saltB, 'base64'), expected.length,
      { N: +N, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch (e) { return false; }
}

let DUMMY;
async function dummyHash() {
  if (!DUMMY) DUMMY = await hashPassword(crypto.randomBytes(12).toString('hex'));
  return DUMMY;
}

function tempPassword() {
  let s = '';
  for (let i = 0; i < 14; i++) s += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  return s;
}

function passwordProblem(pw, email) {
  if (typeof pw !== 'string') return 'Password is required.';
  if (pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 128) return 'Password must be 128 characters or fewer.';
  const low = pw.toLowerCase();
  if (email && low === String(email).toLowerCase()) return 'Password cannot be your email address.';
  const squashed = low.replace(/[^a-z0-9]/g, '');
  if (COMMON.some((c) => low === c || squashed === c) || new RegExp('^(' + COMMON.join('|') + ')+$').test(squashed)) return 'That password is too easy to guess.';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be a single repeated character.';
  return null;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const t = Date.now();
  db.prepare('INSERT INTO sessions (token_hash,user_id,csrf,created_at,last_seen) VALUES (?,?,?,?,?)')
    .run(sha(token), userId, csrf, t, t);
  return { token, csrf };
}

function getSession(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const h = sha(token);
  const row = db.prepare(
    `SELECT s.csrf, s.created_at, s.last_seen, u.id, u.email, u.name, u.role, u.must_change, u.active, u.facility, u.demo
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  if (!row) return null;
  const t = Date.now();
  if (!row.active || t - row.last_seen > IDLE_MS || t - row.created_at > ABSOLUTE_MS) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    return null;
  }
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(t, h);
  return {
    tokenHash: h, csrf: row.csrf,
    user: { id: row.id, email: row.email, name: row.name, role: row.role, mustChange: !!row.must_change, facility: row.facility || '', demo: !!row.demo },
  };
}

const destroySession = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
function destroyUserSessions(userId, exceptHash) {
  if (exceptHash) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, exceptHash);
  else db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
function purgeSessions() {
  const t = Date.now();
  db.prepare('DELETE FROM sessions WHERE last_seen < ? OR created_at < ?').run(t - IDLE_MS, t - ABSOLUTE_MS);
}

// Returns { ok, user, locked } -- callers must show one generic message for every failure.
async function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const t = Date.now();
  if (!user || user.locked_until > t) {
    await verifyPassword(password, await dummyHash()); // keep timing similar
    return { ok: false, user: user || null, locked: !!user };
  }
  const good = await verifyPassword(password, user.password_hash);
  if (!good) {
    const fails = user.failed_count + 1;
    if (fails >= MAX_FAILS) {
      db.prepare('UPDATE users SET failed_count = 0, locked_until = ? WHERE id = ?').run(t + LOCK_MS, user.id);
      return { ok: false, user, lockStarted: true };
    }
    db.prepare('UPDATE users SET failed_count = ? WHERE id = ?').run(fails, user.id);
    return { ok: false, user };
  }
  if (!user.active) return { ok: false, user };
  db.prepare('UPDATE users SET failed_count = 0, locked_until = 0, last_login = ? WHERE id = ?').run(t, user.id);
  return { ok: true, user };
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

module.exports = {
  hashPassword, verifyPassword, tempPassword, passwordProblem,
  createSession, getSession, destroySession, destroyUserSessions, purgeSessions,
  login, parseCookies, IDLE_MS, ABSOLUTE_MS,
};
