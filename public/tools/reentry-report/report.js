'use strict';
// Monthly Statistical and Tracking Report: programs, service documents, graduation roster, review and submit.
// Everything saves as it is typed. A submitted report is locked until it is reopened.
(function () {
  var P = window.Portal, RC = window.ReportCore, el = P.el;
  function $(id) { return document.getElementById(id); }

  var qs = new URLSearchParams(location.search);
  var isSup = false, viewFac = '', month = '', months = [], data = null, tab = 'programs', uid = 0;
  var timer = null, inflight = null, dirty = false;
  var refs = { cards: [], docs: [] };
  var rosterScope = 'all', flash = null;

  /* ---------- small helpers ---------- */
  function fmtDay(iso) { return RC.MONTHS[+iso.slice(5, 7) - 1].slice(0, 3) + ' ' + (+iso.slice(8, 10)) + ', ' + iso.slice(0, 4); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function lastDay(ym) { return ym + '-' + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()).padStart(2, '0'); }
  function locked() { return !data.canEdit || data.status === 'submitted'; }
  function rosterN(name) { return (data.rosterCounts && data.rosterCounts[name]) || 0; }
  function current() { return { population: data.population, programs: data.programs, docs: data.docs }; }
  function issues() { return RC.validate(current(), data.rosterCounts, data.prevTotals); }
  function say(text) { var a = $('alert'); a.textContent = text || ''; a.hidden = !text; }
  function fatal(e) {
    say(e && e.message ? e.message : 'Something went wrong.');
    ['programs', 'docs', 'roster', 'review'].forEach(function (t) { $('pane-' + t).textContent = ''; });
    $('due').hidden = true;
  }
  function qsFor(extra) { return 'month=' + month + (isSup ? '&facility=' + encodeURIComponent(viewFac) : '') + (extra || ''); }

  /* ---------- saving ---------- */
  function setSave(text, bad) { var s = $('saveState'); s.textContent = text || ''; s.className = 'rp-save' + (bad ? ' err' : ''); }
  function touch() {
    if (!data || locked()) return;
    dirty = true; setSave('Saving…');
    clearTimeout(timer); timer = setTimeout(save, 900);
    updateComputed();
  }
  // Resolves true when everything typed so far is stored.
  function save() {
    clearTimeout(timer); timer = null;
    if (inflight) return inflight;
    if (!dirty) return Promise.resolve(true);
    dirty = false; setSave('Saving…');
    inflight = P.api('/api/reentry/report', { method: 'POST', body: { month: month, population: data.population, programs: data.programs, docs: data.docs } }).then(function (r) {
      inflight = null; data.saved = true;
      if (r.reopened) { data.status = 'draft'; renderDue(); }
      renderStatus();
      if (dirty && !timer) timer = setTimeout(save, 300);
      setSave(dirty ? 'Saving…' : 'Saved');
      return true;
    }, function (e) {
      inflight = null; dirty = true;
      setSave('Couldn’t save: ' + e.message + ' Trying again…', true);
      timer = setTimeout(save, 6000);
      return false;
    });
    return inflight;
  }
  function flush() {
    return save().then(function (ok) { return ok ? ((dirty || inflight) ? flush() : true) : false; });
  }

  /* ---------- loading ---------- */
  function load() {
    return P.api('/api/reentry/report?' + qsFor()).then(function (d) {
      data = d; say('');
      try { history.replaceState(null, '', '?' + qsFor()); } catch (e) { /* ignore */ }
      render();
    }).catch(fatal);
  }
  function changeMonth(m) {
    if (!m || m === month) return;
    flush().then(function (ok) {
      if (!ok) { $('monthSel').value = month; say('Your latest changes haven’t saved yet. Wait a moment, then try again.'); return; }
      month = m; $('monthSel').value = m; setSave(''); rosterScope = 'all'; flash = null;
      load();
    });
  }
  function fillMonths(top) {
    months = [];
    for (var i = 0; i < 24; i++) months.push(RC.addMonths(top, -i));
    if (months.indexOf(month) < 0) { months.push(month); months.sort().reverse(); }
    var sel = $('monthSel'); sel.textContent = '';
    months.forEach(function (m) { sel.appendChild(el('option', { value: m, text: RC.monthLabel(m) })); });
    sel.value = month;
  }

  /* ---------- header ---------- */
  function renderStatus() {
    var b = $('status'); b.hidden = false;
    if (data.status === 'submitted') { b.className = 'badge b-new'; b.textContent = 'Submitted'; }
    else if (data.saved) { b.className = 'badge b-wait'; b.textContent = 'Draft'; }
    else { b.className = 'badge b-declined'; b.textContent = 'Not started'; }
    $('viewonly').hidden = data.canEdit;
  }
  function renderDue() {
    var box = $('due'); box.textContent = ''; box.hidden = false; box.className = 'rp-due';
    if (data.status === 'submitted') {
      box.classList.add('done');
      box.appendChild(el('b', { text: 'Submitted' }));
      box.appendChild(el('span', { class: 'when', text: (data.submittedBy ? 'by ' + data.submittedBy + ' · ' : '') + P.fmtDate(data.submittedAt) }));
      box.appendChild(el('span', { class: 'rest', text: 'Your Regional Reentry Coordinator can open it here and download the Excel file.' }));
      if (data.canEdit) box.appendChild(el('button', { type: 'button', class: 'secondary small', text: 'Reopen to edit', onclick: doReopen }));
      return;
    }
    var diff = RC.dayDiff(data.today, data.due);
    box.appendChild(el('b', { text: 'Due ' + fmtDay(data.due) }));
    if (diff < 0) { box.classList.add('late'); box.appendChild(el('span', { class: 'when', text: 'Overdue by ' + plural(-diff, 'day') })); }
    else box.appendChild(el('span', { class: 'when', text: diff === 0 ? 'Due today' : 'Due in ' + plural(diff, 'day') }));
    box.appendChild(el('span', { class: 'rest', text: data.canEdit ? 'Submit it from the Review tab when every section is done.' : 'Not submitted yet.' }));
  }
  function setBadge(name, n, mode) {
    var b = document.querySelector('#tab-' + name + ' .n');
    if (n) { b.hidden = false; b.className = 'n' + (mode === 'info' ? ' info' : ''); b.textContent = String(n); }
    else if (mode === 'ok') { b.hidden = false; b.className = 'n ok'; b.textContent = '✓'; }
    else b.hidden = true;
  }
  function renderBadges() {
    var errs = issues().filter(function (i) { return i.level === 'error'; });
    function count(t) { return errs.filter(function (i) { return i.tab === t; }).length; }
    setBadge('programs', count('programs'), 'ok');
    setBadge('docs', count('docs'), 'ok');
    setBadge('roster', data.roster.length, 'info');
    setBadge('review', data.status === 'submitted' ? 0 : errs.length, data.status === 'submitted' || !errs.length ? 'ok' : '');
  }

  function render() {
    $('facName').textContent = data.facility;
    $('heroLead').textContent = data.canEdit
      ? 'Statistical and Tracking Report for ' + data.label + '. Everything saves as you type.'
      : 'A read-only look at ' + data.facility + '’s report for ' + data.label + '.';
    var back = $('backLink');
    if (isSup) { back.href = '/tools/reentry-report/all.html?month=' + month; back.textContent = '← All facilities'; }
    var i = months.indexOf(month);
    $('prev').disabled = i < 0 || i >= months.length - 1; $('next').disabled = i <= 0;
    $('monthSel').value = month;
    renderStatus(); renderDue(); renderPane();
    if (!dirty) setSave(data.saved && data.updatedAt ? 'Last saved ' + P.fmtDate(data.updatedAt) : '');
  }

  function renderPane() {
    ['programs', 'docs', 'roster', 'review'].forEach(function (t) {
      var on = t === tab, pane = $('pane-' + t);
      pane.hidden = !on;
      $('tab-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      pane.classList.toggle('locked', locked());
    });
    var pane = $('pane-' + tab);
    pane.textContent = '';
    refs = { cards: [], docs: [] };
    if (tab === 'programs') buildPrograms(pane);
    else if (tab === 'docs') buildDocs(pane);
    else if (tab === 'roster') buildRoster(pane);
    else buildReview(pane);
    renderBadges();
  }

  /* ---------- number fields ---------- */
  // obj[key] holds the number (or null while blank). Typing keeps only digits and saves as you go.
  function numRow(obj, key, label, o) {
    o = o || {};
    var id = 'f' + (++uid);
    var input = el('input', { id: id, class: 'num', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '5' });
    input.value = obj[key] === null || obj[key] === undefined ? '' : String(obj[key]);
    if (o.ph !== undefined && o.ph !== null) input.placeholder = String(o.ph);
    if (locked()) input.disabled = true;
    input.addEventListener('input', function () {
      var v = input.value.replace(/\D/g, '').slice(0, 5);
      if (v !== input.value) input.value = v;
      obj[key] = v === '' ? null : parseInt(v, 10);
      touch();
    });
    input.addEventListener('focus', function () { input.select(); });
    var lab = el('label', { for: id }, label);
    var tag = null;
    if (o.tag) { tag = el('span', { class: 'tag', text: o.tag }); lab.appendChild(tag); }
    if (o.sub) lab.appendChild(el('small', { text: o.sub }));
    return { row: el('div', { class: 'fr' }, lab, input), input: input, obj: obj, key: key, tag: tag };
  }
  function fillZeros(list) {
    list.forEach(function (f) { if (f.obj[f.key] === null || f.obj[f.key] === undefined) { f.obj[f.key] = 0; f.input.value = '0'; } });
    touch();
  }
  // Enter moves to the next box, like tabbing through a form.
  function enterMoves(pane) {
    pane.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || !ev.target.classList || !ev.target.classList.contains('num')) return;
      ev.preventDefault();
      var all = [].slice.call(pane.querySelectorAll('input.num:not([disabled])')), at = all.indexOf(ev.target);
      if (at >= 0 && all[at + 1]) all[at + 1].focus(); else ev.target.blur();
    });
  }

  /* ---------- programs ---------- */
  var REQ = ['bf', 'enr', 'tdisc', 'toth', 'black', 'white', 'other'];
  function programCard(p, i) {
    var r = { p: p, inputs: [] };
    var fields = {};
    var tag = el('span', { class: 'tag' });
    var totalNum = el('b', { text: '0' });
    r.total = totalNum; r.totalBox = el('div', { class: 'ptotal' }, el('small', { text: 'Total participating' }), totalNum);
    r.tag = tag;
    var acts = el('div', { class: 'acts' }, r.totalBox);
    if (!locked()) {
      acts.appendChild(el('button', { type: 'button', class: 'plain rm', text: 'Remove', onclick: function () {
        var n = rosterN(p.name);
        if (!window.confirm('Remove ' + p.name + ' from the ' + data.label + ' report?' + (n ? ' Its ' + plural(n, 'graduate') + ' on the roster will stay on the roster.' : ''))) return;
        data.programs.splice(i, 1); touch(); renderPane();
      } }));
    }
    var head = el('div', { class: 'ph' }, el('div', { class: 'ttl' }, el('h3', { text: p.name }), tag), acts);

    var left = el('div', { class: 'pcol' }, el('h4', { text: 'Participants' }));
    RC.PROGRAM_FIELDS.forEach(function (f) {
      var o = {};
      if (f.key === 'grad') { o.ph = rosterN(p.name); o.sub = 'Leave blank to use the Graduation Roster (' + rosterN(p.name) + ' this month)'; }
      var row = numRow(p, f.key, f.label, o);
      if (f.key === 'bf') {
        row.tag = el('span', { class: 'tag', text: 'From last month' });
        row.row.querySelector('label').appendChild(row.tag);
        r.auto = row.tag;
      }
      fields[f.key] = row; r.inputs.push(row); left.appendChild(row.row);
    });
    r.sumRowTotal = el('div', { class: 'fr sum' }, el('label', { text: 'Total participating, end of month' }), r.sumTotal = el('span', { class: 'v', text: '0' }));
    left.appendChild(r.sumRowTotal);

    var right = el('div', { class: 'pcol' }, el('h4', { text: 'Race of participants' }));
    RC.RACE_FIELDS.forEach(function (f) {
      var row = numRow(p, f.key, f.label.replace('Offender race: ', ''));
      fields[f.key] = row; r.inputs.push(row); right.appendChild(row.row);
    });
    r.sumRowRace = el('div', { class: 'fr sum' }, el('label', { text: 'Race total (must equal the total)' }), r.sumRace = el('span', { class: 'v', text: '0' }));
    right.appendChild(r.sumRowRace);
    r.fields = fields;

    r.note = el('p', { class: 'pnote' });
    var card = el('div', { class: 'pcard' }, head, el('div', { class: 'pgrid' }, left, right), r.note);
    if (!locked()) {
      card.appendChild(r.foot = el('div', { class: 'pfoot' }, el('button', { type: 'button', class: 'secondary small', text: 'Fill blanks with 0', onclick: function () {
        fillZeros(r.inputs.filter(function (f) { return f.key !== 'grad'; }));
      } })));
    }
    refs.cards[i] = r;
    return card;
  }

  function addProgramBox() {
    var box = el('div', { class: 'addprog' });
    if (data.programs.length >= data.slots) {
      box.appendChild(el('p', { class: 'hint', text: 'The ' + (data.population === 'women' ? 'Women’s' : 'Men’s') + ' workbook has room for ' + data.slots + ' programs, and all of them are in use.' }));
      return box;
    }
    var used = data.programs.map(function (p) { return p.name.toLowerCase(); });
    var avail = RC.PROGRAM_SETS[data.population].filter(function (n) { return used.indexOf(n.toLowerCase()) < 0; });
    var sel = el('select', { 'aria-label': 'Program to add' });
    avail.forEach(function (n) { sel.appendChild(el('option', { value: n, text: n })); });
    sel.appendChild(el('option', { value: '__other', text: 'Another program…' }));
    var other = el('input', { type: 'text', maxlength: '60', placeholder: 'Program name', 'aria-label': 'Name of the program' });
    other.hidden = sel.value !== '__other';
    sel.addEventListener('change', function () { other.hidden = sel.value !== '__other'; if (!other.hidden) other.focus(); });
    var msg = el('p', { class: 'hint', text: '' });
    var add = el('button', { type: 'button', class: 'secondary', text: 'Add program', onclick: function () {
      var name = (sel.value === '__other' ? other.value : sel.value).replace(/\s+/g, ' ').trim();
      if (!name) { msg.textContent = 'Type the name of the program.'; other.focus(); return; }
      if (used.indexOf(name.toLowerCase()) >= 0) { msg.textContent = name + ' is already on this report.'; return; }
      var np = RC.emptyProgram(name);
      if (data.prevTotals && data.prevTotals[name] !== undefined && data.prevTotals[name] >= 0) { np.bf = data.prevTotals[name]; data.auto = data.auto || {}; data.auto[name] = true; }
      data.programs.push(np); touch(); renderPane();
    } });
    box.appendChild(sel); box.appendChild(other); box.appendChild(add); box.appendChild(msg);
    return box;
  }

  function buildPrograms(pane) {
    var intro = locked() && data.canEdit
      ? 'This report has been submitted. Reopen it to make changes.'
      : data.canEdit
        ? 'Enter this month’s numbers for each program. Brought forward starts at last month’s ending total, and the totals work themselves out as you type. Press Enter to move to the next box.'
        : 'These are the numbers the facility entered for ' + data.label + '.';
    pane.appendChild(el('p', { class: 'rp-intro', text: intro }));
    data.programs.forEach(function (p, i) { pane.appendChild(programCard(p, i)); });
    if (!data.programs.length) pane.appendChild(el('div', { class: 'empty', text: 'No programs on this report yet.' }));
    if (!locked()) pane.appendChild(addProgramBox());
    if (!pane._enter) { pane._enter = true; enterMoves(pane); }
    updateComputed();
  }

  /* ---------- service documents ---------- */
  function docCard(def) {
    var doc = data.docs[def.id], hint = data.hints && data.hints[def.id];
    var r = { id: def.id, inputs: [], tag: el('span', { class: 'tag' }) };
    var body = el('div', { class: 'body' });
    def.rows.forEach(function (label, k) {
      var h = hint && hint.v ? hint.v[k] : null;
      var f = numRow(doc.v, k, label, { ph: h === null || h === undefined ? '' : h });
      r.inputs.push(f); body.appendChild(f.row);
    });
    var hT = hint ? hint.total : null;
    var tot = numRow(doc, 'total', def.total, { ph: hT === null || hT === undefined ? '' : hT });
    tot.row.classList.add('total'); r.inputs.push(tot); body.appendChild(tot.row);
    var card = el('div', { class: 'dcard' }, el('div', { class: 'ph' }, el('div', { class: 'ttl' }, el('h3', { text: def.name }), r.tag)), body);
    if (!locked()) card.appendChild(el('div', { class: 'pfoot' }, el('button', { type: 'button', class: 'secondary small', text: 'Nothing this month: fill blanks with 0', onclick: function () { fillZeros(r.inputs); } })));
    refs.docs.push(r);
    return card;
  }
  function buildDocs(pane) {
    var hasHints = !!data.hints;
    pane.appendChild(el('p', { class: 'rp-intro', text: locked() && data.canEdit ? 'This report has been submitted. Reopen it to make changes.'
      : data.canEdit ? 'Each block matches a block on the Service Docs tab of your workbook.' + (hasHints ? ' The gray numbers are last month’s, for reference.' : '') + ' Enter the end-of-month total as you work it out on the workbook.'
        : 'Service document numbers for ' + data.label + '.' }));
    var grid = el('div', { class: 'dgrid' });
    RC.DOCS.forEach(function (d) { grid.appendChild(docCard(d)); });
    pane.appendChild(grid);
    if (!pane._enter) { pane._enter = true; enterMoves(pane); }
    updateComputed();
  }

  /* ---------- graduation roster ---------- */
  function parseLines(text) {
    return text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var t = l.split(/[\s,;]+/).filter(Boolean);
      return { ais: t[0] || '', date: t[1] || '' };
    });
  }
  function rosterForm() {
    var panel = el('div', { class: 'panel' }, el('h2', { text: 'Add graduates' }));
    if (!data.programs.length) { panel.appendChild(el('p', { class: 'hint', text: 'Add a program on the Programs tab first, then come back to list its graduates.' })); return panel; }
    var sel = el('select', { id: 'rProg' }); data.programs.forEach(function (p) { sel.appendChild(el('option', { value: p.name, text: p.name })); });
    var date = el('input', { id: 'rDate', type: 'date', value: lastDay(month), min: month + '-01', max: lastDay(month) });
    var ta = el('textarea', { id: 'rAis', class: 'ais', placeholder: '0001234\n0005678\n0009012 10/14/2026', spellcheck: 'false', autocomplete: 'off' });
    var msg = el('div', { class: 'msg' + (flash ? ' ' + flash.kind : ''), role: 'status', text: flash ? flash.text : '' });
    var btn = el('button', { type: 'button', text: 'Add to roster' });
    btn.addEventListener('click', function () {
      var rows = parseLines(ta.value);
      if (!rows.length) { P.say(msg, 'Type or paste at least one AIS number.', 'err'); ta.focus(); return; }
      btn.disabled = true; P.say(msg, 'Adding…', '');
      flush().then(function (ok) {
        if (!ok) throw new Error('Your latest changes haven’t saved yet. Try again in a moment.');
        return P.api('/api/reentry/roster', { method: 'POST', body: { program: sel.value, defaultDate: date.value, rows: rows } });
      }).then(function (r) {
        var parts = ['Added ' + plural(r.added, 'graduate') + ' to ' + sel.value + '.'];
        if (r.duplicates) parts.push(plural(r.duplicates, 'was', 'were') + ' already on the roster.');
        var other = (r.months || []).filter(function (m) { return m !== month; });
        if (other.length) parts.push('Some had dates in ' + other.map(RC.monthLabel).join(', ') + ' and count there.');
        if (r.invalid && r.invalid.length) parts.push('Could not read: ' + r.invalid.slice(0, 5).join(', ') + (r.invalid.length > 5 ? '…' : '') + '.');
        flash = { text: parts.join(' '), kind: r.invalid && r.invalid.length ? 'err' : 'ok' };
        return load();
      }).catch(function (e) { btn.disabled = false; P.say(msg, e.message, 'err'); });
    });
    panel.appendChild(el('label', { for: 'rProg', text: 'Program' })); panel.appendChild(sel);
    panel.appendChild(el('label', { for: 'rDate', text: 'Graduation date' })); panel.appendChild(date);
    panel.appendChild(el('label', { for: 'rAis', text: 'AIS numbers' })); panel.appendChild(ta);
    panel.appendChild(el('p', { class: 'hint', text: 'One per line, or paste a column from Excel. If someone graduated on a different day, put the date after the number, like 0009012 10/14/2026.' }));
    panel.appendChild(btn); panel.appendChild(msg);
    return panel;
  }
  function buildRoster(pane) {
    pane.appendChild(el('p', { class: 'rp-intro', text: data.canEdit
      ? 'List the AIS number of each offender who graduated, with the program and date. This becomes the Graduation Roster tab of your workbook, and the Graduated number on the Programs tab counts from it unless you type a different number.'
      : 'Graduates listed for ' + data.label + '.' }));
    var grid = el('div', { class: 'rgrid' });
    if (!locked()) grid.appendChild(rosterForm());
    else if (data.canEdit) grid.appendChild(el('div', { class: 'panel' }, el('h2', { text: 'Submitted' }), el('p', { class: 'hint', text: 'Reopen the report to add or remove graduates.' })));

    var panel = el('div', { class: 'panel' }, el('h2', { text: 'Graduates in ' + data.label }));
    var chips = el('div', { class: 'rchips' });
    chips.appendChild(el('span', { class: 'rchip' }, el('b', { text: String(data.roster.length) }), 'total'));
    data.programs.forEach(function (p) { var n = rosterN(p.name); if (n) chips.appendChild(el('span', { class: 'rchip' }, el('b', { text: String(n) }), p.name)); });
    panel.appendChild(chips);
    if (!data.roster.length) panel.appendChild(el('div', { class: 'empty', text: 'No graduates listed for this month yet.' }));
    else {
      var tb = el('tbody');
      data.roster.forEach(function (g) {
        var tr = el('tr', {}, el('td', { class: 'ais', text: g.ais }), el('td', { text: g.program }), el('td', { text: fmtDay(g.date) }));
        var td = el('td', { class: 'num' });
        if (!locked()) td.appendChild(el('button', { type: 'button', class: 'plain del', text: 'Remove', 'aria-label': 'Remove ' + g.ais, onclick: function () {
          flush().then(function () { return P.api('/api/reentry/roster/' + g.id + '/delete', { method: 'POST' }); }).then(function () { flash = null; return load(); }).catch(function (e) { say(e.message); });
        } }));
        tr.appendChild(td); tb.appendChild(tr);
      });
      panel.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'rtable' },
        el('thead', {}, el('tr', {}, el('th', { text: 'AIS number' }), el('th', { text: 'Program' }), el('th', { text: 'Graduated' }), el('th', { class: 'num' }))), tb)));
    }
    panel.appendChild(el('p', { class: 'hint', text: 'The roster holds ' + plural(data.rosterTotal, 'graduate') + ' in all. The Excel file lists everyone through ' + data.label + ' unless you choose only this month on the Review tab.' }));
    grid.appendChild(panel);
    pane.appendChild(grid);
  }

  /* ---------- review and submit ---------- */
  function cell(v) { return v === null || v === undefined ? '—' : String(v); }
  function buildReview(pane) {
    var iss = issues(), errs = iss.filter(function (i) { return i.level === 'error'; }), warns = iss.filter(function (i) { return i.level === 'warn'; });
    var submitted = data.status === 'submitted';
    var big = el('div', { class: 'rv-big' + (submitted ? ' done' : errs.length ? ' bad' : '') });
    if (submitted) { big.appendChild(el('b', { text: 'Submitted' })); big.appendChild(el('span', { text: (data.submittedBy ? 'by ' + data.submittedBy + ' on ' : 'on ') + P.fmtDate(data.submittedAt) })); }
    else if (errs.length) { big.appendChild(el('b', { text: plural(errs.length, 'thing') + ' to fix' })); big.appendChild(el('span', { text: 'before this can be submitted' })); }
    else { big.appendChild(el('b', { text: 'Ready to submit' })); big.appendChild(el('span', { text: warns.length ? plural(warns.length, 'note') + ' to look over first' : 'Everything checks out' })); }
    pane.appendChild(big);

    if (iss.length && !submitted) {
      var ul = el('ul', { class: 'rv-list' });
      iss.forEach(function (i) {
        var li = el('li', {}, el('span', { class: 'lvl ' + i.level, text: i.level === 'error' ? 'Fix' : 'Check' }), el('span', { class: 'where', text: i.where }), el('span', { class: 'msg2', text: i.msg }));
        if (data.canEdit) li.appendChild(el('button', { type: 'button', class: 'secondary small', text: 'Go there', onclick: function () { goTab(i.tab); } }));
        ul.appendChild(li);
      });
      pane.appendChild(el('div', { class: 'panel' }, el('h2', { text: 'To look at' }), ul));
    }

    // summary of the Programs tab
    var sum = { bf: 0, enr: 0, tdisc: 0, toth: 0, grad: 0, total: 0, race: 0 };
    var body = el('tbody');
    data.programs.forEach(function (p) {
      var n = rosterN(p.name), g = RC.effGrad(p, n), t = RC.programTotal(p, n), rt = RC.raceTotal(p);
      var done = REQ.every(function (k) { return p[k] !== null; });
      sum.bf += p.bf || 0; sum.enr += p.enr || 0; sum.tdisc += p.tdisc || 0; sum.toth += p.toth || 0; sum.grad += g; sum.total += t; sum.race += rt;
      body.appendChild(el('tr', {}, el('td', { text: p.name }), el('td', { class: 'num', text: cell(p.bf) }), el('td', { class: 'num', text: cell(p.enr) }),
        el('td', { class: 'num', text: cell(p.tdisc) }), el('td', { class: 'num', text: cell(p.toth) }), el('td', { class: 'num', text: String(g) }),
        el('td', { class: 'num', text: String(t) }),
        el('td', { class: 'num ' + (done && rt === t ? 'ok-mark' : 'bad-mark'), text: rt + (done && rt === t ? ' ✓' : '') })));
    });
    if (data.programs.length > 1) body.appendChild(el('tr', { class: 'sumrow' }, el('td', { text: 'All programs' }), el('td', { class: 'num', text: String(sum.bf) }), el('td', { class: 'num', text: String(sum.enr) }),
      el('td', { class: 'num', text: String(sum.tdisc) }), el('td', { class: 'num', text: String(sum.toth) }), el('td', { class: 'num', text: String(sum.grad) }), el('td', { class: 'num', text: String(sum.total) }), el('td', { class: 'num', text: String(sum.race) })));
    var table = el('table', { class: 'rv-sum sumtbl' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Program' }), el('th', { class: 'num', text: 'Brought fwd' }), el('th', { class: 'num', text: 'Enrolled' }), el('th', { class: 'num', text: 'Term. disc.' }),
        el('th', { class: 'num', text: 'Term. other' }), el('th', { class: 'num', text: 'Graduated' }), el('th', { class: 'num', text: 'Total' }), el('th', { class: 'num', text: 'Race total' }))), body);
    pane.appendChild(el('div', { class: 'panel' }, el('h2', { text: data.label + ' at a glance' }), el('div', { class: 'tablewrap' }, table)));

    // download and submit
    var acts = el('div', { class: 'rv-acts' });
    var scope = el('select', { id: 'scope', 'aria-label': 'Which graduates to include in the Excel file' },
      el('option', { value: 'all', text: 'Roster: everyone through ' + data.label }), el('option', { value: 'month', text: 'Roster: only ' + data.label }));
    scope.value = rosterScope;
    scope.addEventListener('change', function () { rosterScope = scope.value; });
    var dl = el('button', { type: 'button', class: 'secondary', text: 'Download Excel' });
    var msg = el('div', { class: 'msg', role: 'status' });
    dl.addEventListener('click', function () {
      dl.disabled = true;
      flush().then(function (ok) {
        dl.disabled = false;
        if (!ok) { P.say(msg, 'Your latest changes haven’t saved yet. Try again in a moment.', 'err'); return; }
        P.say(msg, 'Your download is starting.', 'ok');
        location.href = '/api/reentry/export?' + qsFor('&roster=' + rosterScope);
      });
    });
    acts.appendChild(scope); acts.appendChild(dl);
    if (data.canEdit && !submitted) {
      var sub = el('button', { type: 'button', text: 'Submit report' });
      sub.disabled = errs.length > 0;
      sub.addEventListener('click', function () {
        if (!window.confirm('Submit the ' + data.label + ' report for ' + data.facility + '? You can reopen it afterward if something needs to change.')) return;
        sub.disabled = true; P.say(msg, 'Submitting…', '');
        flush().then(function (ok) {
          if (!ok) throw new Error('Your latest changes haven’t saved yet. Try again in a moment.');
          return P.api('/api/reentry/submit', { method: 'POST', body: { month: month } });
        }).then(function () { flash = null; return load(); }).catch(function (e) {
          sub.disabled = false; P.say(msg, e.message, 'err');
        });
      });
      acts.appendChild(sub);
    }
    if (data.canEdit && submitted) acts.appendChild(el('button', { type: 'button', class: 'secondary', text: 'Reopen to edit', onclick: doReopen }));
    var panel = el('div', { class: 'panel' }, el('h2', { text: submitted ? 'Download' : 'Download and submit' }), acts, msg,
      el('p', { class: 'hint', text: 'The Excel file is your department workbook, filled in: the month’s Programs tab, the Graduation Roster and the Service Docs tab.' + (data.canEdit && !submitted ? ' Submitting lets your Regional Reentry Coordinator see this report and download the same file; you don’t need to email it.' : '') }));
    pane.appendChild(panel);
  }

  function doReopen() {
    flush().then(function () { return P.api('/api/reentry/reopen', { method: 'POST', body: { month: month } }); }).then(function () { flash = null; return load(); }).catch(function (e) { say(e.message); });
  }

  /* ---------- live totals, notes and badges (no re-render, so typing is never interrupted) ---------- */
  function updateComputed() {
    if (!data) return;
    var iss = issues();
    refs.cards.forEach(function (r, i) {
      var p = data.programs[i]; if (!r || !p) return;
      var n = rosterN(p.name), total = RC.programTotal(p, n), race = RC.raceTotal(p);
      var blank = REQ.filter(function (k) { return p[k] === null; }).length;
      r.total.textContent = String(total); r.sumTotal.textContent = String(total);
      r.totalBox.classList.toggle('neg', total < 0); r.sumRowTotal.classList.toggle('neg', total < 0);
      r.sumRace.textContent = String(race);
      var mismatch = blank === 0 && total >= 0 && race !== total;
      r.sumRowRace.classList.toggle('mismatch', mismatch);
      ['black', 'white', 'other'].forEach(function (k) { r.fields[k].input.classList.toggle('bad', mismatch); });
      r.tag.textContent = blank ? plural(blank, 'blank') : 'Complete';
      r.tag.className = 'tag' + (blank ? '' : ' done');
      if (r.foot) r.foot.hidden = blank === 0;
      if (r.auto) r.auto.hidden = !(data.auto && data.auto[p.name] && data.prevTotals && p.bf === data.prevTotals[p.name]);
      r.note.textContent = '';
      iss.filter(function (x) { return x.tab === 'programs' && x.where === p.name && x.msg.indexOf('Enter a number') !== 0; }).forEach(function (x) {
        r.note.appendChild(el('span', { class: x.level === 'error' ? 'e' : 'w', text: x.msg }));
      });
    });
    refs.docs.forEach(function (r) {
      var doc = data.docs[r.id];
      var blank = doc.v.filter(function (v) { return v === null; }).length + (doc.total === null ? 1 : 0);
      r.tag.textContent = blank ? plural(blank, 'blank') : 'Complete';
      r.tag.className = 'tag' + (blank ? '' : ' done');
    });
    renderBadges();
  }

  function goTab(t) {
    if (t !== 'roster') flash = null;
    tab = t; renderPane();
    var tabEl = $('tab-' + t); if (tabEl) tabEl.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- start ---------- */
  function wire() {
    $('prev').addEventListener('click', function () { var i = months.indexOf(month); if (i < months.length - 1) changeMonth(months[i + 1]); });
    $('next').addEventListener('click', function () { var i = months.indexOf(month); if (i > 0) changeMonth(months[i - 1]); });
    $('monthSel').addEventListener('change', function () { changeMonth($('monthSel').value); });
    [].forEach.call(document.querySelectorAll('.rp-tabs button'), function (b) {
      b.addEventListener('click', function () { flush().then(function () { goTab(b.getAttribute('data-tab')); }); });
    });
    window.addEventListener('beforeunload', function (ev) { if (dirty || inflight) { ev.preventDefault(); ev.returnValue = ''; } });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && dirty) save(); });
  }

  P.start({ roles: ['caseworker', 'supervisor'] }).then(function (me) {
    isSup = me.user.role === 'supervisor'; viewFac = qs.get('facility') || '';
    if (isSup && !viewFac) { location.replace('/tools/reentry-report/all.html'); return null; }
    return P.api('/api/reentry/status').then(function (st) {
      month = RC.validMonth(qs.get('month')) ? qs.get('month') : st.month;
      fillMonths(RC.addMonths(st.month, 1));
      wire();
      return load();
    });
  }).catch(fatal);
})();
