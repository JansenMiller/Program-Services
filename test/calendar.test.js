'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers.js');

const ADMIN = { email: 'boss@example.test', password: 'Bootstrap-Pass-123' };
const PW = 'correct horse battery staple';
const KILBY = 'Kilby Correctional Facility', BIBB = 'Bibb Correctional Facility';
let srv, sup, chA, chB, cw;

async function makeUser(admin, name, email, role, facility) {
  const r = await admin.req('POST', '/api/admin/users', { body: { name, email, role, facility } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const c = srv.client();
  assert.equal((await c.login(email, r.json.tempPassword)).status, 200);
  assert.equal((await c.req('POST', '/api/change-password', { body: { current: r.json.tempPassword, next: PW } })).status, 200);
  return c;
}
const month = (c, ym, extra = '') => c.req('GET', `/api/calendar/month?month=${ym}${extra}`);
const ev = (over = {}) => ({ title: 'Kairos', kind: 'special', date: '2026-06-02', start: '18:00', end: '20:00', location: 'Chapel', ...over });

before(async () => {
  srv = await startServer({ env: { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: 'Boss' } });
  sup = srv.client();
  await sup.login(ADMIN.email, ADMIN.password);
  await sup.req('POST', '/api/change-password', { body: { current: ADMIN.password, next: PW } });
  assert.equal((await sup.req('POST', '/api/admin/users', { body: { name: 'No Facility', email: 'nf@example.test', role: 'chaplain' } })).status, 400);
  chA = await makeUser(sup, 'Chaplain A', 'a@example.test', 'chaplain', KILBY);
  chB = await makeUser(sup, 'Chaplain B', 'b@example.test', 'chaplain', BIBB);
  cw = await makeUser(sup, 'Case Worker', 'cw@example.test', 'caseworker', '');
});
after(() => { if (srv) { srv.stop(); srv.cleanup(); } });

test('chaplains and supervisors only; caseworkers have no calendar', async () => {
  assert.equal((await month(cw, '2026-06')).status, 403);
  assert.equal((await cw.req('GET', '/api/calendar/overview')).status, 403);
  assert.equal((await cw.req('POST', '/api/calendar/events', { body: ev() })).status, 403);
  assert.equal((await chA.req('GET', '/api/calendar/overview')).status, 403);
  const signedOut = srv.client();
  assert.equal((await signedOut.req('GET', '/api/calendar/month?month=2026-06')).status, 401);
});

test('a one-off event shows up in its month and saves the group name', async () => {
  const r = await chA.req('POST', '/api/calendar/events', { body: ev() });
  assert.equal(r.status, 201); assert.equal(r.json.count, 1);
  const m = await month(chA, '2026-06');
  assert.equal(m.status, 200);
  assert.equal(m.json.facility, KILBY);
  assert.equal(m.json.canEdit, true);
  assert.equal(m.json.events.length, 1);
  assert.deepEqual([m.json.events[0].title, m.json.events[0].date, m.json.events[0].start, m.json.events[0].kind], ['Kairos', '2026-06-02', '18:00', 'special']);
  assert.equal(m.json.orgs.length, 1);
  assert.deepEqual([m.json.orgs[0].name, m.json.orgs[0].start, m.json.orgs[0].end, m.json.orgs[0].location], ['Kairos', '18:00', '20:00', 'Chapel']);
  assert.deepEqual(m.json.locations, ['Chapel']);
  assert.equal((await month(chA, '2026-07')).json.events.length, 0);
});

test('typing a saved name in different case reuses the saved entry', async () => {
  await chA.req('POST', '/api/calendar/events', { body: ev({ title: '  kairos  ', date: '2026-06-09', start: '19:00', end: '' }) });
  const m = (await month(chA, '2026-06')).json;
  assert.equal(m.orgs.length, 1);
  assert.equal(m.orgs[0].name, 'Kairos');
  assert.equal(m.orgs[0].start, '19:00');            // the dropdown remembers the latest time
  assert.ok(m.events.every((e) => e.title === 'Kairos'));
});

test('weekly repeat creates every occurrence as one series', async () => {
  const r = await chA.req('POST', '/api/calendar/events', { body: ev({ title: 'Bible Study', kind: 'study', date: '2026-06-01', start: '13:00', end: '14:00', repeat: { freq: 'weekly', weekdays: [1, 3], until: '2026-06-30' } }) });
  assert.equal(r.status, 201); assert.equal(r.json.count, 9);
  const m = (await month(chA, '2026-06')).json;
  const study = m.events.filter((e) => e.title === 'Bible Study');
  assert.equal(study.length, 9);
  assert.ok(study.every((e) => e.seriesId === r.json.seriesId));
  assert.deepEqual(study[0].repeat, { freq: 'weekly', interval: 1, until: '2026-06-30', weekdays: [1, 3] });
  assert.equal(m.orgs.length, 2);
});

test('edit one occurrence, then this and all following', async () => {
  const study = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Bible Study');
  const third = study[2]; // 2026-06-08
  assert.equal(third.date, '2026-06-08');
  assert.equal((await chA.req('POST', `/api/calendar/events/${third.id}/update`, { body: { ...ev({ title: 'Bible Study', kind: 'study', date: '2026-06-08', start: '15:00', end: '16:00' }), scope: 'one' } })).status, 200);
  let now = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Bible Study');
  assert.equal(now.filter((e) => e.start === '15:00').length, 1);
  assert.equal(now.length, 9);

  const fourth = now[3]; // 2026-06-10
  const r = await chA.req('POST', `/api/calendar/events/${fourth.id}/update`, { body: { ...ev({ title: 'Bible Study', kind: 'study', date: '2026-06-10', start: '10:00', end: '11:00' }), scope: 'following', repeat: { freq: 'weekly', weekdays: [3], until: '2026-06-30' } } });
  assert.equal(r.status, 200);
  now = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Bible Study');
  // earlier ones (Jun 1, 3, 8) untouched; from Jun 10 on: Wednesdays only at 10:00 (10, 17, 24)
  assert.deepEqual(now.map((e) => e.date), ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10', '2026-06-17', '2026-06-24']);
  assert.deepEqual(now.slice(3).map((e) => e.start), ['10:00', '10:00', '10:00']);
  assert.equal(now[0].start, '13:00');
});

test('turn a single event into a repeating one', async () => {
  const c = await chA.req('POST', '/api/calendar/events', { body: ev({ title: 'Choir', kind: 'service', date: '2026-06-05', start: '09:00', end: '' }) });
  const choir = (await month(chA, '2026-06')).json.events.find((e) => e.title === 'Choir');
  const r = await chA.req('POST', `/api/calendar/events/${choir.id}/update`, { body: { ...ev({ title: 'Choir', date: '2026-06-05', start: '09:00', end: '' }), scope: 'one', repeat: { freq: 'weekly', weekdays: [5], until: '2026-06-26' } } });
  assert.equal(r.status, 200);
  const all = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Choir');
  assert.deepEqual(all.map((e) => e.date), ['2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26']);
  assert.ok(c.status === 201);
});

test('delete one event, then this and all following', async () => {
  let all = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Choir');
  assert.equal((await chA.req('POST', `/api/calendar/events/${all[1].id}/delete`, { body: { scope: 'one' } })).status, 200);
  all = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Choir');
  assert.deepEqual(all.map((e) => e.date), ['2026-06-05', '2026-06-19', '2026-06-26']);
  const r = await chA.req('POST', `/api/calendar/events/${all[1].id}/delete`, { body: { scope: 'following' } });
  assert.equal(r.json.removed, 2);
  all = (await month(chA, '2026-06')).json.events.filter((e) => e.title === 'Choir');
  assert.deepEqual(all.map((e) => e.date), ['2026-06-05']);
});

test('bad input is refused with a clear message', async () => {
  const bad = async (over, re) => { const r = await chA.req('POST', '/api/calendar/events', { body: ev(over) }); assert.equal(r.status, 400, JSON.stringify(over)); assert.match(r.json.error, re); };
  await bad({ title: '   ' }, /name/i);
  await bad({ date: '2026-02-30' }, /date/i);
  await bad({ start: '20:00', end: '18:00' }, /after the start/i);
  await bad({ start: '', end: '18:00' }, /start time/i);
  await bad({ start: '25:00' }, /times/i);
  await bad({ repeat: { freq: 'weekly', until: '2026-06-01' } }, /end/i);
  await bad({ repeat: { freq: 'daily', until: '2028-01-01' } }, /13 months/i);
  await bad({ repeat: { freq: 'weekly' } }, /end/i);
  const long = await chA.req('POST', '/api/calendar/events', { body: ev({ title: 'x'.repeat(300) }) });
  assert.equal(long.status, 201);
  assert.equal((await month(chA, '2026-06')).json.events.find((e) => e.title.startsWith('xxxx')).title.length, 80);
  assert.equal((await month(chA, '2026-13')).status, 400);
});

test('facilities are separate: no peeking, no editing across', async () => {
  const b = await chB.req('POST', '/api/calendar/events', { body: ev({ title: 'Hope Inspired', date: '2026-06-03' }) });
  assert.equal(b.status, 201);
  const mb = (await month(chB, '2026-06')).json;
  assert.equal(mb.facility, BIBB);
  assert.deepEqual(mb.events.map((e) => e.title), ['Hope Inspired']);
  assert.deepEqual(mb.orgs.map((o) => o.name), ['Hope Inspired']);
  // asking for another facility's calendar still returns your own
  const sneaky = await month(chB, '2026-06', '&facility=' + encodeURIComponent(KILBY));
  assert.equal(sneaky.json.facility, BIBB);
  // editing or deleting another facility's event id is "not found"
  const aEv = (await month(chA, '2026-06')).json.events[0];
  assert.equal((await chB.req('POST', `/api/calendar/events/${aEv.id}/delete`, { body: { scope: 'one' } })).status, 404);
  assert.equal((await chB.req('POST', `/api/calendar/events/${aEv.id}/update`, { body: ev() })).status, 404);
  const orgA = (await month(chA, '2026-06')).json.orgs[0];
  assert.equal((await chB.req('POST', `/api/calendar/orgs/${orgA.id}/delete`, { body: {} })).status, 404);
});

test('supervisors can look at any facility but cannot change calendars', async () => {
  const v = await month(sup, '2026-06', '&facility=' + encodeURIComponent(KILBY));
  assert.equal(v.status, 200); assert.equal(v.json.canEdit, false); assert.ok(v.json.events.length > 5);
  assert.equal((await month(sup, '2026-06')).status, 400); // needs a facility
  assert.equal((await sup.req('POST', '/api/calendar/events', { body: ev() })).status, 403);
  assert.equal((await sup.req('POST', '/api/calendar/month', { body: { month: '2026-06', note: 'x' } })).status, 403);
});

test('removing a name from the dropdown keeps existing events', async () => {
  const m = (await month(chA, '2026-06')).json;
  const org = m.orgs.find((o) => o.name === 'Kairos');
  assert.equal((await chA.req('POST', `/api/calendar/orgs/${org.id}/delete`, { body: {} })).status, 200);
  const after = (await month(chA, '2026-06')).json;
  assert.ok(!after.orgs.some((o) => o.name === 'Kairos'));
  assert.equal(after.events.filter((e) => e.title === 'Kairos').length, 2);
});

test('month notes, sign-off names, and final status', async () => {
  const empty = await chB.req('POST', '/api/calendar/month', { body: { month: '2026-07', status: 'final' } });
  assert.equal(empty.status, 400); // nothing to sign off yet
  assert.equal((await chB.req('POST', '/api/calendar/month', { body: { month: '2026-06', note: 'Subject to change.', warden: 'Warden Smith', chaplain: 'Chaplain B' } })).status, 200);
  let m = (await month(chB, '2026-06')).json;
  assert.deepEqual([m.note, m.warden, m.chaplain, m.status], ['Subject to change.', 'Warden Smith', 'Chaplain B', 'draft']);
  // the warden name carries to the next month
  assert.equal((await month(chB, '2026-07')).json.warden, 'Warden Smith');
  assert.equal((await chB.req('POST', '/api/calendar/month', { body: { month: '2026-06', status: 'final' } })).status, 200);
  assert.equal((await month(chB, '2026-06')).json.status, 'final');
  // changing anything puts it back to draft
  await chB.req('POST', '/api/calendar/events', { body: ev({ title: 'Late addition', date: '2026-06-20' }) });
  assert.equal((await month(chB, '2026-06')).json.status, 'draft');
  await chB.req('POST', '/api/calendar/month', { body: { month: '2026-06', status: 'final' } });
  await chB.req('POST', '/api/calendar/month', { body: { month: '2026-06', warden: 'Warden Jones' } });
  assert.equal((await month(chB, '2026-06')).json.status, 'draft');
});

test('supervisor overview lists every calendar with counts and status', async () => {
  await chB.req('POST', '/api/calendar/month', { body: { month: '2026-06', status: 'final' } });
  const o = (await sup.req('GET', '/api/calendar/overview')).json;
  const kil = o.calendars.find((c) => c.facility === KILBY && c.month === '2026-06');
  const bib = o.calendars.find((c) => c.facility === BIBB && c.month === '2026-06');
  assert.ok(kil && bib);
  assert.equal(bib.status, 'final');
  assert.equal(kil.status, 'draft');
  assert.ok(kil.events > 5 && bib.events >= 2);
  assert.equal(kil.chaplain, 'Chaplain A');
  assert.deepEqual(o.chaplains.map((c) => c.facility).sort(), [BIBB, KILBY]);
  assert.ok(o.facilities.includes('St. Clair Correctional Facility'));
});

test('Manage Team: facility is required for chaplains and can be changed', async () => {
  const users = (await sup.req('GET', '/api/admin/users')).json.users;
  const a = users.find((u) => u.email === 'a@example.test');
  assert.equal(a.facility, KILBY);
  assert.equal((await sup.req('POST', `/api/admin/users/${a.id}/facility`, { body: { facility: '' } })).status, 400);
  assert.equal((await sup.req('POST', `/api/admin/users/${a.id}/facility`, { body: { facility: 'Holman Correctional Facility' } })).status, 200);
  assert.equal((await month(chA, '2026-06')).json.facility, 'Holman Correctional Facility');
  assert.equal((await chA.req('GET', '/api/me')).json.user.facility, 'Holman Correctional Facility');
});
