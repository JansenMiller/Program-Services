'use strict';
// Shared by the browser and the server: what the monthly Statistical and Tracking Report contains, how totals are worked out,
// and what must be fixed before a report can be submitted. No dependencies.
(function (root) {
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // Programs offered, taken from the Men's and Women's workbooks. Each workbook has room for this many programs.
  var SLOTS = { men: 8, women: 12 };
  var PROGRAM_SETS = {
    men: ['Anger Management', 'Changing Offender Behavior (CBT)', 'Getting It Right'],
    women: ['Anger Management', 'Changing Offender Behavior (CBT)', 'Getting It Right', 'Active Adult Relationships', 'Beyond Violence', 'Beyond Trauma',
      'Getting Ahead While Getting Out', 'Helping Women Recover', 'Moving On', 'Parenting Inside Out', 'A Woman’s Way (Aftercare)'],
  };
  // Program numbers, in the order they appear on the workbook (rows 7 to 11 of each program block)
  var PROGRAM_FIELDS = [
    { key: 'bf', label: 'Offenders brought forward' },
    { key: 'enr', label: 'New offender enrollments' },
    { key: 'tdisc', label: 'Offenders terminated: disciplinary' },
    { key: 'toth', label: 'Offenders terminated: other reasons' },
    { key: 'grad', label: 'Offenders graduated' },
  ];
  var RACE_FIELDS = [
    { key: 'black', label: 'Offender race: Black' },
    { key: 'white', label: 'Offender race: White' },
    { key: 'other', label: 'Offender race: Other' },
  ];

  var APP_ROWS = ['Applications brought forward (pending)', 'Applications started', 'Applications completed', 'Applications submitted', 'Applications approved', 'Applications denied', 'Applications withdrawn'];
  // Service documents: each block lists its seven lines (six for refusals) and one end-of-month total, as on the workbook.
  var DOCS = [
    { id: 'birth', name: 'Birth Certificates', total: 'Total certificates processed, end of month',
      rows: ['Certificates on hand (beginning inventory)', 'New requests processed', 'Certificates ordered', 'Certificates received', 'Certificates distributed', 'Outstanding orders (not yet received)', 'Requests pending processing'] },
    { id: 'ss', name: 'Social Security Cards', total: 'Total SS cards processed, end of month',
      rows: ['SS cards on hand (beginning inventory)', 'New requests processed', 'SS cards ordered', 'SS cards received', 'SS cards distributed', 'Outstanding orders (not yet received)', 'SS cards pending processing'] },
    { id: 'license', name: 'Driver’s Licenses', total: 'Total licenses processed, end of month',
      rows: ['Licenses on hand (beginning inventory)', 'New requests processed', 'Licenses ordered', 'Licenses received', 'Licenses distributed', 'Outstanding orders (not yet received)', 'Requests pending processing'] },
    { id: 'ndid', name: 'Non-Driver Identification', total: 'Total ID cards processed, end of month',
      rows: ['Non-driver IDs on hand (beginning inventory)', 'New requests processed', 'IDs ordered', 'IDs received', 'IDs distributed', 'Outstanding orders (not yet received)', 'Requests pending processing'] },
    { id: 'food', name: 'Food Stamp Applications', total: 'Total applications processed, end of month', rows: APP_ROWS },
    { id: 'medical', name: 'Medical Insurance Applications', total: 'Total applications processed, end of month', rows: APP_ROWS },
    { id: 'refusals', name: 'Refusals', total: 'Total refusals, end of month',
      rows: ['Birth certificates', 'Social Security cards', 'Driver’s licenses', 'Non-driver ID cards', 'Food stamp applications', 'Medical insurance applications'] },
  ];

  /* ---------- months and the deadline ---------- */
  function validMonth(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || '')); }
  function addMonths(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function monthLabel(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  // The report for a month is due to the Regional Reentry Coordinator on the 5th of the following month.
  function dueDate(ym) { return addMonths(ym, 1) + '-05'; }
  function dayDiff(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000); }
  // The month whose report is the one to work on today: last month's, until the 5th has passed and it is turned in.
  function currentReportMonth(todayISO) { return addMonths(todayISO.slice(0, 7), -1); }

  /* ---------- numbers ---------- */
  function intOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
    return Number.isInteger(n) && n >= 0 && n <= 99999 ? n : null;
  }
  var n0 = function (v) { return v === null || v === undefined || v === '' ? 0 : v; };

  function emptyProgram(name) { return { name: name, bf: null, enr: null, tdisc: null, toth: null, grad: null, black: null, white: null, other: null }; }
  function emptyDoc(def) { var v = []; for (var i = 0; i < def.rows.length; i++) v.push(null); return { v: v, total: null }; }
  function emptyReport(population) {
    var docs = {};
    DOCS.forEach(function (d) { docs[d.id] = emptyDoc(d); });
    return { population: population === 'women' ? 'women' : 'men', programs: [], docs: docs };
  }
  // Women's institutions use the Women's workbook.
  function guessPopulation(facility) { return /women|tutwiler/i.test(String(facility || '')) ? 'women' : 'men'; }

  // Graduated: what was typed, or the number of graduates listed on the roster for that program and month.
  function effGrad(p, rosterN) { return p.grad !== null && p.grad !== undefined ? p.grad : (rosterN || 0); }
  function programTotal(p, rosterN) { return n0(p.bf) + n0(p.enr) - n0(p.tdisc) - n0(p.toth) - effGrad(p, rosterN); }
  function raceTotal(p) { return n0(p.black) + n0(p.white) + n0(p.other); }

  // Tidy whatever the browser sent into the stored shape.
  function sanitize(input, population) {
    var rep = emptyReport(population || (input && input.population));
    var progs = input && Array.isArray(input.programs) ? input.programs : [];
    var seen = {};
    progs.forEach(function (p) {
      if (rep.programs.length >= SLOTS[rep.population]) return;
      var name = String(p && p.name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!name || seen[name.toLowerCase()]) return;
      seen[name.toLowerCase()] = 1;
      var q = emptyProgram(name);
      ['bf', 'enr', 'tdisc', 'toth', 'grad', 'black', 'white', 'other'].forEach(function (k) { q[k] = intOrNull(p[k]); });
      rep.programs.push(q);
    });
    DOCS.forEach(function (d) {
      var src = input && input.docs && input.docs[d.id];
      if (!src) return;
      rep.docs[d.id].v = d.rows.map(function (_, i) { return intOrNull(src.v && src.v[i]); });
      rep.docs[d.id].total = intOrNull(src.total);
    });
    return rep;
  }

  /* ---------- what must be fixed before submitting ---------- */
  // rosterCounts: { programName: graduates listed for the month }. prevTotals: { programName: last month's end-of-month total } or null.
  function validate(rep, rosterCounts, prevTotals) {
    var out = [];
    function add(level, tab, where, msg) { out.push({ level: level, tab: tab, where: where, msg: msg }); }
    rosterCounts = rosterCounts || {};
    if (!rep.programs.length) add('error', 'programs', 'Programs', 'Add at least one program.');
    rep.programs.forEach(function (p) {
      var missing = [];
      PROGRAM_FIELDS.forEach(function (f) { if (f.key !== 'grad' && p[f.key] === null) missing.push(f.label); });
      RACE_FIELDS.forEach(function (f) { if (p[f.key] === null) missing.push(f.label); });
      if (missing.length) { add('error', 'programs', p.name, 'Enter a number for: ' + missing.join(', ') + '. Use 0 if there were none.'); return; }
      var rn = rosterCounts[p.name] || 0, total = programTotal(p, rn);
      if (total < 0) add('error', 'programs', p.name, 'The end-of-month total comes out to ' + total + '. Check enrollments, terminations and graduations against the number brought forward.');
      else if (raceTotal(p) !== total) add('error', 'programs', p.name, 'The race counts add up to ' + raceTotal(p) + ' but the total participating is ' + total + '. They need to match.');
      if (p.grad !== null && p.grad !== rn) add('warn', 'programs', p.name, 'You entered ' + p.grad + ' graduated, but the Graduation Roster lists ' + rn + ' for this month.');
      if (prevTotals && prevTotals[p.name] !== undefined && prevTotals[p.name] !== p.bf) add('warn', 'programs', p.name, 'Brought forward is ' + p.bf + ' but last month ended at ' + prevTotals[p.name] + '.');
    });
    DOCS.forEach(function (d) {
      var doc = rep.docs[d.id], miss = [];
      d.rows.forEach(function (r, i) { if (doc.v[i] === null) miss.push(r); });
      if (doc.total === null) miss.push(d.total);
      if (miss.length) add('error', 'docs', d.name, miss.length === d.rows.length + 1 ? 'Nothing entered yet. Enter the numbers, or use “Nothing this month” to fill in zeros.' : miss.length + ' line' + (miss.length === 1 ? '' : 's') + ' still blank. Use 0 if there were none.');
    });
    return out;
  }

  // Graduation Roster entries: AIS numbers are letters, digits and dashes.
  function cleanAis(v) { return String(v || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 14).toUpperCase(); }
  function validISODate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    return d.getUTCFullYear() === +s.slice(0, 4) && d.getUTCMonth() === +s.slice(5, 7) - 1 && d.getUTCDate() === +s.slice(8, 10);
  }
  // Dates a person might paste: 10/14/2026, 10-14-26, 2026-10-14. Returns YYYY-MM-DD or ''.
  function parseDate(s) {
    s = String(s || '').trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return fix(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/))) return fix(m[3].length === 2 ? '20' + m[3] : m[3], m[1], m[2]);
    return '';
    function fix(y, mo, d) { var iso = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2); return validISODate(iso) ? iso : ''; }
  }

  var api = {
    MONTHS: MONTHS, SLOTS: SLOTS, PROGRAM_SETS: PROGRAM_SETS, PROGRAM_FIELDS: PROGRAM_FIELDS, RACE_FIELDS: RACE_FIELDS, DOCS: DOCS,
    validMonth: validMonth, addMonths: addMonths, monthLabel: monthLabel, dueDate: dueDate, dayDiff: dayDiff, currentReportMonth: currentReportMonth,
    intOrNull: intOrNull, emptyProgram: emptyProgram, emptyReport: emptyReport, guessPopulation: guessPopulation,
    effGrad: effGrad, programTotal: programTotal, raceTotal: raceTotal, sanitize: sanitize, validate: validate,
    cleanAis: cleanAis, validISODate: validISODate, parseDate: parseDate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ReportCore = api;
})(typeof window !== 'undefined' ? window : this);
