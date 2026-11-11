'use strict';
(function () {
  var P = window.Portal, el = P.el;
  var form = document.getElementById('f'), msg = document.getElementById('msg'), rows = document.getElementById('rows'), temp = document.getElementById('temp');
  var ROLES = ['caseworker', 'chaplain', 'supervisor'];

  function showTemp(email, pw, verb) {
    temp.hidden = false; temp.textContent = '';
    temp.appendChild(el('div', { text: verb + ' ' + email + '. Give them this temporary password now. It will not be shown again:' }));
    temp.appendChild(el('div', { style: 'margin-top:8px' }, el('code', { text: pw })));
  }
  function act(path, body, then) {
    return P.api(path, { method: 'POST', body: body || {} }).then(then || load).catch(function (e) { alert(e.message); load(); });
  }

  function load() {
    P.api('/api/admin/users').then(function (r) {
      rows.textContent = '';
      r.users.forEach(function (u) {
        var isMe = u.id === r.me;
        var roleSel = el('select', { 'aria-label': 'Role for ' + u.name, style: 'width:auto' });
        ROLES.forEach(function (k) { var o = el('option', { value: k, text: P.ROLE_LABEL[k] }); if (k === u.role) o.selected = true; roleSel.appendChild(o); });
        roleSel.disabled = isMe;
        roleSel.addEventListener('change', function () { act('/api/admin/users/' + u.id + '/role', { role: roleSel.value }); });

        var acts = el('div', { class: 'acts' },
          el('button', { class: 'secondary small', type: 'button', text: 'Reset password', onclick: function () {
            if (confirm('Reset the password for ' + u.name + '? They will be signed out.')) act('/api/admin/users/' + u.id + '/reset', {}, function (x) { showTemp(x.email, x.tempPassword, 'Password reset for'); load(); });
          } }));
        if (!isMe) acts.appendChild(el('button', { class: 'secondary small', type: 'button', text: u.active ? 'Turn off' : 'Turn on', onclick: function () {
          act('/api/admin/users/' + u.id + '/active', { active: !u.active });
        } }));

        var name = el('td', {}, u.name + (isMe ? ' (you)' : ''));
        if (!u.active) name.appendChild(el('span', { class: 'badge', text: 'Off' }));
        if (u.mustChange && u.active) name.appendChild(el('span', { class: 'badge', text: 'Awaiting first sign-in' }));
        rows.appendChild(el('tr', { class: u.active ? '' : 'off' }, name, el('td', { text: u.email }), el('td', {}, roleSel), el('td', { text: P.fmtDate(u.lastLogin) }), el('td', {}, acts)));
      });
    });
  }

  P.start({ roles: ['supervisor'] }).then(function () {
    load();
    form.addEventListener('submit', function (e) {
      e.preventDefault(); P.say(msg, '');
      P.api('/api/admin/users', { method: 'POST', body: { name: form.name.value, email: form.email.value, role: form.role.value } })
        .then(function (r) { showTemp(r.email, r.tempPassword, 'Account created for'); form.reset(); load(); })
        .catch(function (err) { P.say(msg, err.message, 'err'); });
    });
  });
})();
