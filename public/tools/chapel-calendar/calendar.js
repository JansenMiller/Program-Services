'use strict';
// Chapel calendar editor. Chaplains build their own facility's month; supervisors can view and print any facility.
(function () {
  var P = window.Portal, C = window.CalCore, S = window.CalSheet, el = P.el;
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  var KIND_LABEL = { service: 'Service', study: 'Class / study', special: 'Special event', closed: 'Chapel closed' };
  var state = { me: null, facility: '', month: '', data: null, orgs: [], editing: null, wdTouched: false, meta: {}, comboIdx: -1, shown: [] };

  var box = $('box'), dlg = $('dlg'), nameIn = $('name'), list = $('comboList');

  /* ---------- small helpers ---------- */
  function todayISO() { return S.todayISO(); }
  function fmtShort(iso) {
    var p = C.parseISO(iso), thisYear = +todayISO().slice(0, 4);
    return C.MONTHS[p.m - 1].slice(0, 3) + ' ' + p.d + (p.y !== thisYear ? ', ' + p.y : '');
  }
  function fmtLong(iso) { var p = C.parseISO(iso); return C.DAYS[C.weekday(iso)] + ', ' + C.MONTHS[p.m - 1] + ' ' + p.d; }
  function showAlert(msg) { var a = $('alert'); a.textContent = msg || ''; a.hidden = !msg; }
  var toastTimer = null;
  function toast(msg) { var t = $('toast'); t.textContent = msg || ''; clearTimeout(toastTimer); if (msg) toastTimer = setTimeout(function () { t.textContent = ''; }, 7000); }
  function say(msg) { P.say($('dlgMsg'), msg, msg ? 'err' : ''); }
  function isSup() { return state.me && state.me.role === 'supervisor'; }
  function minScale() { return window.innerWidth < 700 ? 0.62 : 0; }

  /* ---------- loading and drawing ---------- */
  function syncUrl() {
    var q = '?month=' + state.month + (isSup() ? '&facility=' + encodeURIComponent(state.facility) : '');
    try { history.replaceState(null, '', q); } catch (e) { /* ignore */ }
  }

  function load() {
    syncUrl();
    $('monthSel').value = String(+state.month.slice(5, 7));
    ensureYear(+state.month.slice(0, 4));
    $('yearSel').value = state.month.slice(0, 4);
    return P.api('/api/calendar/month?month=' + state.month + '&facility=' + encodeURIComponent(state.facility || '')).then(function (d) {
      showAlert('');
      state.data = d; state.orgs = d.orgs.slice(); state.facility = d.facility;
      draw();
    }).catch(function (e) {
      state.data = null; box.textContent = ''; box.style.height = '0';
      showAlert(e.message);
      $('meta').hidden = true; $('addBtn').hidden = true; $('finalBtn').hidden = true; $('status').hidden = true;
    });
  }

  function draw() {
    var d = state.data;
    document.title = d.facility + ' Chapel Calendar – ' + C.monthLabel(d.month);
    var sheet = S.render(box, d, { editable: d.canEdit, today: true });
    sheet.classList.toggle('editable', d.canEdit);
    function refit() {
      if (box.firstChild !== sheet) return;
      var fitted = S.fit(sheet);
      S.scaleTo(box, sheet, minScale());
      var msg = '';
      if (fitted.tall) msg = 'This month has more events than fit on one page, so the printout will run onto a second page. Shorter names, or moving some details into the note, will bring it back to one page.';
      else if (fitted.cramped) msg = 'This month is very full, so the text is printing small' + (fitted.hidLocation ? ' and room names are left off' : '') + '. Shorter names, or moving some details into the note, will make it easier to read.';
      else if (fitted.hidLocation) msg = 'This month is full, so room names are left off the printed calendar to keep the text readable. They are still saved with each event.';
      showAlert(msg);
    }
    refit();
    // measure again once the brand fonts have loaded, since they are wider or narrower than the fallback
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

    var st = $('status');
    st.hidden = false;
    st.textContent = d.status === 'final' ? 'Final' : 'Draft';
    st.className = 'badge ' + (d.status === 'final' ? 'b-new' : 'b-wait');

    $('viewonly').hidden = d.canEdit;
    $('addBtn').hidden = !d.canEdit;
    var fb = $('finalBtn');
    fb.hidden = !d.canEdit;
    fb.textContent = d.status === 'final' ? 'Reopen for editing' : 'Mark as final';

    $('meta').hidden = !d.canEdit;
    state.meta = { note: d.note || '', chaplain: d.chaplain || '', warden: d.warden || '' };
    $('note').value = state.meta.note; $('chaplain').value = state.meta.chaplain; $('warden').value = state.meta.warden;

    var dl = $('locList'); dl.textContent = '';
    var seen = {};
    (d.locations || []).concat(['Chapel', 'Classroom']).forEach(function (l) { if (!seen[l.toLowerCase()]) { seen[l.toLowerCase()] = 1; dl.appendChild(el('option', { value: l })); } });

    $('tip').hidden = !d.canEdit;
    $('heroLead').textContent = d.canEdit
      ? 'Click any day to add a service or class. Click an event to change it. Everything you type is saved as you go.'
      : 'Viewing ' + d.facility + '. Supervisors can look and print; only the facility chaplain can make changes.';
  }

  function ensureYear(y) {
    var sel = $('yearSel');
    for (var i = 0; i < sel.options.length; i++) if (+sel.options[i].value === y) return;
    sel.appendChild(el('option', { value: String(y), text: String(y) }));
  }

  function go(month) { if (!C.validMonth(month)) return; state.month = month; load(); }

  /* ---------- the saved-groups dropdown ---------- */
  function orgSummary(o) { return [KIND_LABEL[o.kind], C.fmtRange(o.start, o.end, o.allDay), o.location].filter(Boolean).join(' · '); }

  function highlight(node, text, q) {
    var i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) { node.appendChild(document.createTextNode(text)); return; }
    node.appendChild(document.createTextNode(text.slice(0, i)));
    node.appendChild(el('mark', { text: text.slice(i, i + q.length) }));
    node.appendChild(document.createTextNode(text.slice(i + q.length)));
  }

  function renderCombo(filter) {
    var q = (filter || '').trim();
    list.textContent = '';
    var shown = state.orgs.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    shown.sort(function (a, b) {
      var as = a.name.toLowerCase().indexOf(q.toLowerCase()) === 0 ? 0 : 1, bs = b.name.toLowerCase().indexOf(q.toLowerCase()) === 0 ? 0 : 1;
      return (q ? as - bs : 0) || a.name.localeCompare(b.name);
    });
    state.shown = shown; state.comboIdx = -1;
    shown.forEach(function (o, i) {
      var pick = el('button', { type: 'button', class: 'plain pick', role: 'option', 'data-i': String(i) });
      var nm = el('span'); highlight(nm, o.name, q); pick.appendChild(nm);
      var sum = orgSummary(o); if (sum) pick.appendChild(el('small', { text: sum }));
      pick.addEventListener('click', function () { pickOrg(o); });
      var rm = el('button', { type: 'button', class: 'plain rm', 'aria-label': 'Remove ' + o.name + ' from my saved list', title: 'Remove from my list', text: '×' });
      rm.addEventListener('click', function () { removeOrg(o); });
      list.appendChild(el('div', { class: 'opt' }, pick, rm));
    });
    var exact = state.orgs.some(function (o) { return o.name.toLowerCase() === q.toLowerCase(); });
    if (!state.orgs.length) list.appendChild(el('div', { class: 'hint-row', text: 'Nothing saved yet. Type a name and it will be saved here when you save the event.' }));
    else if (q && !exact) list.appendChild(el('div', { class: 'hint-row', text: '“' + q + '” is new. It will be added to your list when you save.' }));
    else if (!shown.length) list.appendChild(el('div', { class: 'hint-row', text: 'No saved group matches.' }));
  }
  function openCombo(filter) { renderCombo(filter); list.hidden = false; nameIn.setAttribute('aria-expanded', 'true'); }
  function closeCombo() { list.hidden = true; nameIn.setAttribute('aria-expanded', 'false'); state.comboIdx = -1; }
  function setActive(i) {
    var opts = list.querySelectorAll('.opt');
    state.comboIdx = i;
    [].forEach.call(opts, function (o, j) { o.classList.toggle('on', j === i); });
    if (opts[i]) opts[i].scrollIntoView({ block: 'nearest' });
  }

  function pickOrg(o) {
    nameIn.value = o.name;
    setKind(o.kind);
    $('detail').value = o.detail || '';
    $('allDay').checked = !!o.allDay;
    $('start').value = o.start || ''; $('end').value = o.end || '';
    $('location').value = o.location || '';
    applyAllDay(); applyKind(true);
    closeCombo();
    $('detail').focus();
  }
  function removeOrg(o) {
    if (!confirm('Remove “' + o.name + '” from your saved list? Events already on the calendar stay.')) return;
    P.api('/api/calendar/orgs/' + o.id + '/delete', { method: 'POST' }).then(function () {
      state.orgs = state.orgs.filter(function (x) { return x.id !== o.id; });
      renderCombo(nameIn.value); list.hidden = false;
    }).catch(function (e) { say(e.message); });
  }

  nameIn.addEventListener('input', function () { openCombo(nameIn.value); });
  nameIn.addEventListener('focus', function () { /* open on click or arrow, not on every focus */ });
  nameIn.addEventListener('click', function () { if (list.hidden) openCombo(''); });
  nameIn.addEventListener('change', function () {
    // typing a name you have saved before fills in the rest, but only on a brand-new event
    if (state.editing) return;
    var v = nameIn.value.trim().toLowerCase();
    var o = state.orgs.filter(function (x) { return x.name.toLowerCase() === v; })[0];
    if (o && !formTouched()) { pickOrgQuiet(o); }
  });
  nameIn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) openCombo(nameIn.value); setActive(Math.min(state.shown.length - 1, state.comboIdx + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (!list.hidden) setActive(Math.max(0, state.comboIdx - 1)); }
    else if (e.key === 'Enter' && !list.hidden && state.comboIdx >= 0) { e.preventDefault(); pickOrg(state.shown[state.comboIdx]); }
    else if (e.key === 'Tab') closeCombo();
  });
  list.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus in the name field
  document.addEventListener('mousedown', function (e) { if (!list.hidden && !e.target.closest('.combo')) closeCombo(); });
  $('comboBtn').appendChild(P.icon('chevron'));
  $('comboBtn').addEventListener('mousedown', function (e) { e.preventDefault(); });
  $('comboBtn').addEventListener('click', function () { if (list.hidden) { nameIn.focus(); openCombo(''); } else closeCombo(); });

  // fields beyond the name that the person has already filled in by hand
  function formTouched() { return !!($('detail').value || $('start').value || $('end').value || $('location').value || $('allDay').checked); }
  function pickOrgQuiet(o) {
    setKind(o.kind); $('detail').value = o.detail || ''; $('allDay').checked = !!o.allDay;
    $('start').value = o.start || ''; $('end').value = o.end || ''; $('location').value = o.location || '';
    applyAllDay(); applyKind(true);
  }

  /* ---------- form: kind, times ---------- */
  function getKind() { return document.querySelector('input[name=kind]:checked').value; }
  function setKind(k) { var r = document.querySelector('input[name=kind][value="' + (KIND_LABEL[k] ? k : 'service') + '"]'); r.checked = true; }
  function applyKind(keepName) {
    var k = getKind(), closed = k === 'closed';
    $('timeBox').hidden = closed;
    $('detail').placeholder = closed ? 'Reason (optional), for example: Staff training' : 'Topic, leader, or room';
    if (closed && !keepName && !nameIn.value.trim()) nameIn.value = 'Chapel Closed';
  }
  function applyAllDay() {
    var a = $('allDay').checked;
    $('start').disabled = a; $('end').disabled = a;
    $('timeRow').style.opacity = a ? '.45' : '';
  }
  [].forEach.call(document.querySelectorAll('input[name=kind]'), function (r) { r.addEventListener('change', function () { applyKind(false); }); });
  $('allDay').addEventListener('change', applyAllDay);

  /* ---------- form: repeat ---------- */
  var WD_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  function buildWeekdayChips() {
    var host = $('wds'); host.textContent = '';
    C.DAYS.forEach(function (n, i) {
      var b = el('button', { type: 'button', 'data-d': String(i), 'aria-pressed': 'false', 'aria-label': n, title: n, text: WD_LETTER[i] });
      b.addEventListener('click', function () {
        var on = b.getAttribute('aria-pressed') === 'true';
        if (on && selectedWeekdays().length === 1) return; // always keep at least one day
        b.setAttribute('aria-pressed', on ? 'false' : 'true');
        state.wdTouched = true; updatePreview();
      });
      host.appendChild(b);
    });
  }
  function selectedWeekdays() {
    return [].filter.call($('wds').children, function (b) { return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return +b.dataset.d; });
  }
  function setWeekdays(arr) { [].forEach.call($('wds').children, function (b) { b.setAttribute('aria-pressed', arr.indexOf(+b.dataset.d) >= 0 ? 'true' : 'false'); }); }

  function buildNth(date, keep) {
    var sel = $('repNth'); sel.textContent = '';
    if (!C.parseISO(date)) return;
    var wd = C.DAYS[C.weekday(date)], n = C.nthOfDate(date);
    sel.appendChild(el('option', { value: String(n), text: 'the ' + C.ordinal(n) + ' ' + wd + ' of each month' }));
    if (n !== -1 && C.addDays(date, 7).slice(0, 7) !== date.slice(0, 7)) sel.appendChild(el('option', { value: '-1', text: 'the last ' + wd + ' of each month' }));
    if (keep != null && [].some.call(sel.options, function (o) { return +o.value === keep; })) sel.value = String(keep);
  }

  function endOfRange(date, q) {
    var ym = date.slice(0, 7), end;
    if (q === 'month') end = C.lastDayOfMonth(ym);
    else if (q === 'year') end = date.slice(0, 4) + '-12-31';
    else end = C.lastDayOfMonth(C.addMonths(ym, (+q) - 1));
    if (C.diffDays(date, end) > C.MAX_SPAN_DAYS) end = C.addDays(date, C.MAX_SPAN_DAYS);
    return end;
  }

  function repeatFreqValue() { return $('repFreq').value; }
  function applyFreq(setDefaultUntil) {
    var f = repeatFreqValue(), date = $('date').value;
    $('repMore').hidden = f === 'none';
    $('wdRow').hidden = !(f === 'weekly' || f === 'biweekly');
    $('nthRow').hidden = f !== 'monthly';
    if (f === 'weekly' || f === 'biweekly') { if (!state.wdTouched && C.parseISO(date)) setWeekdays([C.weekday(date)]); }
    if (f === 'monthly') buildNth(date, $('repNth').value ? +$('repNth').value : null);
    if (f !== 'none' && setDefaultUntil && (!$('until').value || $('until').value < date) && C.parseISO(date)) $('until').value = endOfRange(date, '3');
    updatePreview();
  }

  function readRepeat() {
    var f = repeatFreqValue();
    if (f === 'none') return { freq: 'none' };
    var r = { freq: f === 'biweekly' ? 'weekly' : f, interval: f === 'biweekly' ? 2 : 1, until: $('until').value };
    if (r.freq === 'weekly') r.weekdays = selectedWeekdays();
    if (r.freq === 'monthly') { r.nth = +$('repNth').value; r.weekday = C.weekday($('date').value); }
    return r;
  }

  function updatePreview() {
    var pv = $('preview');
    if (repeatFreqValue() === 'none') { pv.textContent = ''; return true; }
    var date = $('date').value, res = C.expandRule(date, readRepeat());
    if (res.error) { pv.className = 'preview bad'; pv.textContent = res.error; return false; }
    var n = res.dates.length;
    pv.className = 'preview';
    pv.textContent = C.describeRule(date, res.rule) + ' · ' + n + (n === 1 ? ' event' : ' events') + ', ' + fmtShort(res.dates[0]) + (n > 1 ? ' to ' + fmtShort(res.dates[n - 1]) : '') + '.';
    return true;
  }

  $('repFreq').addEventListener('change', function () { applyFreq(true); });
  $('repNth').addEventListener('change', updatePreview);
  $('until').addEventListener('input', updatePreview);
  $('date').addEventListener('change', function () {
    var f = repeatFreqValue();
    if (f !== 'none') { applyFreq(false); if ($('until').value && $('until').value < $('date').value) $('until').value = endOfRange($('date').value, '3'); updatePreview(); }
  });
  $('quick').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-q]'); if (!b || !C.parseISO($('date').value)) return;
    $('until').value = endOfRange($('date').value, b.dataset.q); updatePreview();
  });

  function scopeValue() { return document.querySelector('input[name=scope]:checked').value; }
  function applyScope() {
    var ed = state.editing, series = ed && ed.seriesId, s = scopeValue();
    $('repeatBox').hidden = !!series && s === 'one';
    $('delBtn').textContent = series ? (s === 'following' ? 'Delete this and following' : 'Delete this event') : 'Delete';
    $('date').title = '';
  }
  [].forEach.call(document.querySelectorAll('input[name=scope]'), function (r) { r.addEventListener('change', applyScope); });

  /* ---------- opening the form ---------- */
  function resetRepeat(date) {
    state.wdTouched = false;
    $('repFreq').value = 'none'; $('until').value = '';
    setWeekdays([C.weekday(date)]); buildNth(date, null);
    $('repMore').hidden = true; $('preview').textContent = '';
  }

  function fillForm(f, editing) {
    state.editing = editing || null;
    nameIn.value = f.title || '';
    setKind(f.kind || 'service');
    $('detail').value = f.detail || '';
    $('date').value = f.date;
    $('allDay').checked = !!f.allDay;
    $('start').value = f.start || ''; $('end').value = f.end || '';
    $('location').value = f.location || '';
    applyAllDay(); applyKind(true);
    resetRepeat(f.date);
    $('scopeBox').hidden = !(editing && editing.seriesId);
    document.querySelector('input[name=scope][value=one]').checked = true;
    if (editing && editing.seriesId && editing.repeat && editing.repeat.freq !== 'none') {
      var r = editing.repeat;
      $('repFreq').value = r.freq === 'weekly' && r.interval === 2 ? 'biweekly' : r.freq;
      if (r.weekdays) { setWeekdays(r.weekdays); state.wdTouched = true; }
      $('until').value = r.until || '';
      applyFreq(false);
      if (r.freq === 'monthly') { buildNth(f.date, r.nth); }
      updatePreview();
    }
    $('delBtn').hidden = !editing;
    $('dlgEyebrow').textContent = editing ? 'Edit event' : 'New event';
    $('dlgTitle').textContent = editing ? 'Change this event' : 'Add to ' + fmtLong(f.date);
    $('saveBtn').textContent = editing ? 'Save changes' : 'Save';
    say(''); closeCombo(); applyScope();
  }

  function openNew(date) {
    if (!date) date = state.month === todayISO().slice(0, 7) ? todayISO() : state.month + '-01';
    fillForm({ date: date, kind: 'service' }, null);
    dlg.showModal();
    nameIn.focus();
  }
  function openEdit(id) {
    var e = state.data.events.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    fillForm(e, e);
    dlg.showModal();
    nameIn.focus();
    nameIn.select();
  }

  dlg.addEventListener('cancel', function (e) { if (!list.hidden) { e.preventDefault(); closeCombo(); } });
  $('cancelBtn').addEventListener('click', function () { dlg.close(); });

  /* ---------- saving ---------- */
  function collect() {
    var closed = getKind() === 'closed', allDay = closed || $('allDay').checked;
    return {
      title: nameIn.value.trim(), detail: $('detail').value.trim(), kind: getKind(), date: $('date').value,
      allDay: allDay, start: allDay ? '' : $('start').value, end: allDay ? '' : $('end').value, location: $('location').value.trim(),
    };
  }

  $('ef').addEventListener('submit', function (e) {
    e.preventDefault(); say('');
    var body = collect(), ed = state.editing;
    if (!body.title) { say('Enter a group or event name.'); nameIn.focus(); return; }
    if (!C.parseISO(body.date)) { say('Pick a date.'); return; }
    if (body.end && !body.start) { say('Add a start time, or clear the end time.'); return; }
    if (body.start && body.end && body.end <= body.start) { say('The end time must be after the start time.'); return; }
    var series = ed && ed.seriesId, scope = series ? scopeValue() : 'one';
    var wasFinal = state.data && state.data.status === 'final';
    var url = '/api/calendar/events';
    if (ed) { url = '/api/calendar/events/' + ed.id + '/update'; body.scope = scope; }
    if (!(series && scope === 'one')) {
      if (repeatFreqValue() !== 'none' && !updatePreview()) { say('Fix the repeat settings first.'); return; }
      body.repeat = readRepeat();
    }
    var btn = $('saveBtn'); btn.disabled = true;
    P.api(url, { method: 'POST', body: body }).then(function (r) {
      dlg.close();
      var msg = ed ? 'Saved.' : (r.count > 1 ? 'Added ' + r.count + ' events.' : 'Event added.');
      if (ed && r.count > 1) msg = 'Saved. ' + r.count + ' events updated.';
      if (wasFinal) msg += ' This calendar is back to Draft. Mark it final again when you are done.';
      toast(msg);
      return load();
    }).catch(function (err) { say(err.message); }).then(function () { btn.disabled = false; });
  });

  $('delBtn').addEventListener('click', function () {
    var ed = state.editing; if (!ed) return;
    var series = !!ed.seriesId, scope = series ? scopeValue() : 'one';
    var q = scope === 'following' ? 'Delete this event and all the ones that follow it?' : 'Delete “' + ed.title + '” on ' + fmtLong(ed.date) + '?';
    if (!confirm(q)) return;
    var wasFinal = state.data && state.data.status === 'final';
    P.api('/api/calendar/events/' + ed.id + '/delete', { method: 'POST', body: { scope: scope } }).then(function (r) {
      dlg.close();
      toast((r.removed > 1 ? r.removed + ' events deleted.' : 'Event deleted.') + (wasFinal ? ' This calendar is back to Draft.' : ''));
      return load();
    }).catch(function (err) { say(err.message); });
  });

  /* ---------- notes, names, final ---------- */
  function norm(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
  function saveMeta() {
    var d = state.data; if (!d || !d.canEdit) return;
    var body = { month: state.month }, changed = false;
    ['note', 'chaplain', 'warden'].forEach(function (k) {
      var v = norm($(k).value);
      if (v !== norm(state.meta[k])) { body[k] = v; changed = true; }
    });
    if (!changed) return;
    var wasFinal = d.status === 'final';
    P.api('/api/calendar/month', { method: 'POST', body: body }).then(function () {
      toast('Saved.' + (wasFinal ? ' This calendar is back to Draft. Mark it final again when you are done.' : ''));
      return load();
    }).catch(function (err) { showAlert(err.message); });
  }
  ['note', 'chaplain', 'warden'].forEach(function (k) { $(k).addEventListener('change', saveMeta); });

  $('finalBtn').addEventListener('click', function () {
    var d = state.data; if (!d) return;
    var toFinal = d.status !== 'final';
    var b = $('finalBtn'); b.disabled = true;
    P.api('/api/calendar/month', { method: 'POST', body: { month: state.month, status: toFinal ? 'final' : 'draft' } }).then(function () {
      toast(toFinal ? 'Marked as final. Supervisors can see it as ready.' : 'Reopened. You can edit it again.');
      return load();
    }).catch(function (err) { showAlert(err.message); }).then(function () { b.disabled = false; });
  });

  /* ---------- toolbar ---------- */
  function buildToolbar() {
    var ms = $('monthSel'), ys = $('yearSel'), y0 = +todayISO().slice(0, 4);
    C.MONTHS.forEach(function (m, i) { ms.appendChild(el('option', { value: String(i + 1), text: m })); });
    for (var y = y0 - 1; y <= y0 + 2; y++) ys.appendChild(el('option', { value: String(y), text: String(y) }));
    ms.addEventListener('change', function () { go(ys.value + '-' + pad(+ms.value)); });
    ys.addEventListener('change', function () { go(ys.value + '-' + pad(+ms.value)); });
    $('prev').addEventListener('click', function () { go(C.addMonths(state.month, -1)); });
    $('next').addEventListener('click', function () { go(C.addMonths(state.month, 1)); });
    $('todayBtn').addEventListener('click', function () { go(todayISO().slice(0, 7)); });
    $('printBtn').addEventListener('click', function () { window.print(); });
    $('addBtn').addEventListener('click', function () { openNew(null); });

    box.addEventListener('click', function (e) {
      if (!state.data || !state.data.canEdit) return;
      var ev = e.target.closest('.ev[data-id]');
      if (ev) { openEdit(Number(ev.dataset.id)); return; }
      var day = e.target.closest('.sh-day');
      if (day && !day.classList.contains('out') && day.dataset.date) openNew(day.dataset.date);
    });
    box.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ev') && e.target.dataset.id) {
        e.preventDefault(); openEdit(Number(e.target.dataset.id));
      }
    });
    window.addEventListener('resize', function () { var s = box.firstChild; if (s) S.scaleTo(box, s, minScale()); });
    window.addEventListener('beforeprint', function () { var s = box.firstChild; if (s) s.style.transform = ''; });
    window.addEventListener('afterprint', function () { var s = box.firstChild; if (s) S.scaleTo(box, s, minScale()); });
  }

  function setupSupervisor() {
    $('heroTitle').textContent = 'Chapel calendar';
    var back = $('backLink'); back.textContent = '← All calendars'; back.href = '/tools/chapel-calendar/all.html';
    var fs = $('facSel'); fs.hidden = false;
    return P.api('/api/facilities').then(function (r) {
      var list2 = r.facilities.slice();
      if (state.facility && list2.indexOf(state.facility) < 0) list2.push(state.facility);
      list2.forEach(function (f) { fs.appendChild(el('option', { value: f, text: f })); });
      fs.value = state.facility;
      fs.addEventListener('change', function () { state.facility = fs.value; load(); });
    });
  }

  /* ---------- start ---------- */
  buildWeekdayChips();
  buildToolbar();
  P.start({ roles: ['chaplain', 'supervisor'] }).then(function (me) {
    state.me = me.user;
    var q = new URLSearchParams(location.search), m = q.get('month');
    state.month = C.validMonth(m) ? m : todayISO().slice(0, 7);
    if (me.user.role === 'supervisor') {
      state.facility = q.get('facility') || '';
      if (!state.facility) { location.replace('/tools/chapel-calendar/all.html'); return null; }
      return setupSupervisor().then(load);
    }
    state.facility = me.user.facility || '';
    return load();
  }).then(function () {
    if (new URLSearchParams(location.search).get('print') === '1' && state.data) {
      var go = function () { setTimeout(function () { window.print(); }, 300); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
    }
  });
})();
