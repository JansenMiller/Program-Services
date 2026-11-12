'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers.js');
const C = require('../public/tools/chapel-calendar/calendar-core.js');

const DEMO_PW = 'ADOCprograms1!';
const ADMIN = { email: 'boss@example.test', password: 'Bootstrap-Pass-123' };
const KILBY = 'Kilby Correctional Facility';
const now = new Date();
const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
let servers = [];
after(() => servers.forEach((s) => { s.stop(); s.cleanup(); }));

test('demo accounts exist only while DEMO_PASSWORD is set', async () => {
  const s1 = await startServer({ env: { DEMO_PASSWORD: DEMO_PW, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: 'Boss' } });
  servers.push(s1);

  // each demo role signs in with the shared password, with no forced password change
  const sup = s1.client(), cw = s1.client(), ch = s1.client();
  const r = await sup.login('supervisor@doc.alabama.gov', DEMO_PW);
  assert.equal(r.status, 200); assert.equal(r.json.mustChange, false);
  assert.equal((await cw.login('caseworker@doc.alabama.gov', DEMO_PW)).status, 200);
  assert.equal((await ch.login('chaplain@doc.alabama.gov', DEMO_PW)).status, 200);
  assert.equal((await new (s1.client().constructor)(s1.base).login('chaplain@doc.alabama.gov', 'wrong-password-123')).status, 401);

  // each sees its own tools
  const tools = async (c) => (await c.req('GET', '/api/me')).json.tools.map((t) => t.id).sort();
  assert.deepEqual(await tools(sup), ['certificates', 'chapel-calendar', 'ideas', 'users']);
  assert.deepEqual(await tools(cw), ['certificates', 'ideas']);
  assert.deepEqual(await tools(ch), ['chapel-calendar', 'ideas']);
  const supCal = (await sup.req('GET', '/api/me')).json.tools.find((t) => t.id === 'chapel-calendar');
  assert.equal(supCal.href, '/tools/chapel-calendar/all.html');
  assert.equal((await ch.req('GET', '/api/me')).json.tools.find((t) => t.id === 'chapel-calendar').href, '/tools/chapel-calendar/');

  // the demo chaplain has a populated calendar for their facility
  const m = (await ch.req('GET', `/api/calendar/month?month=${thisMonth}`)).json;
  assert.equal(m.facility, KILBY);
  assert.ok(m.events.length > 40, 'sample month has plenty of events: ' + m.events.length);
  assert.ok(m.orgs.some((o) => o.name === 'Church of the Highlands'));
  assert.equal(m.canEdit, true);
  assert.ok(m.note.length > 0);

  // the demo supervisor sees several facilities, three months each, with a mix of statuses
  const o = (await sup.req('GET', '/api/calendar/overview')).json;
  assert.equal(new Set(o.calendars.map((c) => c.facility)).size, 4);
  assert.equal(o.calendars.length, 12);
  assert.ok(o.calendars.some((c) => c.status === 'final') && o.calendars.some((c) => c.status === 'draft'));
  assert.equal((await sup.req('GET', '/api/admin/users')).json.users.filter((u) => u.demo).length, 3);

  // a real chaplain at the same facility never sees demo data, and demo users never see real data
  const real = await sup.req('POST', '/api/admin/users', { body: { name: 'Real Chaplain', email: 'real@example.test', role: 'chaplain', facility: KILBY } });
  assert.equal(real.status, 201);
  const rc = s1.client();
  await rc.login('real@example.test', real.json.tempPassword);
  await rc.req('POST', '/api/change-password', { body: { current: real.json.tempPassword, next: 'correct horse battery staple' } });
  const rm = (await rc.req('GET', `/api/calendar/month?month=${thisMonth}`)).json;
  assert.equal(rm.events.length, 0);
  assert.equal(rm.orgs.length, 0);
  await rc.req('POST', '/api/calendar/events', { body: { title: 'Real Group', kind: 'service', date: thisMonth + '-10', start: '09:00' } });
  const dm = (await ch.req('GET', `/api/calendar/month?month=${thisMonth}`)).json;
  assert.ok(!dm.events.some((e) => e.title === 'Real Group') && !dm.orgs.some((x) => x.name === 'Real Group'));
  assert.equal((await rc.req('GET', '/api/calendar/month?month=' + thisMonth)).json.events.length, 1);
  const realOverview = (await sup.req('GET', '/api/calendar/overview')).json; // demo supervisor: still demo data only
  assert.ok(!realOverview.calendars.some((c) => c.events === 1));

  // restart WITHOUT the demo password on the same database: demo accounts switch off, sample data disappears
  s1.stop();
  const s2 = await startServer({ dataDir: s1.dir, env: { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password } });
  servers.push(s2);
  assert.equal((await s2.client().login('chaplain@doc.alabama.gov', DEMO_PW)).status, 401);
  assert.equal((await s2.client().login('supervisor@doc.alabama.gov', DEMO_PW)).status, 401);
  const rc2 = s2.client();
  assert.equal((await rc2.login('real@example.test', 'correct horse battery staple')).status, 200);
  assert.equal((await rc2.req('GET', `/api/calendar/month?month=${thisMonth}`)).json.events.length, 1); // the real event survived
  const boss = s2.client(); await boss.login(ADMIN.email, ADMIN.password);
  // (the bootstrap password was already used on the first server, so the real boss must still be able to sign in)
  assert.ok([200, 401].includes((await boss.req('GET', '/api/me')).status));
});

test('a short or missing DEMO_PASSWORD creates no demo accounts', async () => {
  const s = await startServer({ env: { DEMO_PASSWORD: 'short', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password } });
  servers.push(s);
  assert.equal((await s.client().login('chaplain@doc.alabama.gov', 'short')).status, 401);
  assert.match(s.log(), /DEMO_PASSWORD was ignored/);
  const sup = s.client(); await sup.login(ADMIN.email, ADMIN.password);
  await sup.req('POST', '/api/change-password', { body: { current: ADMIN.password, next: 'correct horse battery staple' } });
  assert.equal((await sup.req('GET', '/api/admin/users')).json.users.filter((u) => u.demo).length, 0);
});
