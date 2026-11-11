'use strict';
(function () {
  var P = window.Portal;
  var form = document.getElementById('f'), msg = document.getElementById('msg'), btn = document.getElementById('go');
  document.getElementById('logo').appendChild(P.logo('wm'));
  P.start().then(function (me) {
    if (me.user.mustChange) document.getElementById('intro').textContent = 'Your account was set up with a temporary password. Choose a new one to continue.';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.next.value !== form.again.value) return P.say(msg, 'The new passwords do not match.', 'err');
      btn.disabled = true; P.say(msg, '');
      P.api('/api/change-password', { method: 'POST', body: { current: form.current.value, next: form.next.value } })
        .then(function () { P.say(msg, 'Password changed. Taking you to the portal...', 'ok'); setTimeout(function () { location.href = '/'; }, 800); })
        .catch(function (err) { P.say(msg, err.message, 'err'); btn.disabled = false; });
    });
  });
})();
