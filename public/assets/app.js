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

  var ICONS = {
    award: ['M12 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z', 'M8.6 13.6 7 21l5-2.7 5 2.7-1.6-7.4', 'M12 6.6l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 8.7l2-.3z'],
    calendar: ['M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3.5 10h17', 'M8 3v4', 'M16 3v4', 'M8 14h2', 'M12 14h2', 'M16 14h.01', 'M8 17.5h2', 'M12 17.5h2'],
    spark: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'],
    users: ['M16 20v-1.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20', 'M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M20 20v-1.4a3.5 3.5 0 0 0-2.5-3.3', 'M15.5 4.7a3.5 3.5 0 0 1 0 6.6'],
    arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  };
  function icon(name) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    (ICONS[name] || ICONS.spark).forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); });
    return s;
  }

  function initials(name) {
    var w = String(name || '?').trim().split(/\s+/);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }

  // Loads the signed-in user, builds the header and footer, and returns {user, csrf, tools}.
  function start(opts) {
    opts = opts || {};
    return api('/api/me').then(function (me) {
      csrf = me.csrf;
      if (opts.roles && opts.roles.indexOf(me.user.role) < 0) { location.href = '/'; return new Promise(function () {}); }
      var h = document.getElementById('site-header');
      if (h) {
        h.textContent = '';
        h.className = 'site';
        var who = el('div', { class: 'who' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(me.user.name) }),
          el('span', { class: 'who-text' }, el('strong', { text: me.user.name }), el('small', { text: ROLE_LABEL[me.user.role] || me.user.role })),
          el('a', { href: '/change-password.html', text: 'Password' }),
          el('button', { class: 'link', type: 'button', text: 'Sign out', onclick: signOut }));
        h.appendChild(el('div', { class: 'bar' }, el('a', { href: '/', 'aria-label': 'Staff portal home' }, logo('wm')), who));
      }
      if (opts.footer !== false && !document.querySelector('footer.foot')) {
        document.body.appendChild(el('footer', { class: 'foot', text: 'ADOC Program Services \u00b7 Staff portal \u00b7 Authorized staff only' }));
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

  window.Portal = { el: el, api: api, start: start, signOut: signOut, logo: logo, icon: icon, say: say, fmtDate: fmtDate, setCsrf: setCsrf, ROLE_LABEL: ROLE_LABEL };
})();
