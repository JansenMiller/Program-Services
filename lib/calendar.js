'use strict';
// Chapel calendar API: events (with repeats), the saved group-name dropdown, month notes/sign-off, and the supervisor overview.
const db = require('./db');
const C = require('../public/tools/chapel-calendar/calendar-core.js');
const { DEFAULT_FACILITIES } = require('./facilities');

class Bad extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ } throw e; }
}

function parseFields(b) {
  const title = clean(b.title, 80);
  if (!title) throw new Bad(400, 'Enter a group or event name.');
  const kind = C.KINDS.includes(b.kind) ? b.kind : 'service';
  const allDay = !!b.allDay;
  const start = allDay ? '' : (typeof b.start === 'string' ? b.start : '');
  const end = allDay ? '' : (typeof b.end === 'string' ? b.end : '');
  if (!C.validTime(start) || !C.validTime(end)) throw new Bad(400, 'Enter times like 1:30 PM.');
  if (end && !start) throw new Bad(400, 'Add a start time, or clear the end time.');
  if (start && end && end <= start) throw new Bad(400, 'The end time must be after the start time.');
  return { title, detail: clean(b.detail, 80), kind, allDay: allDay ? 1 : 0, start, end, location: clean(b.location, 60) };
}

// ---- saved group names ("the dropdown") ----
function saveOrg(facility, demo, f) {
  db.prepare(`INSERT INTO cal_orgs (facility,demo,name,kind,detail,all_day,start_time,end_time,location,last_used) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(facility,demo,name) DO UPDATE SET kind=excluded.kind, detail=excluded.detail, all_day=excluded.all_day,
      start_time=excluded.start_time, end_time=excluded.end_time, location=excluded.location, last_used=excluded.last_used`)
    .run(facility, demo, f.title, f.kind, f.detail, f.allDay, f.start, f.end, f.location, Date.now());
  // keep the casing the group was first saved with, so "kairos" and "Kairos" stay one entry
  return db.prepare('SELECT name FROM cal_orgs WHERE facility=? AND demo=? AND name=?').get(facility, demo, f.title).name;
}

// Any change to a month puts it back to draft, since "final" means nobody has touched it since sign-off.
function touchMonths(facility, demo, dates) {
  const now = Date.now();
  const yms = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const st = db.prepare(`INSERT INTO cal_months (facility,demo,ym,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(facility,demo,ym) DO UPDATE SET status='draft', finalized_at=NULL, updated_at=excluded.updated_at`);
  yms.forEach((ym) => st.run(facility, demo, ym, now));
}

