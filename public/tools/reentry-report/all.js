'use strict';
// Supervisor view of the monthly tracking report: who has submitted, who hasn't, and a way in to every report.
(function () {
  var P = window.Portal, RC = window.ReportCore, el = P.el;
  function $(id) { return document.getElementById(id); }
  var data = null, month = '', sort = { key: 'status', dir: 1 };
  var ORDER = { notstarted: 0, draft: 1, submitted: 2 };
  var TEXT = { notstarted: 'Not started', draft: 'Draft', submitted: 'Submitted' };
  var CLASS = { notstarted: 'b-declined', draft: 'b-wait', submitted: 'b-new' };
  var COLS = [
    { key: 'facility', label: 'Facility', sortable: true },
    { key: 'who', label: 'Social worker', sortable: false },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'submitted', label: 'Submitted', sortable: true },
    { key: 'programs', label: 'Programs', sortable: true, num: true },
    { key: 'graduates', label: 'Graduates', sortable: true, num: true },
    { key: 'acts', label: '', sortable: false },
  ];
  function fmtDay(iso) { return RC.MONTHS[+iso.slice(5, 7) - 1].slice(0, 3) + ' ' + (+iso.slice(8, 10)) + ', ' + iso.slice(0, 4); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function late() { return RC.dayDiff(data.today, data.due) < 0; }
  function viewHref(r) { return '/tools/reentry-report/?facility=' + encodeURIComponent(r.facility) + '&month=' + month; }
  function dlHref(r) { return '/api/reentry/export?facility=' + encodeURIComponent(r.facility) + '&month=' + month; }

  function cmp(a, b) {
    var k = sort.key, r = 0;
    if (k === 'facility') r = a.facility.localeCompare(b.facility);
    else if (k === 'status') r = ORDER[a.status] - ORDER[b.status];
    else if (k === 'submitted') r = (a.submittedAt || 0) - (b.submittedAt || 0);
    else r = (a[k] || 0) - (b[k] || 0);
    return r ? r * sort.dir : a.facility.localeCompare(b.facility);
  }
  function buildHead() {
    var tr = $('head'); tr.textContent = '';
    COLS.forEach(function (c) {
      var th = el('th', { scope: 'col', class: c.num ? 'num' : '' });
      if (c.sortable) {
        var on = sort.key === c.key;
        th.setAttribute('aria-sort', on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
        var b = el('button', { type: 'button', class: 'plain sortbtn' }, c.label + ' ', el('span', { class: 'arr', 'aria-hidden': 'true', text: on ? (sort.dir === 1 ? '▲' : '▼') : '↕' }));
        b.addEventListener('click', function () {
          if (sort.key === c.key) sort.dir = -sort.dir; else { sort.key = c.key; sort.dir = (c.key === 'submitted' || c.key === 'programs' || c.key === 'graduates') ? -1 : 1; }
          draw();
        });
        th.appendChild(b);
      } else th.textContent = c.label;
      tr.appendChild(th);
    });
  }

  function draw() {
    buildHead();
    var s = $('fStatus').value, f = $('fFac').value, isLate = late();
    var rows = data.facilities.filter(function (r) {
      if (f && r.facility !== f) return false;
      if (s === 'overdue') return isLate && r.status !== 'submitted';
      return !s || r.status === s;
    });
    rows.sort(cmp);

    var n = { submitted: 0, draft: 0, notstarted: 0 };
    data.facilities.forEach(function (r) { n[r.status]++; });
    var sum = $('sum'); sum.textContent = '';
    [[data.facilities.length, 'facilities'], [n.submitted, 'submitted'], [n.draft, 'draft'], [n.notstarted, 'not started']].forEach(function (p) {
      sum.appendChild(el('span', { class: 'sumchip' }, el('b', { text: String(p[0]) }), p[1]));
    });

    var due = $('due'); due.textContent = ''; due.className = 'rp-due'; due.hidden = false;
    var diff = RC.dayDiff(data.today, data.due), missing = n.draft + n.notstarted;
    due.appendChild(el('b', { text: RC.monthLabel(month) + ' reports due ' + fmtDay(data.due) }));
    if (!data.facilities.length) { due.hidden = true; }
    else if (!missing) { due.classList.add('done'); due.appendChild(el('span', { class: 'when', text: 'All submitted' })); }
    else {
      if (diff < 0) due.classList.add('late');
      due.appendChild(el('span', { class: 'when', text: (diff < 0 ? 'Overdue by ' + plural(-diff, 'day') : diff === 0 ? 'Due today' : 'Due in ' + plural(diff, 'day')) + ' · ' + missing + ' still out' }));
    }

    var tb = $('rows'); tb.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr', { class: r.status === 'notstarted' ? 'ns' : '' });
      tr.appendChild(el('td', {}, el('a', { class: 'name', href: viewHref(r), text: r.facility })));
      tr.appendChild(el('td', { text: r.caseworkers && r.caseworkers.length ? r.caseworkers.join(', ') : '—' }));
      var badges = el('div', { class: 'badges' }, el('span', { class: 'badge ' + CLASS[r.status], text: TEXT[r.status] }));
      if (isLate && r.status !== 'submitted') badges.appendChild(el('span', { class: 'badge b-late', text: 'Overdue' }));
      tr.appendChild(el('td', {}, badges));
      tr.appendChild(el('td', {}, r.submittedAt ? el('span', {}, P.fmtDate(r.submittedAt), r.submittedBy ? el('span', { class: 'sub', text: 'by ' + r.submittedBy }) : null) : '—'));
      tr.appendChild(el('td', { class: 'num', text: r.programs ? String(r.programs) : '—' }));
      tr.appendChild(el('td', { class: 'num', text: r.graduates ? String(r.graduates) : '—' }));
      var acts = el('div', { class: 'rowlink' }, el('a', { class: 'btn secondary', href: viewHref(r), text: 'View' }));
      if (r.status !== 'notstarted') acts.appendChild(el('a', { class: 'btn secondary', href: dlHref(r), text: 'Excel' }));
      tr.appendChild(el('td', {}, acts));
      tb.appendChild(tr);
    });
    $('empty').hidden = rows.length > 0;
    $('tableTitle').textContent = RC.monthLabel(month);
    try { history.replaceState(null, '', '?month=' + month + (s ? '&status=' + s : '') + (f ? '&facility=' + encodeURIComponent(f) : '')); } catch (e) { /* ignore */ }
  }

  function fillFilters() {
    var fm = $('fMonth'); fm.textContent = '';
    var list = data.months.slice(); if (list.indexOf(month) < 0) list.push(month);
    list.sort().reverse().forEach(function (m) { fm.appendChild(el('option', { value: m, text: RC.monthLabel(m) })); });
    fm.value = month;
    var ff = $('fFac'), keep = ff.value; ff.textContent = '';
    ff.appendChild(el('option', { value: '', text: 'All facilities' }));
    data.facilities.map(function (r) { return r.facility; }).sort().forEach(function (n) { ff.appendChild(el('option', { value: n, text: n })); });
    ff.value = keep;
  }
  function load(m) {
    return P.api('/api/reentry/overview' + (m ? '?month=' + m : '')).then(function (d) {
      data = d; month = d.month; fillFilters(); draw();
    });
  }

  P.start({ roles: ['supervisor'] }).then(function () {
    var q = new URLSearchParams(location.search);
    return load(RC.validMonth(q.get('month')) ? q.get('month') : '').then(function () {
      if (['submitted', 'draft', 'notstarted', 'overdue'].indexOf(q.get('status')) >= 0) $('fStatus').value = q.get('status');
      var fac = q.get('facility'); if (fac && data.facilities.some(function (r) { return r.facility === fac; })) $('fFac').value = fac;
      draw();
      $('fMonth').addEventListener('change', function () { load($('fMonth').value).catch(fail); });
      $('fStatus').addEventListener('change', draw);
      $('fFac').addEventListener('change', draw);
    });
  }).catch(fail);

  function fail(e) {
    $('rows').textContent = ''; $('empty').hidden = false; $('empty').textContent = e && e.message ? e.message : 'Something went wrong.';
  }
})();
