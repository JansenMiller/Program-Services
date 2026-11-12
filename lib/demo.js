'use strict';
// Demo accounts for trying each role. They exist only while the DEMO_PASSWORD environment variable is set:
// set it and they are created (with sample calendars); remove it and they are switched off and their sample data deleted.
// Demo accounts only ever see demo data, and real accounts never see it.
const db = require('./db');
const auth = require('./auth');
const calendar = require('./calendar');
const reentry = require('./reentry');
const RR = require('../public/tools/reentry-report/report-core.js');
const C = require('../public/tools/chapel-calendar/calendar-core.js');

const KILBY = 'Kilby Correctional Facility';
const ACCOUNTS = [
  { email: 'supervisor@doc.alabama.gov', name: 'Demo Supervisor', role: 'supervisor', facility: '' },
  { email: 'caseworker@doc.alabama.gov', name: 'Demo Caseworker', role: 'caseworker', facility: KILBY },
  { email: 'chaplain@doc.alabama.gov', name: 'Demo Chaplain', role: 'chaplain', facility: KILBY },
];

// Sample schedules modelled on four real chapel calendars. [title, kind, start, end, location, weekdays (0=Sun) | monthly {nth, weekday}]
const S = 'service', B = 'study', X = 'special';
const SAMPLE = {
  [KILBY]: [
    ['Global Priorities/Bible Study', B, '13:00', '14:00', 'Chapel', [1, 2, 3]],
    ['Orthodox Islam Class', B, '18:00', '20:00', 'Classroom', [1]],
    ['COTH Small Group', B, '18:00', '20:00', 'Chapel', [1]],
    ['Frazer Church', S, '18:00', '20:00', 'Chapel', [2]],
    ['Nation of Islam', S, '18:00', '20:00', 'Classroom', [2]],
    ['Protestant Service', S, '18:00', '20:00', 'Chapel', [3]],
    ['Jumah: Sunni / NOI', S, '11:45', '12:45', 'Chapel', [5]],
    ['MSTA', S, '11:45', '12:45', 'Classroom', [5]],
    ['1st Baptist', S, '18:00', '20:00', 'Chapel', [5]],
    ['Jewish Roots Class', B, '18:00', '20:00', 'Classroom', [5]],
    ['Catholic Mass', S, '08:00', '10:00', 'Chapel', [6]],
    ['Wiccan/Odinist', S, '08:00', '10:00', 'Classroom', [6]],
    ['Native Americans', S, '08:00', '10:00', 'Yard', [0, 6]],
    ['Native Americans', S, '15:00', '17:00', 'Yard', [0, 6]],
    ['Jewish Services', S, '11:00', '13:00', 'Chapel', [6]],
    ['Spanish Bible Study', B, '11:00', '13:00', 'Classroom', [6]],
    ["Jehovah's Witness", S, '18:00', '20:00', 'Classroom', [6]],
    ['Church of the Highlands', S, '11:00', '13:00', 'Chapel', [0]],
    ['M.S.T.A Sunday Class', B, '11:00', '13:00', 'Classroom', [0]],
    ['Montgomery City of Refuge Church', S, '18:00', '20:00', 'Chapel', { nth: 2, weekday: 4 }],
    ['Montgomery City of Refuge Church', S, '18:00', '20:00', 'Chapel', { nth: 4, weekday: 4 }],
    ["Veterans' Meeting", X, '18:00', '20:00', 'Chapel', { nth: 1, weekday: 4 }],
  ],
  'Bibb Correctional Facility': [
    ['Church of the Highlands', S, '09:30', '11:30', 'Chapel', [0]],
    ['Hunter Street Service', S, '13:00', '15:00', 'Chapel', [0]],
    ['Leadership Development', B, '07:30', '08:30', 'Classroom', [1]],
    ['Choir Practice', S, '09:00', '12:00', 'Chapel', [1]],
    ['Hispanic Service', S, '09:00', '11:00', 'Chapel', [2]],
    ['Hope Inspired', B, '13:00', '15:30', 'Classroom', [2]],
    ['Ligonier', B, '07:00', '09:00', 'Classroom', [3]],
    ['Faith Crusaders Ministry', S, '13:00', '15:00', 'Chapel', [3]],
    ['Christ Behind the Walls', B, '09:00', '11:00', 'Chapel', [4]],
    ['Nurse Little Service', X, '13:30', '15:30', 'Chapel', { nth: 1, weekday: 6 }],
  ],
  'North Alabama Community Work Center': [
    ['NCC Bible Study', B, '08:00', '09:00', 'Chapel', [1]],
    ['Serenity Class', B, '15:15', '16:15', 'Classroom', [1]],
    ["Jehovah's Witnesses", S, '12:00', '13:00', 'Classroom', [2]],
    ['O.G.A.E.', B, '14:00', '15:00', 'Classroom', [2]],
    ['Catholic Study', B, '19:15', '20:15', 'Chapel', [3]],
    ['Centering Prayer', S, '08:30', '09:30', 'Chapel', [4]],
    ['New Life Worship Class', B, '19:15', '20:15', 'Chapel', [4]],
    ['Seventh-day Adventist', S, '19:15', '20:15', 'Chapel', [2]],
    ['Highlands Church', S, '08:00', '09:30', 'Chapel', [0]],
    ['Communion Service', S, '15:00', '16:00', 'Chapel', [0]],
  ],
  'St. Clair Correctional Facility': [
    ['Prayer Service', S, '08:30', '', 'Chapel', [1, 2, 3, 4]],
    ['Praise Team Practice', S, '15:00', '', 'Chapel', [3]],
    ['Outmate Ministries', S, '18:00', '', 'Chapel', [3]],
    ['Bible Study', B, '13:30', '', 'Classroom', [5]],
    ['Praise Team Practice', S, '08:00', '14:00', 'Chapel', [6]],
    ['Sunday Worship Service', S, '10:00', '', 'Chapel', [0]],
    ['Church of the Highlands', S, '13:30', '', 'Chapel', [0]],
  ],
};
const FINAL_THIS = ['Bibb Correctional Facility', 'North Alabama Community Work Center', 'St. Clair Correctional Facility'];

