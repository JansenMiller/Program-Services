'use strict';
// Supervisor: every facility's calendar for one month, one sheet per page.
(function () {
  var P = window.Portal, C = window.CalCore, S = window.CalSheet, el = P.el;
  function $(id) { return document.getElementById(id); }
  var overview = null, token = 0;

  function show(msg) { var a = $('alert'); a.textContent = msg || ''; a.hidden = !msg; }
  function minScale() { return window.innerWidth < 700 ? 0.62 : 0; }

  function addSheet(host, d) {
    var box = el('div', { class: 'sheet-box' });
    host.appendChild(box);
    var sheet = S.render(box, d, { editable: false, today: false });
    function refit() { if (box.firstChild === sheet) { S.fit(sheet); S.scaleTo(box, sheet, minScale()); } }
    refit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  }

  function run() {
    var month = $('pMonth').value, status = $('pStatus').value, fac = new URLSearchParams(location.search).get('facility') || '';
    var q = '?month=' + month + '&status=' + status + (fac ? '&facility=' + encodeURIComponent(fac) : '');
    try { history.replaceState(null, '', q); } catch (e) { /* ignore */ }
    var mine = ++token, host = $('sheets');
    host.textContent = ''; show(''); $('printBtn').disabled = true; $('count').textContent = 'Loading…';
    var list = overview.calendars.filter(function (c) {
      return c.month === month && c.events > 0 && (status !== 'final' || c.status === 'final') && (!fac || c.facility === fac);
    }).sort(function (a, b) { return a.facility.localeCompare(b.facility); });
    if (!list.length) {
      $('count').textContent = '';
      show('No ' + (status === 'final' ? 'final ' : '') + 'calendars for ' + C.monthLabel(month) + (fac ? ' at ' + fac : '') + ' yet.');
      return;
    }
    Promise.all(list.map(function (c) {
      return P.api('/api/calendar/month?month=' + month + '&facility=' + encodeURIComponent(c.facility));
    })).then(function (all) {
      if (mine !== token) return;
      all.forEach(function (d) { addSheet(host, d); });
      $('count').textContent = all.length + (all.length === 1 ? ' calendar' : ' calendars');
      $('printBtn').disabled = false;
      document.title = 'Chapel Calendars – ' + C.monthLabel(month);
    }).catch(function (e) { show(e.message); $('count').textContent = ''; });
  }

  P.start({ roles: ['supervisor'] }).then(function () { return P.api('/api/calendar/overview'); }).then(function (ov) {
    overview = ov;
    var params = new URLSearchParams(location.search);
    var months = {};
    ov.calendars.forEach(function (c) { months[c.month] = 1; });
    var now = new Date(), cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    months[cur] = 1;
    var list = Object.keys(months).sort().reverse(), sel = $('pMonth');
    list.forEach(function (m) { sel.appendChild(el('option', { value: m, text: C.monthLabel(m) })); });
    var want = params.get('month');
    sel.value = list.indexOf(want) >= 0 ? want : cur;
    if (params.get('status') === 'final') $('pStatus').value = 'final';
    sel.addEventListener('change', run); $('pStatus').addEventListener('change', run);
    $('printBtn').addEventListener('click', function () { window.print(); });
    run();
  }).catch(function (e) { show(e.message); });
})();
