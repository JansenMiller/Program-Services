'use strict';
(function () {
  var P = window.Portal, el = P.el;
  var BLURB = {
    supervisor: 'Central Office tools and team management.',
    caseworker: 'Your tools for the work that takes the most time.',
    chaplain: 'Your tools for chapels and classrooms.',
  };
  P.start().then(function (me) {
    document.getElementById('hello').textContent = 'Welcome, ' + me.user.name.split(' ')[0];
    document.getElementById('role-line').textContent = BLURB[me.user.role] || '';
    var chip = document.getElementById('role-chip');
    chip.textContent = P.ROLE_LABEL[me.user.role] || ''; chip.hidden = !chip.textContent;

    var box = document.getElementById('cards');
    var cards = {};
    me.tools.forEach(function (t, i) {
      var live = t.status === 'live';
      var card = live
        ? el('a', { class: 'card rise', href: t.href })
        : el('div', { class: 'card soon rise' });
      card.style.setProperty('--i', i);
      card.appendChild(el('div', { class: 'icon' }, P.icon(t.icon)));
      card.appendChild(el('h3', { text: t.name }));
      card.appendChild(el('p', { text: t.description }));
      if (live) card.appendChild(el('div', { class: 'go' }, el('span', { text: 'Open' }), P.icon('arrow')));
      else card.appendChild(el('span', { class: 'badge b-wait tag', text: 'Coming soon' }));
      cards[t.id] = card;
      box.appendChild(card);
    });

    // Supervisors see how many shortcut ideas are waiting.
    if (me.user.role === 'supervisor' && cards.ideas) {
      P.api('/api/ideas').then(function (r) {
        var n = r.ideas.filter(function (i) { return i.status === 'new'; }).length;
        if (n) cards.ideas.appendChild(el('span', { class: 'badge b-new tag', text: n + ' new' }));
      }).catch(function () {});
    }
  });
})();
