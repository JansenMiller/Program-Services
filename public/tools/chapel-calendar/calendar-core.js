'use strict';
// Shared calendar logic: dates, recurrence, holidays and time formatting.
// Used by the browser pages and by the server (so both agree on what a repeat rule means).
// Dates are 'YYYY-MM-DD' strings and times are 'HH:MM' strings. No time zones involved.
(function (root) {
  var MAX_SPAN_DAYS = 400;   // a repeating series may run at most about 13 months
  var MAX_OCCURRENCES = 400;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var KINDS = ['service', 'study', 'special', 'closed'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d };
  }
  function toDate(s) { var p = parseISO(s); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)) : null; }
  function fromDate(dt) { return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(s, n) { var dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return fromDate(dt); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function weekday(s) { return toDate(s).getUTCDay(); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function validMonth(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || '')); }
  function addMonths(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function monthLabel(ym) { return MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  function lastDayOfMonth(ym) { return ym + '-' + pad(daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7))); }

  // The nth (1-4) or last (-1) given weekday of a month, as a date string.
  function nthWeekdayDate(y, m, wd, n) {
    if (n === -1) {
      var last = daysInMonth(y, m);
      var lw = new Date(Date.UTC(y, m - 1, last)).getUTCDay();
      return iso(y, m, last - ((lw - wd + 7) % 7));
    }
    var fw = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    var d = 1 + ((wd - fw + 7) % 7) + (n - 1) * 7;
    return d <= daysInMonth(y, m) ? iso(y, m, d) : null;
  }
  // Which "nth weekday of the month" a date is. The 5th one is treated as "last".
  function nthOfDate(s) {
    var p = parseISO(s), n = Math.floor((p.d - 1) / 7) + 1;
    return n >= 5 ? -1 : n;
  }
  function ordinal(n) { return n === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth'][n]; }

  // ---- repeat rules ----
  // rule: { freq: 'none' | 'daily' | 'weekly' | 'monthly', interval: 1|2, weekdays: [0-6], nth: 1-4|-1, weekday: 0-6, until: 'YYYY-MM-DD' }
  function normalizeRule(startISO, rule) {
    if (!parseISO(startISO)) return { error: 'Pick a valid date.' };
    var r = rule && typeof rule === 'object' ? rule : {};
    var freq = ['daily', 'weekly', 'monthly'].indexOf(r.freq) >= 0 ? r.freq : 'none';
    if (freq === 'none') return { rule: { freq: 'none' } };
    var out = { freq: freq, interval: r.interval === 2 ? 2 : 1 };
    if (!parseISO(r.until)) return { error: 'Choose the date the repeat should end.' };
    if (r.until < startISO) return { error: 'The repeat must end on or after the first date.' };
    if (diffDays(startISO, r.until) > MAX_SPAN_DAYS) return { error: 'A repeat can run for up to 13 months at a time.' };
    out.until = r.until;
    if (freq === 'weekly') {
      var wds = Array.isArray(r.weekdays) ? r.weekdays.filter(function (x) { return Number.isInteger(x) && x >= 0 && x <= 6; }) : [];
      wds = wds.filter(function (x, i) { return wds.indexOf(x) === i; }).sort();
      if (!wds.length) wds = [weekday(startISO)];
      out.weekdays = wds;
    }
    if (freq === 'monthly') {
      out.interval = 1;
      out.weekday = Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 ? r.weekday : weekday(startISO);
      out.nth = [1, 2, 3, 4, -1].indexOf(r.nth) >= 0 ? r.nth : nthOfDate(startISO);
    }
    return { rule: out };
  }

  // All dates a rule produces, from startISO to rule.until. Returns { dates } or { error }.
  function expandRule(startISO, rule) {
    var n = normalizeRule(startISO, rule);
    if (n.error) return n;
    var r = n.rule, dates = [];
    if (r.freq === 'none') return { dates: [startISO], rule: r };
    if (r.freq === 'daily') {
      for (var d = startISO; d <= r.until; d = addDays(d, 1)) dates.push(d);
    } else if (r.freq === 'weekly') {
      var startWeek = addDays(startISO, -weekday(startISO));
      for (var x = startISO; x <= r.until; x = addDays(x, 1)) {
        var weekIdx = Math.floor(diffDays(startWeek, x) / 7);
        if (weekIdx % r.interval === 0 && r.weekdays.indexOf(weekday(x)) >= 0) dates.push(x);
      }
    } else {
      var ym = startISO.slice(0, 7);
      while (ym + '-01' <= r.until) {
        var dt = nthWeekdayDate(+ym.slice(0, 4), +ym.slice(5, 7), r.weekday, r.nth);
        if (dt && dt >= startISO && dt <= r.until) dates.push(dt);
        ym = addMonths(ym, 1);
      }
    }
    if (!dates.length) return { error: 'That repeat does not land on any dates. Check the days and the end date.' };
    if (dates.length > MAX_OCCURRENCES) return { error: 'That repeat creates too many events. Shorten the end date.' };
    return { dates: dates, rule: r };
  }

  function describeRule(startISO, rule) {
    var n = normalizeRule(startISO, rule);
    if (n.error || n.rule.freq === 'none') return 'Does not repeat';
    var r = n.rule;
    if (r.freq === 'daily') return 'Every day';
    if (r.freq === 'weekly') {
      var names = r.weekdays.map(function (w) { return DAYS[w].slice(0, 3); }).join(', ');
      return (r.interval === 2 ? 'Every other week on ' : 'Every week on ') + names;
    }
    return 'Monthly on the ' + ordinal(r.nth) + ' ' + DAYS[r.weekday];
  }

  // ---- holidays and observances for a year: { 'YYYY-MM-DD': { name, holiday } } ----
  function easter(y) { // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(y, mo, da);
  }
  function holidaysFor(y) {
    var out = {};
    function put(date, name, holiday) { if (date) out[date] = { name: name, holiday: !!holiday }; }
    put(iso(y, 1, 1), "New Year's Day", true);
    put(nthWeekdayDate(y, 1, 1, 3), 'MLK Jr. Day', true);
    put(nthWeekdayDate(y, 2, 1, 3), "Presidents' Day", true);
    put(nthWeekdayDate(y, 4, 1, 4), 'State Holiday', true);
    put(nthWeekdayDate(y, 5, 0, 2), "Mother's Day", false);
    put(nthWeekdayDate(y, 5, 1, -1), 'Memorial Day', true);
    put(nthWeekdayDate(y, 6, 1, 1), 'State Holiday', true);
    put(iso(y, 6, 19), 'Juneteenth', true);
    put(nthWeekdayDate(y, 6, 0, 3), "Father's Day", false);
    put(iso(y, 7, 4), 'Independence Day', true);
    put(nthWeekdayDate(y, 9, 1, 1), 'Labor Day', true);
    put(nthWeekdayDate(y, 10, 1, 2), 'Columbus Day', true);
    put(iso(y, 11, 11), 'Veterans Day', true);
    put(nthWeekdayDate(y, 11, 4, 4), 'Thanksgiving', true);
    put(iso(y, 12, 24), 'Christmas Eve', false);
    put(iso(y, 12, 25), 'Christmas Day', true);
    var e = easter(y);
    put(addDays(e, -46), 'Ash Wednesday', false);
    put(addDays(e, -7), 'Palm Sunday', false);
    put(addDays(e, -2), 'Good Friday', false);
    put(e, 'Easter', false);
    put(addDays(e, 49), 'Pentecost', false);
    return out;
  }

  // ---- times ----
  function validTime(s) { return s === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s)); }
  function fmtTime(t, withMeridiem) {
    if (!t) return '';
    var h = +t.slice(0, 2), m = t.slice(3, 5), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + (m === '00' ? '' : ':' + m) + (withMeridiem === false ? '' : ' ' + ap);
  }
  // "1-2 PM", "11:30 AM-1 PM", "8 AM", "All day"
  function fmtRange(start, end, allDay) {
    if (allDay) return 'All day';
    if (!start) return '';
    if (!end) return fmtTime(start);
    var sameHalf = (+start.slice(0, 2) >= 12) === (+end.slice(0, 2) >= 12);
    return fmtTime(start, !sameHalf) + '–' + fmtTime(end);
  }

  // Sunday-first weeks for a month: array of 6 or fewer arrays of 7 { date, inMonth }.
  function monthWeeks(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var first = ym + '-01', weeks = [];
    var cur = addDays(first, -weekday(first));
    var last = lastDayOfMonth(ym);
    while (cur <= last) {
      var wk = [];
      for (var i = 0; i < 7; i++) { wk.push({ date: cur, inMonth: cur.slice(0, 7) === ym }); cur = addDays(cur, 1); }
      weeks.push(wk);
    }
    return weeks;
  }

  // Order events within a day: closures first, then all-day, then by start time, then name.
  function sortEvents(list) {
    return list.slice().sort(function (a, b) {
      var ra = a.kind === 'closed' ? 0 : a.allDay ? 1 : 2, rb = b.kind === 'closed' ? 0 : b.allDay ? 1 : 2;
      if (ra !== rb) return ra - rb;
      var sa = a.start || '99:99', sb = b.start || '99:99';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return String(a.title).localeCompare(String(b.title));
    });
  }

  var api = {
    MAX_SPAN_DAYS: MAX_SPAN_DAYS, MONTHS: MONTHS, DAYS: DAYS, KINDS: KINDS,
    iso: iso, parseISO: parseISO, addDays: addDays, diffDays: diffDays, weekday: weekday, daysInMonth: daysInMonth,
    validMonth: validMonth, addMonths: addMonths, monthLabel: monthLabel, lastDayOfMonth: lastDayOfMonth,
    nthWeekdayDate: nthWeekdayDate, nthOfDate: nthOfDate, ordinal: ordinal,
    normalizeRule: normalizeRule, expandRule: expandRule, describeRule: describeRule,
    holidaysFor: holidaysFor, easter: easter, validTime: validTime, fmtTime: fmtTime, fmtRange: fmtRange,
    monthWeeks: monthWeeks, sortEvents: sortEvents,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
