'use strict';
(function () {
  var P = window.Portal, el = P.el;
  var BLURB = {
    supervisor: 'Central Office tools and team management.',
    caseworker: 'Your tools for the work that takes the most time.',
    chaplain: 'Your tools for chapels and classrooms.',
  };
  function dayText(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }
  function reportNotice(href, s) {
    var title, text, cls = '';
    if (s.kind === 'caseworker') {
      if (s.status === 'nofacility') return;
      if (s.status === 'submitted') { cls = ' done'; title = s.label + ' report submitted'; text = 'Thank you. The next one is due ' + dayText(s.nextDue) + '.'; }
      else {
        var state = s.status === 'draft' ? 'You\u2019ve started it; your numbers are saved.' : 'It saves as you type, so you can do it in pieces.';
        if (s.daysLeft < 0) { cls = ' late'; title = s.label + ' report is ' + plural(-s.daysLeft, 'day') + ' overdue'; text = 'It was due ' + dayText(s.due) + '. ' + state; }
        else { title = s.label + ' report is due ' + (s.daysLeft === 0 ? 'today' : dayText(s.due)); text = (s.daysLeft ? plural(s.daysLeft, 'day') + ' left. ' : '') + state; }
      }
    } else {
      if (!s.expected) return;
      var out = s.expected - s.submitted;
      title = s.submitted + ' of ' + s.expected + ' facilities have submitted ' + s.label;
      if (!out) { cls = ' done'; text = 'Every report is in.'; }
      else if (s.daysLeft < 0) { cls = ' late'; text = plural(out, 'report') + ' overdue. They were due ' + dayText(s.due) + '.'; }
      else text = plural(out, 'report') + ' still out. Due ' + dayText(s.due) + '.';
    }
    var a = el('a', { class: 'notice rise' + cls, href: href },
      el('div', { class: 't' }, el('b', { text: title }), el('span', { text: text })),
      el('div', { class: 'go' }, el('span', { text: s.kind === 'caseworker' ? 'Open report' : 'See all' }), P.icon('arrow')));
    document.getElementById('notice').appendChild(a);
  }

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

    // Monthly tracking report reminder: due the 5th of every month.
    var rr = me.tools.filter(function (t) { return t.id === 'reentry-report' && t.status === 'live'; })[0];
    if (rr) P.api('/api/reentry/status').then(function (s) { reportNotice(rr.href, s); }).catch(function () {});

    // Supervisors see how many shortcut ideas are waiting.
    if (me.user.role === 'supervisor' && cards.ideas) {
      P.api('/api/ideas').then(function (r) {
        var n = r.ideas.filter(function (i) { return i.status === 'new'; }).length;
        if (n) cards.ideas.appendChild(el('span', { class: 'badge b-new tag', text: n + ' new' }));
      }).catch(function () {});
    }
  });
})();
