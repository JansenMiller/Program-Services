'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/tools/chapel-calendar/calendar-core.js');

test('dates and months', () => {
  assert.equal(C.addDays('2026-06-30', 1), '2026-07-01');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(C.weekday('2026-06-01'), 1); // Monday
  assert.equal(C.parseISO('2026-02-30'), null);
  assert.equal(C.addMonths('2026-11', 2), '2027-01');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.monthLabel('2026-06'), 'June 2026');
  assert.equal(C.lastDayOfMonth('2028-02'), '2028-02-29');
});

test('month grid starts on Sunday and covers the whole month', () => {
  const weeks = C.monthWeeks('2026-06'); // June 1 2026 is a Monday
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].date, '2026-05-31');
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(weeks[0][1].date, '2026-06-01');
  assert.equal(weeks[4][2].date, '2026-06-30');
  assert.equal(C.monthWeeks('2026-02').length, 4); // Feb 2026 fits in 4 weeks
  assert.equal(C.monthWeeks('2026-08').length, 6);
});

test('weekly repeat on chosen days', () => {
  const r = C.expandRule('2026-06-01', { freq: 'weekly', weekdays: [1, 3], until: '2026-06-30' });
  assert.deepEqual(r.dates, ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10', '2026-06-15', '2026-06-17', '2026-06-22', '2026-06-24', '2026-06-29']);
});

test('every other week', () => {
  const r = C.expandRule('2026-06-02', { freq: 'weekly', interval: 2, weekdays: [2], until: '2026-07-14' });
  assert.deepEqual(r.dates, ['2026-06-02', '2026-06-16', '2026-06-30', '2026-07-14']);
});

test('weekly defaults to the weekday of the first date', () => {
  const r = C.expandRule('2026-06-05', { freq: 'weekly', until: '2026-06-26' });
  assert.deepEqual(r.dates, ['2026-06-05', '2026-06-12', '2026-06-19', '2026-06-26']);
});

test('monthly on the nth weekday', () => {
  // 2nd Thursday of June 2026 is the 11th
  const r = C.expandRule('2026-06-11', { freq: 'monthly', until: '2026-09-30' });
  assert.deepEqual(r.dates, ['2026-06-11', '2026-07-09', '2026-08-13', '2026-09-10']);
  assert.equal(C.describeRule('2026-06-11', { freq: 'monthly', until: '2026-09-30' }), 'Monthly on the second Thursday');
  // 5th Monday means "last Monday"
  const l = C.expandRule('2026-06-29', { freq: 'monthly', until: '2026-08-31' });
  assert.deepEqual(l.dates, ['2026-06-29', '2026-07-27', '2026-08-31']);
});

test('daily repeat and one-off', () => {
  assert.equal(C.expandRule('2026-06-18', { freq: 'daily', until: '2026-06-21' }).dates.length, 4);
  assert.deepEqual(C.expandRule('2026-06-18', { freq: 'none' }).dates, ['2026-06-18']);
  assert.deepEqual(C.expandRule('2026-06-18', undefined).dates, ['2026-06-18']);
});

test('bad repeat rules are refused', () => {
  assert.ok(C.expandRule('2026-06-18', { freq: 'weekly' }).error);                                  // no end date
  assert.ok(C.expandRule('2026-06-18', { freq: 'weekly', until: '2026-06-01' }).error);             // ends before start
  assert.ok(C.expandRule('2026-06-18', { freq: 'daily', until: '2028-01-01' }).error);              // too long
  assert.ok(C.expandRule('nope', { freq: 'none' }).error);
  assert.ok(C.expandRule('2026-06-18', { freq: 'weekly', weekdays: [9, -1, 'x'], until: '2026-07-01' }).dates.length > 0); // junk weekdays fall back
});

test('holidays and observances', () => {
  const h26 = C.holidaysFor(2026);
  assert.equal(h26['2026-06-19'].name, 'Juneteenth');
  assert.equal(h26['2026-06-01'].name, 'State Holiday');     // first Monday in June
  assert.equal(h26['2026-06-21'].name, "Father's Day");
  assert.equal(h26['2026-11-26'].name, 'Thanksgiving');
  assert.equal(h26['2026-12-25'].holiday, true);
  assert.equal(C.easter(2026), '2026-04-05');
  assert.equal(C.easter(2027), '2027-03-28');
  assert.equal(h26['2026-04-03'].name, 'Good Friday');
  assert.equal(h26['2026-02-18'].name, 'Ash Wednesday');
  assert.equal(C.nthWeekdayDate(2026, 5, 1, -1), '2026-05-25'); // Memorial Day
});

test('time formatting', () => {
  assert.equal(C.fmtTime('13:30'), '1:30 PM');
  assert.equal(C.fmtTime('00:05'), '12:05 AM');
  assert.equal(C.fmtRange('13:00', '14:00'), '1–2 PM');
  assert.equal(C.fmtRange('11:30', '13:00'), '11:30 AM–1 PM');
  assert.equal(C.fmtRange('08:00', ''), '8 AM');
  assert.equal(C.fmtRange('', '', true), 'All day');
  assert.ok(C.validTime('') && C.validTime('23:59') && !C.validTime('24:00') && !C.validTime('9:00'));
});

test('events sort with closures first, then all-day, then by time', () => {
  const s = C.sortEvents([
    { title: 'B', start: '18:00' }, { title: 'A', start: '08:00' }, { title: 'Retreat', allDay: true },
    { title: 'Closed', kind: 'closed', start: '' },
  ]);
  assert.deepEqual(s.map((e) => e.title), ['Closed', 'Retreat', 'A', 'B']);
});