function seedCalendars(chaplainId, caseworkerId) {
  const wipe = () => ['cal_events', 'cal_series', 'cal_orgs', 'cal_months'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE demo=1`).run());
  wipe();
  const today = new Date();
  const ym0 = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
  const months = [ym0, C.addMonths(ym0, 1), C.addMonths(ym0, 2)];
  const start = ym0 + '-01', until = C.lastDayOfMonth(months[2]);
  const holidays = [];
  [+ym0.slice(0, 4), +ym0.slice(0, 4) + 1].forEach((y) => {
    const h = C.holidaysFor(y);
    Object.keys(h).sort().forEach((d) => { if (h[d].holiday && d >= start && d <= until) holidays.push([d, h[d].name]); });
  });
  Object.keys(SAMPLE).forEach((facility) => {
    const owner = facility === KILBY ? chaplainId : null;
    SAMPLE[facility].forEach(([title, kind, st, en, loc, when]) => {
      const rule = Array.isArray(when)
        ? { freq: 'weekly', weekdays: when, until }
        : { freq: 'monthly', nth: when.nth, weekday: when.weekday, until };
      calendar.createEvents(facility, 1, owner, { title, detail: '', kind, allDay: 0, start: st, end: en, location: loc }, start, rule);
    });
    holidays.forEach(([d, name]) => calendar.createEvents(facility, 1, owner,
      { title: 'Chapel Closed', detail: name, kind: 'closed', allDay: 1, start: '', end: '', location: '' }, d, { freq: 'none' }));
    if (facility === 'North Alabama Community Work Center') {
      calendar.createEvents(facility, 1, null, { title: 'Closed for cleaning', detail: '', kind: 'closed', allDay: 1, start: '', end: '', location: '' },
        start, { freq: 'weekly', weekdays: [3], until });
    }
  });
  // sign-off state, so the supervisor view has a mix of drafts and final calendars
  const meta = db.prepare('UPDATE cal_months SET status=?, finalized_at=?, chaplain=?, warden=?, note=? WHERE demo=1 AND facility=? AND ym=?');
  Object.keys(SAMPLE).forEach((facility) => {
    months.forEach((ym, i) => {
      const final = FINAL_THIS.includes(facility) && i < 2;
      const note = facility === KILBY && i === 0 ? 'All services are subject to change by facility security. Volunteers must sign in at the front gate.' : '';
      meta.run(final ? 'final' : 'draft', final ? Date.now() : null, facility === KILBY ? 'Demo Chaplain' : 'Sample Chaplain', 'Sample Warden', note, facility, ym);
    });
  });
}

// Sample monthly tracking reports (last month's is the one due on the 5th), so every screen has something in it.
// Numbers are made up. AIS numbers on the roster all start with D so nobody mistakes them for real ones.
const RR_FACILITIES = [
  { name: KILBY, pop: 'men', cur: 'draft', mine: true },
  { name: 'Bibb Correctional Facility', pop: 'men', cur: 'submitted' },
  { name: 'St. Clair Correctional Facility', pop: 'men', cur: 'submitted' },
  { name: 'North Alabama Community Work Center', pop: 'men', cur: 'draft' },
  { name: 'Julia Tutwiler Prison for Women', pop: 'women', cur: 'submitted' },
];

function seedReports() {
  ['rr_reports', 'rr_roster'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE demo=1`).run());
  const cur = RR.currentReportMonth(reentry.today()), prev = RR.addMonths(cur, -1);
  const putReport = db.prepare(`INSERT INTO rr_reports (facility,demo,ym,data,status,submitted_at,submitted_by,updated_at,updated_by) VALUES (?,1,?,?,?,?,?,?,?)`);
  const putGrad = db.prepare('INSERT OR IGNORE INTO rr_roster (facility,demo,ais,program,grad_date,created_at,created_by) VALUES (?,1,?,?,?,?,?)');
  let ais = 4000;
  RR_FACILITIES.forEach((f, fi) => {
    const names = RR.PROGRAM_SETS[f.pop].slice(0, f.pop === 'men' ? 3 : 8);
    let carry = {};
    [prev, cur].forEach((ym, mi) => {
      const rep = RR.emptyReport(f.pop), counts = {};
      names.forEach((name, i) => {
        const p = RR.emptyProgram(name), seed = fi * 3 + i + mi;
        p.bf = carry[name] !== undefined ? carry[name] : 9 + ((seed * 5) % 14);
        p.enr = 3 + (seed % 4); p.tdisc = seed % 2; p.toth = i % 3 === 0 ? 1 : 0;
        const g = 1 + (seed % 3); counts[name] = g;
        for (let k = 0; k < g; k++) putGrad.run(f.name, 'D' + (++ais), name, ym + '-' + String(8 + k * 6 + i).padStart(2, '0'), Date.now(), 'demo');
        const total = RR.programTotal(p, g);
        p.black = Math.round(total * 0.6); p.white = Math.round(total * 0.3); p.other = total - p.black - p.white;
        if (p.other < 0) { p.white += p.other; p.other = 0; }
        carry[name] = total;
        rep.programs.push(p);
      });
      RR.DOCS.forEach((d, di) => { rep.docs[d.id] = { v: d.rows.map((_, k) => (fi + di * 2 + k * 3 + mi) % 11), total: 20 + ((fi + di * 7 + mi) % 25) }; });
      let status = ym === prev ? 'submitted' : f.cur;
      if (ym === cur && f.mine) {
        // the demo social worker's report is half done: two programs complete, one missing race counts, most service documents blank
        const last = rep.programs[2]; last.black = null; last.white = null; last.other = null;
        RR.DOCS.slice(2).forEach((d) => { rep.docs[d.id] = RR.emptyReport('men').docs[d.id]; });
        status = 'draft';
      }
      const due = Date.parse(RR.dueDate(ym) + 'T17:00:00Z'), done = status === 'submitted';
      putReport.run(f.name, ym, JSON.stringify(rep), status, done ? due - (1 + (fi % 3)) * 86400000 : null, done ? 'Sample Social Worker' : null, Date.now(), 'demo');
    });
  });
}

