'use strict';
(function () {
  var P = window.Portal, el = P.el;
  var BLURB = {
    supervisor: 'Central Office tools and team management.',
    caseworker: 'Tools for Social Service Caseworkers.',
    chaplain: 'Tools for chaplains.',
  };
  P.start().then(function (me) {
    document.getElementById('hello').textContent = 'Welcome, ' + me.user.name.split(' ')[0];
    document.getElementById('role-line').textContent = (P.ROLE_LABEL[me.user.role] || '') + ' · ' + (BLURB[me.user.role] || '');
    var box = document.getElementById('cards');
    me.tools.forEach(function (t) {
      var live = t.status === 'live';
      var head = el('h3', { text: t.name });
      if (!live) head.appendChild(el('span', { class: 'badge', text: 'Coming soon' }));
      var card = live
        ? el('a', { class: 'card', href: t.href }, head, el('p', { text: t.description }))
        : el('div', { class: 'card soon' }, head, el('p', { text: t.description }));
      box.appendChild(card);
    });
  });
})();
