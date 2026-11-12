'use strict';
// Supervisor overview: every facility's calendar, filterable and sortable.
(function () {
  var P = window.Portal, C = window.CalCore, el = P.el;
  function $(id) { return document.getElementById(id); }
  var data = null;
  var sort = { key: 'month', dir: -1 };
  var STATUS_ORDER = { notstarted: 0, draft: 1, final: 2 };
  var STATUS_TEXT = { notstarted: 'Not started', draft: 'Draft', final: 'Final' };
  var STATUS_CLASS = { notstarted: 'b-declined', draft: 'b-wait', final: 'b-new' };
  var COLS = [
    { key: 'facility', label: 'Facility', sortable: true },
    { key: 'month', label: 'Month', sortable: true },
    { key: 'events', label: 'Events', sortable: true, num: true },
    { key: 'status', label: 'Status', sortable: true },
    { key: 'chaplain', label: 'Chaplain', sortable: false },
    { key: 'updated', label: 'Last updated', sortable: true },
    { key: 'acts', label: '', sortable: false },
  ];

  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  function viewHref(r, extra) {
    return '/tools/chapel-calendar/index.html?month=' + r.month + '&facility=' + encodeURIComponent(r.facility) + (extra || '');
  }

  function allRows() {
    var m = $('fMonth').value;
    var out = data.calendars.map(function (c) {
      return { facility: c.facility, month: c.month, events: c.events, status: c.status === 'final' ? 'final' : 'draft', updated: c.updatedAt || 0, chaplain: c.chaplain || '' };
    });
    if (m) {
      var have = {};
      out.forEach(function (r) { if (r.month === m) have[r.facility] = 1; });
      data.chaplains.forEach(function (c) {
        if (have[c.facility]) return;
        have[c.facility] = 1;
        out.push({ facility: c.facility, month: m, events: 0, status: 'notstarted', updated: 0, chaplain: c.name });
      });
    }
    return out;
  }

  function cmp(a, b) {
    var k = sort.key, d = sort.dir, r;
    if (k === 'facility') r = a.facility.localeCompare(b.facility);
    else if (k === 'month') r = a.month < b.month ? -1 : a.month > b.month ? 1 : 0;
    else if (k === 'events') r = a.events - b.events;
    else if (k === 'status') r = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else r = a.updated - b.updated;
    if (r) return r * d;
    // ties: facility A to Z inside a month, newest month first inside a facility
    if (k === 'facility') return a.month < b.month ? 1 : a.month > b.month ? -1 : 0;
    return a.facility.localeCompare(b.facility);
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
          if (sort.key === c.key) sort.dir = -sort.dir;
          else { sort.key = c.key; sort.dir = (c.key === 'month' || c.key === 'updated' || c.key === 'events') ? -1 : 1; }
          syncSortSelect(); draw();
        });
        th.appendChild(b);
      } else th.textContent = c.label;
      tr.appendChild(th);
    });
  }

  function syncSortSelect() {
    var v = sort.key + '-' + (sort.dir === 1 ? 'asc' : 'desc');
    var s = $('fSort');
    s.value = [].some.call(s.options, function (o) { return o.value === v; }) ? v : '';
    if (!s.value) { var o = s.querySelector('option[data-custom]'); if (!o) { o = el('option', { value: '', text: 'Column heading', 'data-custom': '1' }); s.appendChild(o); } s.value = ''; }
  }

  function draw() {
    buildHead();
    var f = $('fFac').value, s = $('fStatus').value, m = $('fMonth').value;
    var rows = allRows().filter(function (r) { return (!m || r.month === m) && (!f || r.facility === f) && (!s || r.status === s); });
    rows.sort(cmp);

    var counts = { all: rows.length, final: 0, draft: 0, notstarted: 0 };
    rows.forEach(function (r) { counts[r.status]++; });
    var sum = $('sum'); sum.textContent = '';
    [['all', 'calendars'], ['final', 'final'], ['draft', 'draft'], ['notstarted', 'not started']].forEach(function (p) {
      sum.appendChild(el('span', { class: 'sumchip' }, el('b', { text: String(counts[p[0]]) }), p[1]));
    });

    var tb = $('rows'); tb.textContent = '';
    rows.forEach(function (r) {
      var tr = el('tr', { class: r.status === 'notstarted' ? 'ns' : '' });
      tr.appendChild(el('td', {}, el('a', { class: 'name', href: viewHref(r), text: r.facility })));
      tr.appendChild(el('td', { text: C.monthLabel(r.month) }));
      tr.appendChild(el('td', { class: 'num', text: r.events ? String(r.events) : '—' }));
      tr.appendChild(el('td', {}, el('span', { class: 'badge ' + STATUS_CLASS[r.status], text: STATUS_TEXT[r.status] })));
      tr.appendChild(el('td', { text: r.chaplain || '—' }));
      tr.appendChild(el('td', { text: r.updated ? P.fmtDate(r.updated) : '—' }));
      var acts = el('div', { class: 'rowlink' },
        el('a', { class: 'btn secondary', href: viewHref(r), text: 'View' }));
      if (r.events) acts.appendChild(el('a', { class: 'btn secondary', href: viewHref(r, '&print=1'), text: 'Print' }));
      tr.appendChild(el('td', {}, acts));
      tb.appendChild(tr);
    });
    $('empty').hidden = rows.length > 0;

    var pa = $('printAll');
    if (m && counts.final + counts.draft > 0) {
      pa.hidden = false;
      pa.textContent = 'Print all for ' + C.monthLabel(m);
      pa.href = '/tools/chapel-calendar/print.html?month=' + m + '&status=' + (s === 'final' ? 'final' : 'all') + (f ? '&facility=' + encodeURIComponent(f) : '');
    } else pa.hidden = true;
    $('tableTitle').textContent = m ? C.monthLabel(m) : 'All months';

    var q = '?month=' + encodeURIComponent(m) + (f ? '&facility=' + encodeURIComponent(f) : '') + (s ? '&status=' + s : '');
    try { history.replaceState(null, '', q); } catch (e) { /* ignore */ }
  }

  function fillFilters(params) {
    var months = {};
    data.calendars.forEach(function (c) { months[c.month] = 1; });
    months[thisMonth()] = 1; months[C.addMonths(thisMonth(), 1)] = 1;
    var list = Object.keys(months).sort().reverse();
    var fm = $('fMonth');
    fm.appendChild(el('option', { value: '', text: 'All months' }));
    list.forEach(function (m) { fm.appendChild(el('option', { value: m, text: C.monthLabel(m) })); });
    var want = params.has('month') ? params.get('month') : thisMonth();
    fm.value = list.indexOf(want) >= 0 || want === '' ? want : thisMonth();

    var ff = $('fFac');
    ff.appendChild(el('option', { value: '', text: 'All facilities' }));
    data.facilities.forEach(function (f) { ff.appendChild(el('option', { value: f, text: f })); });
    if (params.get('facility') && data.facilities.indexOf(params.get('facility')) >= 0) ff.value = params.get('facility');
    if (['final', 'draft', 'notstarted'].indexOf(params.get('status')) >= 0) $('fStatus').value = params.get('status');
  }

  P.start({ roles: ['supervisor'] }).then(function () {
    return P.api('/api/calendar/overview');
  }).then(function (d) {
    data = d;
    fillFilters(new URLSearchParams(location.search));
    ['fMonth', 'fFac', 'fStatus'].forEach(function (id) { $(id).addEventListener('change', draw); });
    $('fSort').addEventListener('change', function () {
      var v = $('fSort').value.split('-'); if (v.length !== 2) return;
      sort.key = v[0]; sort.dir = v[1] === 'asc' ? 1 : -1; draw();
    });
    syncSortSelect();
    draw();
  }).catch(function (e) {
    $('rows').textContent = '';
    $('empty').hidden = false; $('empty').textContent = e.message;
  });
})();
