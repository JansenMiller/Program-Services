'use strict';
(function () {
  var P = window.Portal;
  document.getElementById('logo').appendChild(P.logo('wm'));
  var form = document.getElementById('f'), msg = document.getElementById('msg'), btn = document.getElementById('go');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; P.say(msg, '');
    P.api('/api/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } })
      .then(function (r) { location.href = r.mustChange ? '/change-password.html' : '/'; })
      .catch(function (err) { P.say(msg, err.message, 'err'); form.password.value = ''; btn.disabled = false; });
  });
})();
