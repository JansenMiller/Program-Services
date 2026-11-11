'use strict';
// Shared helpers for every page. No inline scripts anywhere (strict CSP), and no innerHTML for data.
(function () {
  var csrf = null;
  var ROLE_LABEL = { supervisor: 'Supervisor', caseworker: 'Social Service Caseworker', chaplain: 'Chaplain' };

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { Accept: 'application/json' };
    var init = { method: opts.method || 'GET', headers: headers, credentials: 'same-origin' };
    if (init.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      if (csrf) headers['X-CSRF-Token'] = csrf;
      init.body = JSON.stringify(opts.body || {});
    }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && path !== '/api/login') { location.href = '/login.html'; }
        if (r.status === 403 && data.error === 'password_change_required') { location.href = '/change-password.html'; }
        if (!r.ok) { var e = new Error(data.error || 'Something went wrong.'); e.status = r.status; throw e; }
        return data;
      });
    });
  }

  function logo(cls) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'adoc-logo');
    s.setAttribute('viewBox', '0 0 182.9 25.13');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', 'ADOC Program Services');
    var u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '/assets/logo.svg#adoc-wordmark-paths');
    s.appendChild(u);
    var d = el('div', { class: cls || 'wm' });
    d.appendChild(s);
    return d;
  }

  // Loads the signed-in user, builds the header, and returns {user, csrf, tools}.
  function start(opts) {
    opts = opts || {};
    return api('/api/me').then(function (me) {
      csrf = me.csrf;
      if (opts.roles && opts.roles.indexOf(me.user.role) < 0) { location.href = '/'; return new Promise(function () {}); }
      var h = document.getElementById('site-header');
      if (h) {
        h.textContent = '';
        h.className = 'site';
        h.appendChild(el('a', { href: '/', 'aria-label': 'Staff portal home' }, logo('wm')));
        var who = el('div', { class: 'who' },
          el('span', { text: me.user.name + ' · ' + (ROLE_LABEL[me.user.role] || me.user.role) }),
          el('a', { href: '/change-password.html', text: 'Change password' }),
          el('button', { class: 'link', type: 'button', text: 'Sign out', onclick: signOut }));
        h.appendChild(who);
      }
      return me;
    });
  }

  function signOut() {
    api('/api/logout', { method: 'POST' }).catch(function () {}).then(function () { location.href = '/login.html'; });
  }
  function setCsrf(v) { csrf = v; }
  function say(node, text, kind) { node.textContent = text || ''; node.className = 'msg' + (kind ? ' ' + kind : ''); }
  function fmtDate(ms) { return ms ? new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'; }

  window.Portal = { el: el, api: api, start: start, signOut: signOut, logo: logo, say: say, fmtDate: fmtDate, setCsrf: setCsrf, ROLE_LABEL: ROLE_LABEL };
})();
