'use strict';
// Monthly Statistical and Tracking Report for reentry social workers: saved numbers, the Graduation Roster, the 5th-of-the-month
// deadline, the supervisor overview, and the Excel download in the department's own workbook format.
const db = require('./db');
const R = require('../public/tools/reentry-report/report-core.js');
const { buildWorkbook, fileName } = require('./reentry-export');

class Bad extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

// "Today" in Alabama (Central time), so the deadline flips at midnight there. PORTAL_TODAY lets tests pin the date.
function today() {
  if (process.env.PORTAL_TODAY) return process.env.PORTAL_TODAY;
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}
const lastDay = (ym) => ym + '-' + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, '0');

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ } throw e; }
}

/* ---------- reading ---------- */
function rosterCountsFor(facility, demo, ym) {
  const out = {};
  db.prepare('SELECT program, COUNT(*) n FROM rr_roster WHERE facility=? AND demo=? AND grad_date>=? AND grad_date<=? GROUP BY program')
    .all(facility, demo, ym + '-01', lastDay(ym)).forEach((r) => { out[r.program] = r.n; });
  return out;
}
const rosterForMonth = (facility, demo, ym) => db.prepare('SELECT id, ais, program, grad_date FROM rr_roster WHERE facility=? AND demo=? AND grad_date>=? AND grad_date<=? ORDER BY grad_date, program, ais')
  .all(facility, demo, ym + '-01', lastDay(ym)).map((r) => ({ id: r.id, ais: r.ais, program: r.program, date: r.grad_date }));

function savedRow(facility, demo, ym) { return db.prepare('SELECT * FROM rr_reports WHERE facility=? AND demo=? AND ym=?').get(facility, demo, ym); }
function parseData(row, facility) {
  let d = {};
  try { d = JSON.parse(row.data); } catch (_) { /* treated as empty */ }
  return R.sanitize(d, d.population || R.guessPopulation(facility));
}

// The most recent report saved before this month (for the program list, the population, and "brought forward").
function previousRow(facility, demo, ym) {
  return db.prepare('SELECT * FROM rr_reports WHERE facility=? AND demo=? AND ym<? ORDER BY ym DESC LIMIT 1').get(facility, demo, ym);
}
function totalsOf(rep, counts) { const o = {}; rep.programs.forEach((p) => { o[p.name] = R.programTotal(p, counts[p.name] || 0); }); return o; }

// The report as the screen should show it: saved numbers if any, otherwise a fresh one built from last month.
function loadReport(facility, demo, ym) {
  const row = savedRow(facility, demo, ym);
  const prev = previousRow(facility, demo, ym);
  const prevRep = prev ? parseData(prev, facility) : null;
  const prevTotals = prev && prev.ym === R.addMonths(ym, -1) ? totalsOf(prevRep, rosterCountsFor(facility, demo, prev.ym)) : null;
  let rep;
  if (row) rep = parseData(row, facility);
  else {
    rep = R.emptyReport(prevRep ? prevRep.population : R.guessPopulation(facility));
    const names = prevRep && prevRep.programs.length ? prevRep.programs.map((p) => p.name) : R.PROGRAM_SETS[rep.population];
    rep.programs = names.slice(0, R.SLOTS[rep.population]).map((n) => R.emptyProgram(n));
  }
  // brought forward = last month's end-of-month total, unless the person typed something else
  const auto = {};
  rep.programs.forEach((p) => { if (p.bf === null && prevTotals && prevTotals[p.name] !== undefined && prevTotals[p.name] >= 0) { p.bf = prevTotals[p.name]; auto[p.name] = true; } });
  const hints = prevRep && prev.ym === R.addMonths(ym, -1) ? prevRep.docs : null;
  return { row, rep, prevTotals, auto, hints };
}

function reportPayload(facility, demo, ym, user) {
  const { row, rep, prevTotals, auto, hints } = loadReport(facility, demo, ym);
  const counts = rosterCountsFor(facility, demo, ym);
  return {
    facility, month: ym, label: R.monthLabel(ym), due: R.dueDate(ym), today: today(),
    population: rep.population, programs: rep.programs, docs: rep.docs, auto, hints,
    status: row ? row.status : 'draft', saved: !!row, submittedAt: row ? row.submitted_at : null, submittedBy: row ? row.submitted_by : null,
    updatedAt: row ? row.updated_at : null,
    roster: rosterForMonth(facility, demo, ym), rosterCounts: counts,
    rosterTotal: db.prepare('SELECT COUNT(*) c FROM rr_roster WHERE facility=? AND demo=?').get(facility, demo).c,
    prevTotals, slots: R.SLOTS[rep.population], issues: R.validate(rep, counts, prevTotals),
    canEdit: user.role === 'caseworker' && user.facility === facility,
  };
}

/* ---------- writing ---------- */
function reopenIfSubmitted(facility, demo, ym) {
  db.prepare("UPDATE rr_reports SET status='draft', submitted_at=NULL, submitted_by=NULL WHERE facility=? AND demo=? AND ym=? AND status='submitted'").run(facility, demo, ym);
}