async function sync(password) {
  const now = Date.now();
  if (!password) {
    // No demo password: demo accounts are off and their sample data is gone.
    const demoIds = db.prepare('SELECT id FROM users WHERE demo=1').all().map((r) => r.id);
    if (demoIds.length) {
      db.prepare('UPDATE users SET active=0 WHERE demo=1').run();
      db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE demo=1)').run();
      ['cal_events', 'cal_series', 'cal_orgs', 'cal_months', 'rr_reports', 'rr_roster'].forEach((t) => db.prepare(`DELETE FROM ${t} WHERE demo=1`).run());
      console.log('Demo accounts are switched off (DEMO_PASSWORD is not set).');
    }
    return;
  }
  const policy = auth.passwordProblem(password, '');
  if (policy) { console.warn('DEMO_PASSWORD was ignored: ' + policy); return; }
  const ids = {};
  for (const a of ACCOUNTS) {
    const existing = db.prepare('SELECT id, demo FROM users WHERE email=?').get(a.email);
    if (existing && !existing.demo) { console.warn(`Demo account ${a.email} skipped: a real account already uses that email.`); continue; }
    const hash = await auth.hashPassword(password);
    if (existing) {
      db.prepare('UPDATE users SET name=?, role=?, facility=?, password_hash=?, must_change=0, active=1, failed_count=0, locked_until=0 WHERE id=?')
        .run(a.name, a.role, a.facility, hash, existing.id);
      ids[a.role] = existing.id;
    } else {
      ids[a.role] = Number(db.prepare('INSERT INTO users (email,name,role,facility,demo,password_hash,must_change,created_at) VALUES (?,?,?,?,1,?,0,?)')
        .run(a.email, a.name, a.role, a.facility, hash, now).lastInsertRowid);
    }
  }
  seedCalendars(ids.chaplain || null, ids.caseworker || null);
  seedReports();
  console.warn('DEMO accounts are ACTIVE (supervisor@, caseworker@, chaplain@doc.alabama.gov). Remove DEMO_PASSWORD before real use.');
}

module.exports = { sync, ACCOUNTS };
