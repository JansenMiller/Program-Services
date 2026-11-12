'use strict';
(function () {
  var P = window.Portal, el = P.el;
  var form = document.getElementById('f'), msg = document.getElementById('msg'), rows = document.getElementById('rows'), temp = document.getElementById('temp');
  var ROLES = ['caseworker', 'chaplain', 'supervisor'];
  var facilities = [];
  var NEW = '__new__';

  // A facility picker: existing facilities, a blank choice, and "Add a new facility...".
  function facilityOptions(sel, current, blankText) {
    sel.textContent = '';
    sel.appendChild(el('option', { value: '', text: blankText || 'Choose a facility' }));
    var list = facilities.slice();
    if (current && list.indexOf(current) < 0) list.push(current);
    list.forEach(function (f) { var o = el('option', { value: f, text: f }); if (f === current) o.selected = true; sel.appendChild(o); });
    sel.appendChild(el('option', { value: NEW, text: 'Add a new facility\u2026' }));
    if (!current) sel.value = '';
  }
  // returns the chosen facility name, or null if the person cancelled adding a new one
  function resolveFacility(sel, previous) {
    if (sel.value !== NEW) return sel.value;
    var name = (prompt('Facility name (as it should print on the calendar):') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) { sel.value = previous || ''; return null; }
    if (facilities.indexOf(name) < 0) facilities.push(name);
    facilities.sort(function (a, b) { return a.localeCompare(b); });
    facilityOptions(sel, name);
    return name;
  }

  function showTemp(email, pw, verb) {
    temp.hidden = false; temp.textContent = '';
    temp.appendChild(el('div', { text: verb + ' ' + email + '. Give them this temporary password now. It will not be shown again:' }));
    temp.appendChild(el('code', { text: pw }));
  }
  function act(path, body, then) {
    return P.api(path, { method: 'POST', body: body || {} }).then(then || load).catch(function (e) { alert(e.message); load(); });
  }

  function load() {
    P.api('/api/admin/users').then(function (r) {
      rows.textContent = '';
      r.users.forEach(function (u) {
        var isMe = u.id === r.me;
        var roleSel = el('select', { 'aria-label': 'Role for ' + u.name });
        ROLES.forEach(function (k) { var o = el('option', { value: k, text: P.ROLE_LABEL[k] }); if (k === u.role) o.selected = true; roleSel.appendChild(o); });
        roleSel.disabled = isMe;
        roleSel.addEventListener('change', function () {
          if (roleSel.value === 'chaplain' && !u.facility) { alert('Choose ' + u.name + '\u2019s facility first, then change the role to Chaplain.'); load(); return; }
          act('/api/admin/users/' + u.id + '/role', { role: roleSel.value });
        });

        var facCell = el('td');
        if (u.role === 'supervisor') facCell.appendChild(el('span', { class: 'sub', text: 'Central Office' }));
        else {
          var facSel = el('select', { 'aria-label': 'Facility for ' + u.name });
          facilityOptions(facSel, u.facility, 'Not set');
          facSel.addEventListener('change', function () {
            var f = resolveFacility(facSel, u.facility);
            if (f === null) return;
            if (!f && u.role === 'chaplain') { alert('A chaplain needs a facility.'); load(); return; }
            act('/api/admin/users/' + u.id + '/facility', { facility: f });
          });
          facCell.appendChild(facSel);
        }

        var acts = el('div', { class: 'acts' },
          el('button', { class: 'secondary small', type: 'button', text: 'Reset password', onclick: function () {
            if (confirm('Reset the password for ' + u.name + '? They will be signed out.')) act('/api/admin/users/' + u.id + '/reset', {}, function (x) { showTemp(x.email, x.tempPassword, 'Password reset for'); load(); });
          } }));
        if (!isMe) acts.appendChild(el('button', { class: 'secondary small', type: 'button', text: u.active ? 'Turn off' : 'Turn on', onclick: function () {
          act('/api/admin/users/' + u.id + '/active', { active: !u.active });
        } }));

        var person = el('td', {}, el('span', { class: 'name', text: u.name + (isMe ? ' (you)' : '') }), el('span', { class: 'sub', text: u.email }));
        if (u.demo) person.appendChild(el('span', { class: 'badge b-role', text: 'Demo', style: 'margin-left:8px' }));
        if (!u.active) person.appendChild(el('span', { class: 'badge b-off', text: 'Off', style: 'margin-left:8px' }));
        else if (u.mustChange) person.appendChild(el('span', { class: 'badge b-wait', text: 'Awaiting first sign-in', style: 'margin-left:8px' }));
        rows.appendChild(el('tr', { class: u.active ? '' : 'off' }, person, el('td', {}, roleSel), facCell, el('td', { text: P.fmtDate(u.lastLogin) }), el('td', {}, acts)));
      });
    });
  }

  var facRow = document.getElementById('facRow'), facSelect = document.getElementById('facility'), lastFac = '';
  function syncFacRow() {
    var r = form.role.value;
    facRow.hidden = r === 'supervisor';
    facSelect.required = r === 'chaplain';
  }

  P.start({ roles: ['supervisor'] }).then(function () {
    return P.api('/api/facilities').then(function (r) { facilities = r.facilities; }).catch(function () { facilities = []; });
  }).then(function () {
    facilityOptions(facSelect, '');
    syncFacRow();
    form.role.addEventListener('change', syncFacRow);
    facSelect.addEventListener('change', function () { var f = resolveFacility(facSelect, lastFac); if (f !== null) lastFac = f; });
    load();
    form.addEventListener('submit', function (e) {
      e.preventDefault(); P.say(msg, '');
      var fac = form.role.value === 'supervisor' ? '' : facSelect.value;
      if (fac === NEW) fac = '';
      if (form.role.value === 'chaplain' && !fac) { P.say(msg, 'Choose the chaplain\u2019s facility.', 'err'); return; }
      P.api('/api/admin/users', { method: 'POST', body: { name: form.name.value, email: form.email.value, role: form.role.value, facility: fac } })
        .then(function (r) { showTemp(r.email, r.tempPassword, 'Account created for'); form.reset(); lastFac = ''; facilityOptions(facSelect, ''); syncFacRow(); load(); })
        .catch(function (err) { P.say(msg, err.message, 'err'); });
    });
  });
})();
