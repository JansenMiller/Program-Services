'use strict';
// Usage: node scripts/create-user.js email@adoc.gov "Full Name" supervisor|caseworker|chaplain
const db = require('../lib/db');
const auth = require('../lib/auth');
const { ROLES } = require('../lib/tools');
(async () => {
  const [email, name, role] = process.argv.slice(2);
  if (!email || !name || !ROLES.includes(role)) { console.error('Usage: node scripts/create-user.js email "Full Name" ' + ROLES.join('|')); process.exit(1); }
  const e = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(e)) { console.error('That email already has an account.'); process.exit(1); }
  const temp = auth.tempPassword();
  db.prepare('INSERT INTO users (email,name,role,password_hash,must_change,created_at) VALUES (?,?,?,?,1,?)').run(e, name, role, await auth.hashPassword(temp), Date.now());
  console.log(`Created ${role} ${e}\nTemporary password (shown once, must be changed at first sign-in): ${temp}`);
})();