function saveReport(facility, demo, ym, input, user) {
  const rep = R.sanitize(input, input && input.population);
  const prevRow = savedRow(facility, demo, ym);
  const data = JSON.stringify(rep);
  const now = Date.now();
  db.prepare(`INSERT INTO rr_reports (facility,demo,ym,data,status,updated_at,updated_by) VALUES (?,?,?,?, 'draft', ?, ?)
    ON CONFLICT(facility,demo,ym) DO UPDATE SET data=excluded.data, status='draft', submitted_at=NULL, submitted_by=NULL, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(facility, demo, ym, data, now, user.email);
  return { wasSubmitted: !!(prevRow && prevRow.status === 'submitted') };
}

function addRoster(facility, demo, user, program, entries, defaultDate) {
  program = clean(program, 60);
  if (!program) throw new Bad(400, 'Choose the program these offenders graduated from.');
  let added = 0, dup = 0; const bad = [], touched = new Set();
  const ins = db.prepare('INSERT OR IGNORE INTO rr_roster (facility,demo,ais,program,grad_date,created_at,created_by) VALUES (?,?,?,?,?,?,?)');
  tx(() => {
    for (const e of entries.slice(0, 500)) {
      const ais = R.cleanAis(e && e.ais), date = R.parseDate(e && e.date) || R.parseDate(defaultDate);
      if (!ais) { bad.push(String(e && e.ais || '').slice(0, 20) || '(blank)'); continue; }
      if (!date) { bad.push(ais + ' (no valid date)'); continue; }
      const r = ins.run(facility, demo, ais, program, date, Date.now(), user.email);
      if (r.changes) { added++; touched.add(date.slice(0, 7)); } else dup++;
    }
    touched.forEach((ym) => reopenIfSubmitted(facility, demo, ym));
  });
  return { added, duplicates: dup, invalid: bad, months: [...touched] };
}

/* ---------- deadline and overview ---------- */
function expectedFacilities(demo, ym) {
  const set = new Map();
  db.prepare("SELECT name, facility FROM users WHERE role='caseworker' AND active=1 AND facility!='' AND demo=? ORDER BY name").all(demo)
    .forEach((u) => { if (!set.has(u.facility)) set.set(u.facility, []); set.get(u.facility).push(u.name); });
  db.prepare('SELECT facility FROM rr_reports WHERE demo=? AND ym=?').all(demo, ym).forEach((r) => { if (!set.has(r.facility)) set.set(r.facility, []); });
  return set;
}

function overview(demo, ym) {
  const reports = new Map(db.prepare('SELECT * FROM rr_reports WHERE demo=? AND ym=?').all(demo, ym).map((r) => [r.facility, r]));
  const facs = expectedFacilities(demo, ym);
  const rows = [];
  for (const [facility, names] of facs) {
    const r = reports.get(facility);
    const counts = rosterCountsFor(facility, demo, ym);
    rows.push({
      facility, caseworkers: names, status: r ? r.status : 'notstarted', submittedAt: r ? r.submitted_at : null, submittedBy: r ? r.submitted_by : null,
      updatedAt: r ? r.updated_at : null, programs: r ? parseData(r, facility).programs.length : 0, graduates: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  }
  const months = new Set(db.prepare('SELECT DISTINCT ym FROM rr_reports WHERE demo=?').all(demo).map((r) => r.ym));
  months.add(ym); months.add(R.currentReportMonth(today()));
  return { month: ym, label: R.monthLabel(ym), due: R.dueDate(ym), today: today(), facilities: rows, months: [...months].sort().reverse() };
}

function statusFor(user) {
  const demo = user.demo ? 1 : 0, t = today(), ym = R.currentReportMonth(t);
  const out = { month: ym, label: R.monthLabel(ym), due: R.dueDate(ym), today: t, daysLeft: R.dayDiff(t, R.dueDate(ym)) };
  if (user.role === 'caseworker') {
    if (!user.facility) return Object.assign(out, { kind: 'caseworker', facility: '', status: 'nofacility' });
    const r = savedRow(user.facility, demo, ym);
    return Object.assign(out, { kind: 'caseworker', facility: user.facility, status: r ? r.status : 'notstarted', nextDue: R.dueDate(R.addMonths(ym, 1)), nextLabel: R.monthLabel(R.addMonths(ym, 1)) });
  }
  const o = overview(demo, ym), n = (s) => o.facilities.filter((f) => f.status === s).length;
  return Object.assign(out, { kind: 'supervisor', expected: o.facilities.length, submitted: n('submitted'), draft: n('draft'), notStarted: n('notstarted') });
}

/* ---------- HTTP ---------- */
async function handle(ctx) {
  const { req, res, p, sess, json, readJson, audit, ip } = ctx;
  if (!p.startsWith('/api/reentry/')) return false;
  const u = sess.user, demo = u.demo ? 1 : 0, m = req.method;
  const url = new URL(req.url, 'http://x');
  try {
    if (u.role !== 'caseworker' && u.role !== 'supervisor') { json(res, 403, { error: 'Not allowed.' }); return true; }
    const sup = u.role === 'supervisor';
    const month = url.searchParams.get('month') || '';
    const facilityFor = (src) => {
      const f = sup ? clean(src || '', 80) : u.facility;
      if (!f) throw new Bad(400, sup ? 'Choose a facility.' : 'Your account has no facility yet. Ask a supervisor to set it.');
      return f;
    };

    if (p === '/api/reentry/status' && m === 'GET') { json(res, 200, statusFor(u)); return true; }

    if (p === '/api/reentry/overview' && m === 'GET') {
      if (!sup) { json(res, 403, { error: 'Not allowed.' }); return true; }
      json(res, 200, overview(demo, R.validMonth(month) ? month : R.currentReportMonth(today()))); return true;
    }

    if (p === '/api/reentry/report' && m === 'GET') {
      if (!R.validMonth(month)) throw new Bad(400, 'Choose a month.');
      json(res, 200, reportPayload(facilityFor(url.searchParams.get('facility')), demo, month, u)); return true;
    }

    if (p === '/api/reentry/export' && m === 'GET') {
      if (!R.validMonth(month)) throw new Bad(400, 'Choose a month.');
      const facility = facilityFor(url.searchParams.get('facility'));
      const { rep } = loadReport(facility, demo, month);
      const counts = rosterCountsFor(facility, demo, month);
      const all = url.searchParams.get('roster') !== 'month';
      const roster = db.prepare(`SELECT ais, program, grad_date FROM rr_roster WHERE facility=? AND demo=? AND grad_date<=? ${all ? '' : 'AND grad_date>=?'} ORDER BY grad_date, program, ais`)
        .all(...[facility, demo, lastDay(month)].concat(all ? [] : [month + '-01'])).map((r) => ({ ais: r.ais, program: r.program, date: r.grad_date }));
      const buf = buildWorkbook({ report: rep, facility, month, roster, rosterCounts: counts });
      audit(u.email, 'report_export', `${facility} ${month}`, ip);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${fileName(facility, month)}"`, 'Cache-Control': 'no-store',
      });
      res.end(buf); return true;
    }

    // Everything below changes data: the facility's own social worker only.
    if (m !== 'POST') return false;
    if (u.role !== 'caseworker' || !u.facility) { json(res, 403, { error: 'Only the facility’s social worker can change this report.' }); return true; }
    const facility = u.facility, b = await readJson(req);
    let mm;

    if (p === '/api/reentry/report') {
      if (!R.validMonth(b.month)) throw new Bad(400, 'Choose a month.');
      const out = saveReport(facility, demo, b.month, b, u);
      json(res, 200, { ok: true, status: 'draft', reopened: out.wasSubmitted }); return true;
    }
    if (p === '/api/reentry/roster') {
      if (!Array.isArray(b.rows) || !b.rows.length) throw new Bad(400, 'Add at least one AIS number.');
      json(res, 200, Object.assign({ ok: true }, addRoster(facility, demo, u, b.program, b.rows, b.defaultDate))); return true;
    }
    if ((mm = p.match(/^\/api\/reentry\/roster\/(\d+)\/delete$/))) {
      const row = db.prepare('SELECT grad_date FROM rr_roster WHERE id=? AND facility=? AND demo=?').get(Number(mm[1]), facility, demo);
      if (!row) throw new Bad(404, 'Not found.');
      db.prepare('DELETE FROM rr_roster WHERE id=?').run(Number(mm[1]));
      reopenIfSubmitted(facility, demo, row.grad_date.slice(0, 7));
      json(res, 200, { ok: true }); return true;
    }
    if (p === '/api/reentry/submit') {
      if (!R.validMonth(b.month)) throw new Bad(400, 'Choose a month.');
      const row = savedRow(facility, demo, b.month);
      if (!row) throw new Bad(400, 'Save the report first.');
      const rep = parseData(row, facility), counts = rosterCountsFor(facility, demo, b.month);
      const issues = R.validate(rep, counts, null).filter((i) => i.level === 'error');
      if (issues.length) throw new Bad(400, issues.length + (issues.length === 1 ? ' thing needs' : ' things need') + ' fixing before this can be submitted.', { issues });
      db.prepare("UPDATE rr_reports SET status='submitted', submitted_at=?, submitted_by=? WHERE facility=? AND demo=? AND ym=?").run(Date.now(), u.name, facility, demo, b.month);
      audit(u.email, 'report_submit', `${facility} ${b.month}`, ip);
      json(res, 200, { ok: true, status: 'submitted' }); return true;
    }
    if (p === '/api/reentry/reopen') {
      if (!R.validMonth(b.month)) throw new Bad(400, 'Choose a month.');
      reopenIfSubmitted(facility, demo, b.month);
      audit(u.email, 'report_reopen', `${facility} ${b.month}`, ip);
      json(res, 200, { ok: true, status: 'draft' }); return true;
    }
  } catch (e) {
    if (e instanceof Bad) { json(res, e.status, Object.assign({ error: e.message }, e.extra || {})); return true; }
    throw e;
  }
  return false;
}

module.exports = { handle, today, loadReport, saveReport, addRoster, overview, statusFor, reportPayload, rosterCountsFor, Bad };
