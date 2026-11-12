'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/tools/reentry-report/report-core.js');

test('months and the 5th-of-the-month deadline', () => {
  assert.equal(R.dueDate('2026-10'), '2026-11-05');
  assert.equal(R.dueDate('2026-12'), '2027-01-05');
  assert.equal(R.currentReportMonth('2026-11-11'), '2026-10');
  assert.equal(R.currentReportMonth('2026-01-03'), '2025-12');
  assert.equal(R.dayDiff('2026-11-11', '2026-11-05'), -6);
  assert.equal(R.monthLabel('2026-10'), 'October 2026');
});

test('end-of-month total is brought forward plus enrollments minus terminations and graduates', () => {
  const p = R.emptyProgram('Anger Management');
  Object.assign(p, { bf: 10, enr: 4, tdisc: 1, toth: 2, black: 6, white: 3, other: 0 });
  assert.equal(R.programTotal(p, 2), 9);          // graduated left blank: uses the 2 on the roster
  p.grad = 3;
  assert.equal(R.programTotal(p, 2), 8);          // typed number wins
  assert.equal(R.raceTotal(p), 9);
});

test('what blocks submission, and what only warns', () => {
  const rep = R.emptyReport('men');
  assert.equal(R.validate(rep, {}, null).filter((i) => i.level === 'error')[0].msg, 'Add at least one program.');
  const p = R.emptyProgram('Getting It Right');
  rep.programs.push(p);
  let issues = R.validate(rep, {}, null);
  assert.ok(issues.some((i) => i.where === 'Getting It Right' && /Enter a number for/.test(i.msg)));
  Object.assign(p, { bf: 10, enr: 5, tdisc: 0, toth: 0, black: 8, white: 4, other: 0 });
  issues = R.validate(rep, { 'Getting It Right': 3 }, null);
  assert.ok(issues.some((i) => i.level === 'error' && /race counts add up to 12 but the total participating is 12/.test(i.msg)) === false);
  Object.assign(p, { black: 9 });                  // 13 vs 12
  issues = R.validate(rep, { 'Getting It Right': 3 }, null);
  assert.ok(issues.some((i) => i.level === 'error' && /add up to 13 but the total participating is 12/.test(i.msg)));
  Object.assign(p, { black: 8, grad: 5 });         // typed 5, roster says 3: a warning, and total becomes 10 so race (12) now mismatches
  issues = R.validate(rep, { 'Getting It Right': 3 }, { 'Getting It Right': 11 });
  assert.ok(issues.some((i) => i.level === 'warn' && /lists 3/.test(i.msg)));
  assert.ok(issues.some((i) => i.level === 'warn' && /last month ended at 11/.test(i.msg)));
  Object.assign(p, { bf: 1, enr: 0, tdisc: 0, toth: 0, grad: 4, black: 0, white: 0, other: 0 });
  assert.ok(R.validate(rep, {}, null).some((i) => i.level === 'error' && /comes out to -3/.test(i.msg)));
});

test('service documents must be filled in, with zeros if there was nothing', () => {
  const rep = R.emptyReport('men');
  rep.programs.push(Object.assign(R.emptyProgram('X'), { bf: 1, enr: 0, tdisc: 0, toth: 0, black: 1, white: 0, other: 0 }));
  const docs = R.validate(rep, {}, null).filter((i) => i.tab === 'docs');
  assert.equal(docs.length, R.DOCS.length);
  R.DOCS.forEach((d) => { rep.docs[d.id] = { v: d.rows.map(() => 0), total: 0 }; });
  assert.equal(R.validate(rep, {}, null).filter((i) => i.level === 'error').length, 0);
});

test('typed input is tidied: whole numbers only, no duplicate programs, limited to what the workbook has room for', () => {
  const rep = R.sanitize({ population: 'men', programs: [
    { name: ' Anger   Management ', bf: '12', enr: '3.5', tdisc: -1, toth: '1,000', grad: '', black: 5, white: null, other: 'x' },
    { name: 'anger management', bf: 1 },
    { name: '', bf: 1 },
  ].concat(Array.from({ length: 20 }, (_, i) => ({ name: 'P' + i }))) });
  assert.equal(rep.programs.length, R.SLOTS.men);
  const p = rep.programs[0];
  assert.deepEqual([p.name, p.bf, p.enr, p.tdisc, p.toth, p.grad, p.black, p.white, p.other], ['Anger Management', 12, null, null, 1000, null, 5, null, null]);
});

test('roster input: AIS numbers and the dates people paste', () => {
  assert.equal(R.cleanAis(' 000-123 456 '), '000-123456');
  assert.equal(R.cleanAis('d77'), 'D77');
  assert.equal(R.parseDate('10/4/26'), '2026-10-04');
  assert.equal(R.parseDate('10-14-2026'), '2026-10-14');
  assert.equal(R.parseDate('2026-10-14'), '2026-10-14');
  assert.equal(R.parseDate('2/30/2026'), '');
  assert.equal(R.parseDate('soon'), '');
  assert.equal(R.guessPopulation('Julia Tutwiler Prison for Women'), 'women');
  assert.equal(R.guessPopulation('Kilby Correctional Facility'), 'men');
});
