'use strict';
(function () {
  var P = window.Portal, el = P.el;
  var form = document.getElementById('f'), msg = document.getElementById('msg'), list = document.getElementById('list');
  var STATUS = { new: 'New', planned: 'Planned', done: 'Done', declined: 'Not planned' };

  function load() {
    P.api('/api/ideas').then(function (r) {
      document.getElementById('list-title').textContent = r.canManage ? 'All ideas' : 'Your ideas';
      list.textContent = '';
      if (!r.ideas.length) list.appendChild(el('p', { class: 'empty', text: 'Nothing here yet. Your ideas will show up in this list.' }));
      r.ideas.forEach(function (i) {
        var meta = (r.canManage ? i.by + ' · ' : '') + P.fmtDate(i.createdAt);
        var row = el('div', { class: 'idea' },
          el('div', { class: 'top' }, el('h3', { text: i.title }), el('span', { class: 'badge b-' + i.status, text: STATUS[i.status] })),
          el('div', { class: 'meta', text: meta }));
        if (i.details) row.appendChild(el('p', { text: i.details }));
        if (r.canManage) {
          var sel = el('select', { 'aria-label': 'Status for ' + i.title });
          Object.keys(STATUS).forEach(function (k) {
            var o = el('option', { value: k, text: STATUS[k] }); if (k === i.status) o.selected = true; sel.appendChild(o);
          });
          sel.addEventListener('change', function () {
            P.api('/api/admin/ideas/' + i.id + '/status', { method: 'POST', body: { status: sel.value } }).then(load).catch(function (e) { alert(e.message); });
          });
          row.appendChild(sel);
        }
        list.appendChild(row);
      });
    });
  }

  P.start().then(function () {
    load();
    form.addEventListener('submit', function (e) {
      e.preventDefault(); P.say(msg, '');
      P.api('/api/ideas', { method: 'POST', body: { title: form.title.value, details: form.details.value } })
        .then(function () { form.reset(); P.say(msg, 'Thanks. Your idea was sent to Program Services.', 'ok'); load(); })
        .catch(function (err) { P.say(msg, err.message, 'err'); });
    });
  });
})();