function insertEvents(facility, demo, userId, f, dates, seriesId) {
  const st = db.prepare(`INSERT INTO cal_events (facility,demo,date,title,detail,kind,all_day,start_time,end_time,location,series_id,created_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const now = Date.now();
  dates.forEach((d) => st.run(facility, demo, d, f.title, f.detail, f.kind, f.allDay, f.start, f.end, f.location, seriesId, userId, now));
}

function createSeries(facility, demo, userId, rule) {
  return Number(db.prepare('INSERT INTO cal_series (facility,demo,rule,created_by,created_at) VALUES (?,?,?,?,?)')
    .run(facility, demo, JSON.stringify(rule), userId, Date.now()).lastInsertRowid);
}

// Shared by the API and by demo seeding.
function createEvents(facility, demo, userId, fields, date, repeat) {
  const ex = C.expandRule(date, repeat);
  if (ex.error) throw new Bad(400, ex.error);
  return tx(() => {
    const f = Object.assign({}, fields);
    f.title = saveOrg(facility, demo, f);
    const seriesId = ex.rule.freq === 'none' ? null : createSeries(facility, demo, userId, ex.rule);
    insertEvents(facility, demo, userId, f, ex.dates, seriesId);
    touchMonths(facility, demo, ex.dates);
    return { count: ex.dates.length, seriesId };
  });
}

function getEvent(id, facility, demo) {
  return db.prepare('SELECT * FROM cal_events WHERE id=? AND facility=? AND demo=?').get(id, facility, demo);
}
function dropEmptySeries() {
  db.exec('DELETE FROM cal_series WHERE NOT EXISTS (SELECT 1 FROM cal_events WHERE cal_events.series_id = cal_series.id)');
}

function updateEvent(facility, demo, userId, ev, b) {
  const f = parseFields(b);
  const date = b.date === undefined ? ev.date : b.date;
  if (!C.parseISO(date)) throw new Bad(400, 'Pick a valid date.');
  const scope = b.scope === 'following' ? 'following' : 'one';
  const repeat = b.repeat && typeof b.repeat === 'object' ? b.repeat : null;
  return tx(() => {
    f.title = saveOrg(facility, demo, f);
    const touched = [ev.date, date];
    const now = Date.now();
    const setRow = () => db.prepare(`UPDATE cal_events SET date=?,title=?,detail=?,kind=?,all_day=?,start_time=?,end_time=?,location=?,updated_at=? WHERE id=?`)
      .run(date, f.title, f.detail, f.kind, f.allDay, f.start, f.end, f.location, now, ev.id);

    // Just this one event
    if (ev.series_id && scope === 'one') { setRow(); touchMonths(facility, demo, touched); return { ok: true }; }
    if (!ev.series_id && (!repeat || repeat.freq === 'none' || repeat.freq === undefined)) { setRow(); touchMonths(facility, demo, touched); return { ok: true }; }

    // Rebuild: either turn a single event into a repeating series, or change this and all following events of a series.
    let rule = repeat;
    if (!rule && ev.series_id) rule = JSON.parse(db.prepare('SELECT rule FROM cal_series WHERE id=?').get(ev.series_id).rule);
    const ex = C.expandRule(date, rule || { freq: 'none' });
    if (ex.error) throw new Bad(400, ex.error);
    let seriesId = null;
    if (ev.series_id) {
      const gone = db.prepare('SELECT date FROM cal_events WHERE series_id=? AND date>=?').all(ev.series_id, ev.date).map((r) => r.date);
      touched.push(...gone);
      db.prepare('DELETE FROM cal_events WHERE series_id=? AND date>=?').run(ev.series_id, ev.date);
      if (ex.rule.freq !== 'none') { db.prepare('UPDATE cal_series SET rule=? WHERE id=?').run(JSON.stringify(ex.rule), ev.series_id); seriesId = ev.series_id; }
    } else {
      db.prepare('DELETE FROM cal_events WHERE id=?').run(ev.id);
      if (ex.rule.freq !== 'none') seriesId = createSeries(facility, demo, userId, ex.rule);
    }
    insertEvents(facility, demo, userId, f, ex.dates, seriesId);
    touched.push(...ex.dates);
    dropEmptySeries();
    touchMonths(facility, demo, touched);
    return { ok: true, count: ex.dates.length };
  });
}

function deleteEvent(facility, demo, ev, scope) {
  return tx(() => {
    let dates = [ev.date];
    if (ev.series_id && scope === 'following') {
      dates = db.prepare('SELECT date FROM cal_events WHERE series_id=? AND date>=?').all(ev.series_id, ev.date).map((r) => r.date);
      db.prepare('DELETE FROM cal_events WHERE series_id=? AND date>=?').run(ev.series_id, ev.date);
    } else {
      db.prepare('DELETE FROM cal_events WHERE id=?').run(ev.id);
    }
    dropEmptySeries();
    touchMonths(facility, demo, dates);
    return { ok: true, removed: dates.length };
  });
}

// ---- reading ----
const shape = (r, rules) => ({
  id: r.id, date: r.date, title: r.title, detail: r.detail, kind: r.kind, allDay: !!r.all_day,
  start: r.start_time, end: r.end_time, location: r.location, seriesId: r.series_id,
  repeat: r.series_id ? (rules[r.series_id] || null) : null,
});

function monthData(facility, demo, ym, user) {
  const rows = db.prepare('SELECT * FROM cal_events WHERE demo=? AND facility=? AND date>=? AND date<=? ORDER BY date, id')
    .all(demo, facility, ym + '-01', C.lastDayOfMonth(ym));
  const rules = {};
  [...new Set(rows.filter((r) => r.series_id).map((r) => r.series_id))].forEach((id) => {
    const s = db.prepare('SELECT rule FROM cal_series WHERE id=?').get(id);
    if (s) rules[id] = JSON.parse(s.rule);
  });
  const m = db.prepare('SELECT * FROM cal_months WHERE facility=? AND demo=? AND ym=?').get(facility, demo, ym) || {};
  const lastWarden = db.prepare("SELECT warden FROM cal_months WHERE facility=? AND demo=? AND warden!='' ORDER BY ym DESC LIMIT 1").get(facility, demo);
  const theChaplain = db.prepare("SELECT name FROM users WHERE role='chaplain' AND active=1 AND facility=? AND demo=? ORDER BY id LIMIT 1").get(facility, demo);
  const orgs = db.prepare('SELECT * FROM cal_orgs WHERE facility=? AND demo=? ORDER BY name').all(facility, demo).map((o) => ({
    id: o.id, name: o.name, kind: o.kind, detail: o.detail, allDay: !!o.all_day, start: o.start_time, end: o.end_time, location: o.location,
  }));
  const locs = db.prepare("SELECT DISTINCT location FROM cal_events WHERE facility=? AND demo=? AND location!='' ORDER BY location LIMIT 60").all(facility, demo).map((r) => r.location);
  return {
    facility, month: ym, events: rows.map((r) => shape(r, rules)), orgs, locations: locs,
    note: m.note || '', status: m.status || 'draft', updatedAt: m.updated_at || null,
    chaplain: m.chaplain || (user.role === 'chaplain' ? user.name : (theChaplain ? theChaplain.name : '')),
    warden: m.warden || (lastWarden ? lastWarden.warden : ''),
    canEdit: user.role === 'chaplain' && user.facility === facility,
  };
}

function allFacilities(demo) {
  const set = new Set(DEFAULT_FACILITIES);
  db.prepare("SELECT DISTINCT facility FROM users WHERE facility!='' AND demo=?").all(demo).forEach((r) => set.add(r.facility));
  db.prepare('SELECT DISTINCT facility FROM cal_events WHERE demo=?').all(demo).forEach((r) => set.add(r.facility));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function overview(demo) {
  const rows = db.prepare('SELECT facility, substr(date,1,7) AS ym, COUNT(*) AS n, MAX(updated_at) AS updated FROM cal_events WHERE demo=? GROUP BY facility, ym').all(demo);
  const months = db.prepare('SELECT * FROM cal_months WHERE demo=?').all(demo);
  const byKey = new Map(months.map((m) => [m.facility + '|' + m.ym, m]));
  const chaplains = db.prepare("SELECT name, facility FROM users WHERE role='chaplain' AND active=1 AND facility!='' AND demo=? ORDER BY id").all(demo);
  const nameFor = new Map(); chaplains.forEach((c) => { if (!nameFor.has(c.facility)) nameFor.set(c.facility, c.name); });
  return {
    calendars: rows.map((r) => {
      const m = byKey.get(r.facility + '|' + r.ym) || {};
      return { facility: r.facility, month: r.ym, events: r.n, status: m.status || 'draft', updatedAt: Math.max(r.updated || 0, m.updated_at || 0), chaplain: m.chaplain || nameFor.get(r.facility) || '' };
    }),
    chaplains,
    facilities: allFacilities(demo),
  };
}

// ---- HTTP ----
// ctx: { req, res, p, sess, ip, json, readJson, audit }. Returns true when the request was for the calendar API.
async function handle(ctx) {
  const { req, res, p, sess, json, readJson, audit, ip } = ctx;
  const isCal = p.startsWith('/api/calendar/') || p === '/api/facilities';
  if (!isCal) return false;
  const u = sess.user, demo = u.demo ? 1 : 0, m = req.method;
  const url = new URL(req.url, 'http://x');
  try {
    if (p === '/api/facilities' && m === 'GET') { json(res, 200, { facilities: allFacilities(demo) }); return true; }
    if (u.role !== 'chaplain' && u.role !== 'supervisor') { json(res, 403, { error: 'Not allowed.' }); return true; }

    if (p === '/api/calendar/overview' && m === 'GET') {
      if (u.role !== 'supervisor') { json(res, 403, { error: 'Not allowed.' }); return true; }
      json(res, 200, overview(demo)); return true;
    }

    if (p === '/api/calendar/month' && m === 'GET') {
      const month = url.searchParams.get('month') || '';
      if (!C.validMonth(month)) throw new Bad(400, 'Choose a month.');
      const facility = u.role === 'chaplain' ? u.facility : clean(url.searchParams.get('facility') || '', 80);
      if (!facility) throw new Bad(400, u.role === 'chaplain' ? 'Your account has no facility yet. Ask a supervisor to set it.' : 'Choose a facility.');
      json(res, 200, monthData(facility, demo, month, u)); return true;
    }

    // Everything below changes data: chaplains only, and only for their own facility.
    if (m !== 'POST') return false;
    if (u.role !== 'chaplain' || !u.facility) { json(res, 403, { error: 'Only the facility chaplain can change this calendar.' }); return true; }
    const facility = u.facility;
    const b = await readJson(req);
    let mm;

    if (p === '/api/calendar/events') {
      const f = parseFields(b);
      if (!C.parseISO(b.date)) throw new Bad(400, 'Pick a valid date.');
      json(res, 201, Object.assign({ ok: true }, createEvents(facility, demo, u.id, f, b.date, b.repeat))); return true;
    }
    if ((mm = p.match(/^\/api\/calendar\/events\/(\d+)\/(update|delete)$/))) {
      const ev = getEvent(Number(mm[1]), facility, demo);
      if (!ev) throw new Bad(404, 'Event not found.');
      if (mm[2] === 'update') json(res, 200, updateEvent(facility, demo, u.id, ev, b));
      else json(res, 200, deleteEvent(facility, demo, ev, b.scope === 'following' ? 'following' : 'one'));
      return true;
    }
    if ((mm = p.match(/^\/api\/calendar\/orgs\/(\d+)\/delete$/))) {
      const r = db.prepare('DELETE FROM cal_orgs WHERE id=? AND facility=? AND demo=?').run(Number(mm[1]), facility, demo);
      if (!r.changes) throw new Bad(404, 'Not found.');
      json(res, 200, { ok: true }); return true;
    }
    if (p === '/api/calendar/month') {
      const ym = b.month;
      if (!C.validMonth(ym)) throw new Bad(400, 'Choose a month.');
      const cur = db.prepare('SELECT * FROM cal_months WHERE facility=? AND demo=? AND ym=?').get(facility, demo, ym);
      const note = b.note === undefined ? (cur ? cur.note : '') : clean(String(b.note).replace(/\r/g, ''), 600);
      const warden = b.warden === undefined ? (cur ? cur.warden : '') : clean(b.warden, 80);
      const chaplain = b.chaplain === undefined ? (cur ? cur.chaplain : '') : clean(b.chaplain, 80);
      let status = cur ? cur.status : 'draft';
      let finalizedAt = cur ? cur.finalized_at : null;
      if (b.status === 'final') {
        const n = db.prepare('SELECT COUNT(*) c FROM cal_events WHERE facility=? AND demo=? AND date>=? AND date<=?').get(facility, demo, ym + '-01', C.lastDayOfMonth(ym)).c;
        if (!n) throw new Bad(400, 'Add at least one event before marking the calendar final.');
        status = 'final'; finalizedAt = Date.now();
        audit(u.email, 'calendar_final', `${facility} ${ym}`, ip);
      } else if (b.status === 'draft') { status = 'draft'; finalizedAt = null; audit(u.email, 'calendar_reopen', `${facility} ${ym}`, ip); }
      else if (status === 'final') { status = 'draft'; finalizedAt = null; } // edited after sign-off
      db.prepare(`INSERT INTO cal_months (facility,demo,ym,note,chaplain,warden,status,finalized_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(facility,demo,ym) DO UPDATE SET note=excluded.note, chaplain=excluded.chaplain, warden=excluded.warden, status=excluded.status, finalized_at=excluded.finalized_at, updated_at=excluded.updated_at`)
        .run(facility, demo, ym, note, chaplain, warden, status, finalizedAt, Date.now());
      json(res, 200, { ok: true, status }); return true;
    }
  } catch (e) {
    if (e instanceof Bad) { json(res, e.status, { error: e.message }); return true; }
    throw e;
  }
  return false;
}

module.exports = { handle, createEvents, parseFields, monthData, overview, allFacilities, Bad, tx, touchMonths };
