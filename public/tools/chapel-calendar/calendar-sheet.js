'use strict';
// Draws one month of one facility's chapel calendar as a US Letter landscape sheet (1056 x 816 px = 11 x 8.5 in).
// The same drawing is used on screen and for printing, so what you see is what prints.
(function (root) {
  var C = root.CalCore;
  var SHEET_W = 1056, SHEET_H = 816;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function eventEl(e, editable) {
    var d = el('div', 'ev k-' + e.kind);
    if (editable) { d.tabIndex = 0; d.setAttribute('role', 'button'); d.dataset.id = e.id; d.setAttribute('aria-label', 'Edit ' + e.title); }
    if (e.kind === 'closed') {
      d.appendChild(el('div', 'ev-closed', e.title));
      if (e.detail) d.appendChild(el('div', 'ev-sub', e.detail));
      return d;
    }
    var line = el('div', 'ev-line');
    var t = C.fmtRange(e.start, e.end, e.allDay);
    if (t) { line.appendChild(el('span', 'et', t)); line.appendChild(document.createTextNode(' ')); }
    line.appendChild(el('span', 'en', e.title));
    if (e.detail) line.appendChild(el('span', 'ed', ' · ' + e.detail));
    if (e.location) line.appendChild(el('span', 'el', ' · ' + e.location));
    d.appendChild(line);
    return d;
  }

  // data: { facility, month, events[], note, chaplain, warden }
  function render(host, data, opts) {
    opts = opts || {};
    var editable = !!opts.editable, showHolidays = opts.holidays !== false;
    host.textContent = '';
    var sheet = el('div', 'sheet');
    sheet.setAttribute('aria-label', data.facility + ' chapel calendar, ' + C.monthLabel(data.month));

    // header: facility on the left, month and year on the right
    var head = el('div', 'sh-head');
    var left = el('div', 'sh-left');
    if (root.Portal && root.Portal.logo) left.appendChild(root.Portal.logo('sh-logo'));
    var eb = el('div', 'sh-eyebrow', 'Chapel Calendar');
    left.appendChild(eb);
    left.appendChild(el('h2', 'sh-facility', data.facility));
    var mon = el('div', 'sh-month');
    mon.appendChild(el('span', 'm', C.MONTHS[+data.month.slice(5, 7) - 1]));
    mon.appendChild(el('span', 'y', data.month.slice(0, 4)));
    head.appendChild(left); head.appendChild(mon);
    sheet.appendChild(head);

    var dow = el('div', 'sh-dow');
    C.DAYS.forEach(function (n) { dow.appendChild(el('span', '', n)); });
    sheet.appendChild(dow);

    // group events by date
    var byDate = {};
    (data.events || []).forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    var hol = showHolidays ? C.holidaysFor(+data.month.slice(0, 4)) : {};
    var today = opts.today ? todayISO() : '';

    var grid = el('div', 'sh-grid');
    C.monthWeeks(data.month).forEach(function (wk) {
      var row = el('div', 'sh-week');
      wk.forEach(function (c) {
        var evs = C.sortEvents(byDate[c.date] || []);
        var cell = el('div', 'sh-day' + (c.inMonth ? '' : ' out') + (evs.some(function (x) { return x.kind === 'closed'; }) ? ' has-closed' : '') + (c.date === today ? ' today' : ''));
        cell.dataset.date = c.date;
        if (c.inMonth) {
          var dn = el('div', 'sh-dn');
          dn.appendChild(el('span', 'num', String(+c.date.slice(8))));
          var h = hol[c.date];
          if (h) dn.appendChild(el('span', 'hol' + (h.holiday ? ' h' : ''), h.name));
          cell.appendChild(dn);
          var list = el('div', 'sh-evs');
          evs.forEach(function (e) { list.appendChild(eventEl(e, editable)); });
          cell.appendChild(list);
          if (editable) {
            var add = el('button', 'sh-add plain', '+');
            add.type = 'button'; add.dataset.date = c.date;
            add.setAttribute('aria-label', 'Add an event on ' + C.monthLabel(data.month).split(' ')[0] + ' ' + (+c.date.slice(8)));
            cell.appendChild(add);
          }
        }
        row.appendChild(cell);
      });
      grid.appendChild(row);
    });
    sheet.appendChild(grid);

    // footer: notes and sign-off lines
    var foot = el('div', 'sh-foot');
    var note = el('div', 'sh-note');
    if (data.note) { note.appendChild(el('span', 'lbl', 'Notes')); note.appendChild(document.createTextNode(data.note)); }
    foot.appendChild(note);
    var sign = el('div', 'sh-sign');
    [['Chaplain', data.chaplain], ['Warden', data.warden]].forEach(function (p) {
      var s = el('div', 'sig');
      s.appendChild(el('div', 'line'));
      var w = el('div', 'who');
      w.appendChild(el('span', 'role', p[0]));
      w.appendChild(el('span', 'nm', p[1] || ''));
      s.appendChild(w);
      sign.appendChild(s);
    });
    foot.appendChild(sign);
    sheet.appendChild(foot);

    host.appendChild(sheet);
    return sheet;
  }

  // Make the contents fit the page: shrink the facility name if needed, then find the biggest text size at which
  // every week fits, and give busier weeks more height. Returns { cramped: true } if it cannot fit at a readable size.
  function fit(sheet) {
    var fac = sheet.querySelector('.sh-facility');
    if (fac) {
      // one line at a big size if the name fits, otherwise let it wrap onto two lines and shrink only as much as needed
      fac.style.whiteSpace = 'nowrap'; fac.style.lineHeight = '';
      var size = 54; fac.style.fontSize = size + 'px';
      while (fac.scrollWidth > fac.clientWidth && size > 34) { size -= 1; fac.style.fontSize = size + 'px'; }
      if (fac.scrollWidth > fac.clientWidth) {
        fac.style.whiteSpace = 'normal'; fac.style.lineHeight = '1.02'; size = 46; fac.style.fontSize = size + 'px';
        while ((fac.scrollWidth > fac.clientWidth || fac.offsetHeight > size * 2.1) && size > 22) { size -= 1; fac.style.fontSize = size + 'px'; }
      }
    }
    var grid = sheet.querySelector('.sh-grid');
    if (!grid) return { cramped: false };
    var weeks = [].slice.call(grid.children), avail = grid.clientHeight, MIN_ROW = 64;
    sheet.classList.add('measuring');
    var fs = 13.5, ok = false, hs = [], sum = 0;
    while (fs >= 6.9) {
      sheet.style.setProperty('--fs', fs + 'px');
      hs = weeks.map(function (w) { w.style.height = 'auto'; return Math.max(MIN_ROW, w.offsetHeight); });
      sum = hs.reduce(function (a, b) { return a + b; }, 0);
      if (sum <= avail) { ok = true; break; }
      fs -= 0.25;
    }
    sheet.classList.remove('measuring');
    var extra = ok ? avail - sum : 0;
    weeks.forEach(function (w, i) { w.style.height = (hs[i] + (ok ? extra * hs[i] / sum : 0)) + 'px'; });
    return { cramped: !ok, fontSize: fs };
  }

  // On screen the sheet is scaled to the width of its box. (Printing ignores the scale.)
  function scaleTo(box, sheet, minScale) {
    var k = Math.max(minScale || 0, Math.min(1, box.clientWidth / SHEET_W));
    sheet.style.transform = 'scale(' + k + ')';
    box.style.height = Math.round(SHEET_H * k) + 'px';
    return k;
  }

  root.CalSheet = { render: render, fit: fit, scaleTo: scaleTo, SHEET_W: SHEET_W, SHEET_H: SHEET_H, todayISO: todayISO };
})(window);
