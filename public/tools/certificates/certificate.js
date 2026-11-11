'use strict';
(function () {
  var P = window.Portal;
  var $ = function (id) { return document.getElementById(id); };
  var ids = ['name', 'ais', 'program', 'date', 'hours', 'facility', 'facilitator', 'title'];

  function longDate(v) {
    if (!v) return '';
    var p = v.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function set(id, t) { $(id).textContent = t || ' '; }
  function render() {
    var v = {}; ids.forEach(function (i) { v[i] = $(i).value.trim(); });
    set('o-name', v.name);
    set('o-ais', v.ais ? ('AIS # ' + v.ais) : '');
    set('o-program', v.program);
    var meta = [];
    if (v.hours) meta.push(v.hours + (v.hours === '1' ? ' hour' : ' hours') + ' completed');
    if (v.facility) meta.push('at ' + v.facility);
    set('o-meta', meta.join(' '));
    set('o-fac', v.facilitator);
    $('o-fac-cap').textContent = v.title || 'Facilitator';
    set('o-date', longDate(v.date));
  }
  function fit() {
    var s = $('scaler'), w = $('wrap'), cert = $('cert');
    if (window.matchMedia('print').matches) return;
    var k = Math.min(1, s.clientWidth / cert.offsetWidth);
    w.style.transform = 'scale(' + k + ')';
    s.style.height = (cert.offsetHeight * k) + 'px';
  }

  P.start({ roles: ['caseworker', 'supervisor'] }).then(function (me) {
    ids.forEach(function (i) { $(i).addEventListener('input', render); });
    var d = new Date();
    $('date').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    // Pre-fill the facilitator with the signed-in person (they can overwrite it).
    $('facilitator').value = me.user.name;
    $('print').addEventListener('click', function () { window.print(); });
    $('clear').addEventListener('click', function () { ids.forEach(function (i) { $(i).value = ''; }); render(); });
    window.addEventListener('beforeprint', function () { document.title = 'Certificate - ' + ($('name').value.trim() || 'Completion'); });
    window.addEventListener('afterprint', function () { document.title = 'Certificate of Completion · ADOC Staff Portal'; });
    window.addEventListener('resize', fit);
    render(); fit(); setTimeout(fit, 50);
  });
})();
