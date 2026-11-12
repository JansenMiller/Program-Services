'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers.js');
const X = require('../lib/xlsx.js');
const R = require('../public/tools/reentry-report/report-core.js');

const ADMIN = { email: 'boss@example.test', password: 'Bootstrap-Pass-123' };
const PW = 'correct horse battery staple';
const KILBY = 'Kilby Correctional Facility', BIBB = 'Bibb Correctional Facility';
let srv, sup, cwK, cwB, chap, nofac;

async function makeUser(admin, name, email, role, facility) {
  const r = await admin.req('POST', '/api/admin/users', { body: { name, email, role, facility } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const c = srv.client();
  assert.equal((await c.login(email, r.json.tempPassword)).status, 200);
  assert.equal((await c.req('POST', '/api/change-password', { body: { current: r.json.tempPassword, next: PW } })).status, 200);
  return c;
}
const get = (c, ym, extra = '') => c.req('GET', `/api/reentry/report?month=${ym}${extra}`);
const full = (p, over = {}) => Object.assign(p, { bf: 10, enr: 4, tdisc: 1, toth: 1, grad: null, black: 8, white: 3, other: 0 }, over);
function filledReport(base) {
  const rep = { population: base.population, programs: base.programs.map((p) => Object.assign({}, p)), docs: JSON.parse(JSON.stringify(base.docs)) };
  rep.programs.forEach((p) => full(p));
  R.DOCS.forEach((d) => { rep.docs[d.id] = { v: d.rows.map((_, i) => i), total: 9 }; });
  return rep;
}

before(async () => {
  srv = await startServer({ env: { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ADMIN_NAME: 'Boss', PORTAL_TODAY: '2026-11-11' } });
  sup = srv.client();
  await sup.login(ADMIN.email, ADMIN.password);
  await sup.req('POST', '/api/change-password', { body: { current: ADMIN.password, next: PW } });
  cwK = await makeUser(sup, 'Casey Kilby', 'ck@example.test', 'caseworker', KILBY);
  cwB = await makeUser(sup, 'Bea Bibb', 'bb@example.test', 'caseworker', BIBB);
  chap = await makeUser(sup, 'Chap Lain', 'chap@example.test', 'chaplain', KILBY);
  nofac = await makeUser(sup, 'No Facility', 'nf@example.test', 'caseworker', '');
});
after(() => { if (srv) { srv.stop(); srv.cleanup(); } });

test('who can use the report', async () => {
  assert.equal((await get(chap, '2026-10')).status, 403);
  assert.equal((await get(nofac, '2026-10')).status, 400);
  assert.equal((await srv.client().req('GET', '/api/reentry/report?month=2026-10')).status, 401);
  assert.equal((await get(sup, '2026-10')).status, 400);                         // supervisors must say which facility
  assert.equal((await cwK.req('GET', '/api/reentry/overview')).status, 403);
  const tools = (await cwK.req('GET', '/api/me')).json.tools.map((t) => t.id);
  assert.ok(tools.includes('reentry-report'));
  assert.equal((await cwK.req('GET', '/tools/reentry-report/')).status, 200);
  assert.equal((await chap.req('GET', '/tools/reentry-report/')).status, 403);   // chaplains are turned away
});

test('a first report starts from the standard program list, blank numbers', async () => {
  const r = (await get(cwK, '2026-09')).json;
  assert.equal(r.facility, KILBY); assert.equal(r.population, 'men'); assert.equal(r.status, 'draft'); assert.equal(r.saved, false); assert.equal(r.canEdit, true);
  assert.deepEqual(r.programs.map((p) => p.name), R.PROGRAM_SETS.men);
  assert.equal(r.programs[0].bf, null);
  assert.equal(r.due, '2026-10-05');
  assert.ok(r.issues.some((i) => i.level === 'error'));
});

let sep;
test('save, add graduates, fix problems, submit', async () => {
  sep = (await get(cwK, '2026-09')).json;
  const rep = filledReport(sep);
  rep.programs[0].grad = null;
  const s = await cwK.req('POST', '/api/reentry/report', { body: Object.assign({ month: '2026-09' }, rep) });
  assert.equal(s.status, 200);
  // two graduates for the first program in September; AIS numbers get tidied, duplicates ignored
  const name = rep.programs[0].name;
  const g = await cwK.req('POST', '/api/reentry/roster', { body: { program: name, rows: [{ ais: ' 000-111 ', date: '9/14/2026' }, { ais: 'd22', date: '2026-09-20' }, { ais: 'd22', date: '2026-09-20' }, { ais: '', date: '9/1/2026' }, { ais: 'x9', date: 'not a date' }] } });
  assert.equal(g.status, 200); assert.equal(g.json.added, 2); assert.equal(g.json.duplicates, 1); assert.equal(g.json.invalid.length, 2);
  const r = (await get(cwK, '2026-09')).json;
  assert.equal(r.saved, true);
  assert.equal(r.rosterCounts[name], 2);
  assert.deepEqual(r.roster.map((x) => x.ais), ['000-111', 'D22']);
  // 10 + 4 - 1 - 1 - 2 graduates = 10 participating, but race counts add up to 11: cannot submit yet
  let sub = await cwK.req('POST', '/api/reentry/submit', { body: { month: '2026-09' } });
  assert.equal(sub.status, 400); assert.ok(sub.json.issues.some((i) => /add up to 11 but the total participating is 10/.test(i.msg)));
  rep.programs[0].white = 2;
  await cwK.req('POST', '/api/reentry/report', { body: Object.assign({ month: '2026-09' }, rep) });
  // the other programs have no graduates: 10+4-1-1-0 = 12 vs race 11
  rep.programs.slice(1).forEach((p) => { p.white = 4; });
  await cwK.req('POST', '/api/reentry/report', { body: Object.assign({ month: '2026-09' }, rep) });
  sub = await cwK.req('POST', '/api/reentry/submit', { body: { month: '2026-09' } });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  const after = (await get(cwK, '2026-09')).json;
  assert.equal(after.status, 'submitted'); assert.equal(after.submittedBy, 'Casey Kilby'); assert.ok(after.submittedAt);
});

test('changing a submitted report puts it back to draft', async () => {
  const r = (await get(cwK, '2026-09')).json;
  const del = await cwK.req('POST', `/api/reentry/roster/${r.roster[0].id}/delete`, { body: {} });
  assert.equal(del.status, 200);
  assert.equal((await get(cwK, '2026-09')).json.status, 'draft');
  await cwK.req('POST', '/api/reentry/roster', { body: { program: r.roster[0].program, rows: [{ ais: r.roster[0].ais, date: '2026-09-14' }] } });
  assert.equal((await cwK.req('POST', '/api/reentry/submit', { body: { month: '2026-09' } })).status, 200);
  assert.equal((await cwK.req('POST', '/api/reentry/reopen', { body: { month: '2026-09' } })).json.status, 'draft');
  assert.equal((await cwK.req('POST', '/api/reentry/submit', { body: { month: '2026-09' } })).status, 200);
  const rep = filledReport(sep); rep.programs[0].enr = 9;
  const s = await cwK.req('POST', '/api/reentry/report', { body: Object.assign({ month: '2026-09' }, rep) });
  assert.equal(s.json.reopened, true);
});

test('next month starts from last month: same programs, brought forward = last month\'s total', async () => {
  // put September back the way it was, submitted
  const rep = filledReport(sep);
  rep.programs.slice(1).forEach((p) => { p.white = 4; }); rep.programs[0].white = 2;
  await cwK.req('POST', '/api/reentry/report', { body: Object.assign({ month: '2026-09' }, rep) });
  const sept = (await get(cwK, '2026-09')).json;
  const totals = {}; sept.programs.forEach((p) => { totals[p.name] = R.programTotal(p, sept.rosterCounts[p.name] || 0); });
  const oct = (await get(cwK, '2026-10')).json;
  assert.deepEqual(oct.programs.map((p) => p.name), sept.programs.map((p) => p.name));
  oct.programs.forEach((p) => { assert.equal(p.bf, totals[p.name]); assert.equal(oct.auto[p.name], true); });
  assert.ok(oct.hints && oct.hints.birth);
  assert.equal(oct.programs[0].enr, null);
});

test('facilities are separate; supervisors can look and download but not change', async () => {
  const b = (await get(cwB, '2026-09')).json;
  assert.equal(b.facility, BIBB); assert.equal(b.saved, false);
  assert.equal((await get(cwB, '2026-09', '&facility=' + encodeURIComponent(KILBY))).json.facility, BIBB); // ignored for social workers
  const s = await get(sup, '2026-09', '&facility=' + encodeURIComponent(KILBY));
  assert.equal(s.status, 200); assert.equal(s.json.canEdit, false); assert.equal(s.json.saved, true);
  assert.equal((await sup.req('POST', '/api/reentry/report', { body: { month: '2026-09', programs: [] } })).status, 403);
  assert.equal((await sup.req('POST', '/api/reentry/submit', { body: { month: '2026-09' } })).status, 403);
  assert.equal((await cwB.req('POST', '/api/reentry/roster/1/delete', { body: {} })).status, 404);   // someone else's graduate
});

test('overview and deadline status (today is pinned to Nov 11, so October was due Nov 5)', async () => {
  const st = (await cwB.req('GET', '/api/reentry/status')).json;
  assert.deepEqual([st.kind, st.month, st.due, st.daysLeft, st.status], ['caseworker', '2026-10', '2026-11-05', -6, 'notstarted']);
  assert.equal((await nofac.req('GET', '/api/reentry/status')).json.status, 'nofacility');
  const rep = filledReport((await get(cwK, '2026-10')).json);
  rep.programs.forEach((p) => { p.bf = 10; p.white = 4; });
  await cwK.req('POST', '/api/reentry/report', { body: Object.assign({ month: '2026-10' }, rep) });
  assert.equal((await cwK.req('POST', '/api/reentry/submit', { body: { month: '2026-10' } })).status, 200);
  const ov = (await sup.req('GET', '/api/reentry/overview?month=2026-10')).json;
  assert.equal(ov.due, '2026-11-05');
  const row = (f) => ov.facilities.find((x) => x.facility === f);
  assert.equal(row(KILBY).status, 'submitted'); assert.deepEqual(row(KILBY).caseworkers, ['Casey Kilby']);
  assert.equal(row(BIBB).status, 'notstarted');
  const ss = (await sup.req('GET', '/api/reentry/status')).json;
  assert.deepEqual([ss.kind, ss.expected, ss.submitted, ss.notStarted], ['supervisor', 2, 1, 1]);
});

test('the Excel download is the department workbook, filled in', async () => {
  const res = await fetch(srv.base + `/api/reentry/export?month=2026-09`, { headers: { Cookie: cwK.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  assert.match(res.headers.get('content-disposition'), /Kilby_Correctional_Facility_Tracking_Report_September_2026\.xlsx/);
  const parts = X.readZip(Buffer.from(await res.arrayBuffer()));
  const text = (n) => parts.find((p) => p.name === n).data.toString('utf8');
  assert.match(text('xl/workbook.xml'), /name="September 2026"/);
  const sheet = text('xl/worksheets/sheet2.xml');
  assert.match(sheet, /<c r="C3"[^>]*t="inlineStr"><is><t[^>]*>Kilby Correctional Facility<\/t>/);
  assert.match(sheet, /<c r="C4"[^>]*t="inlineStr"><is><t[^>]*>Anger Management<\/t>/);
  assert.match(sheet, /<c r="E7"[^>]*><v>10<\/v>/);
  const roster = text('xl/worksheets/sheet3.xml');
  assert.match(roster, /<c r="A7"[^>]*t="inlineStr"><is><t[^>]*>000-111<\/t>/);
  assert.match(roster, /<c r="K7"[^>]*><v>46279<\/v>/);               // 2026-09-14
  assert.ok(text('xl/worksheets/sheet4.xml').includes('Kilby Correctional Facility'));
  // a supervisor can download any facility; a social worker only their own
  assert.equal((await sup.req('GET', '/api/reentry/export?month=2026-09&facility=' + encodeURIComponent(KILBY))).status, 200);
  assert.equal((await chap.req('GET', '/api/reentry/export?month=2026-09')).status, 403);
});
