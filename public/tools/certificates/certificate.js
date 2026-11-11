'use strict';
// Certificate of Completion: fills the approved ADOC artwork with a name, program and date.
// One page per name, so a whole class prints as a single PDF. Nothing typed here leaves the browser.
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var BG = '/tools/certificates/certificate-bg.svg';
  var FONT = "Baskerville, 'Baskerville Old Face', 'Libre Baskerville', Georgia, 'Times New Roman', serif";
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MAX_NAMES = 300;

  // Positions are in points on the 792 x 612 artwork, measured from the approved certificate.
  // x is the centre of the line, y is the text baseline.
  var SLOTS = {
    name:    { x: 396,   y: 234.5, size: 40, max: 410, italic: false },
    program: { x: 396,   y: 324.5, size: 28, max: 410, italic: true },
    day:     { x: 351.8, y: 375.3, size: 16, max: 44,  italic: false },
    month:   { x: 490.2, y: 375.3, size: 16, max: 112, italic: false },
    year:    { x: 582.5, y: 375.3, size: 16, max: 112, italic: false },
  };

  // ---- pure helpers (also unit tested in Node) ----
  function dateParts(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) return { day: '', month: '', year: '' };
    return { day: String(parseInt(m[3], 10)), month: MONTHS[parseInt(m[2], 10) - 1] || '', year: m[1] };
  }

  function titleCase(s) {
    var t = s.toLowerCase().replace(/(^|[\s\-'\u2019.])([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); });
    t = t.replace(/\bMc([a-z])/g, function (m, c) { return 'Mc' + c.toUpperCase(); });
    t = t.replace(/\b(Ii|Iii|Iv)\b/g, function (m) { return m.toUpperCase(); });
    return t;
  }

  var SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

  // Fixes words typed in all caps or all lower case, word by word. Mixed-case words (McDonald, DeShawn) are left alone.
  function fixCase(s) {
    return s.split(' ').map(function (tok) {
      if (!tok || (tok !== tok.toUpperCase() && tok !== tok.toLowerCase())) return tok;
      var t = titleCase(tok);
      return /^[A-Z]$/.test(t) ? t + '.' : t; // a lone initial gets its period
    }).join(' ');
  }

  // "ALSTON, DESTINY S" -> "Destiny S. Alston". A trailing suffix such as ", Jr." is not treated as a first name.
  function tidyName(s) {
    var out = s;
    var parts = out.split(',');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim() && !SUFFIX.test(parts[1].trim())) out = parts[1].trim() + ' ' + parts[0].trim();
    return fixCase(out);
  }

  function parseNames(text, tidy) {
    var seen = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var n = line.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!n) return;
      seen.push(tidy ? tidyName(n) : n);
    });
    return seen;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { dateParts: dateParts, tidyName: tidyName, parseNames: parseNames, titleCase: titleCase }; return; }

  // ---- browser UI ----
  var P = window.Portal;
  var $ = function (id) { return document.getElementById(id); };

  function textEl(slot, value) {
    var t = document.createElementNS(NS, 'text');
    t.setAttribute('x', slot.x); t.setAttribute('y', slot.y);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-family', FONT);
    t.setAttribute('font-size', slot.size);
    if (slot.italic) t.setAttribute('font-style', 'italic');
    t.setAttribute('fill', '#111111');
    t.textContent = value;
    t.dataset.size = slot.size; t.dataset.max = slot.max;
    return t;
  }

  function buildSheet(values, index, total) {
    var wrap = document.createElement('div');
    wrap.className = 'sheet';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 792 612');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Certificate of Completion' + (values.name ? ' for ' + values.name : ''));
    var bg = document.createElementNS(NS, 'image');
    bg.setAttribute('href', BG); bg.setAttribute('x', 0); bg.setAttribute('y', 0); bg.setAttribute('width', 792); bg.setAttribute('height', 612);
    svg.appendChild(bg);
    Object.keys(SLOTS).forEach(function (k) { if (values[k]) svg.appendChild(textEl(SLOTS[k], values[k])); });
    wrap.appendChild(svg);
    if (total) {
      var cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = 'Certificate ' + (index + 1) + ' of ' + total;
      wrap.appendChild(cap);
    }
    return wrap;
  }

  // Shrink any line that is wider than its underline.
  function fit(stage) {
    var texts = stage.querySelectorAll('svg text');
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i], size = +t.dataset.size, max = +t.dataset.max;
      t.setAttribute('font-size', size);
      var w = t.getComputedTextLength();
      if (w > max && w > 0) t.setAttribute('font-size', Math.max(10, Math.floor(size * max / w * 10) / 10));
    }
  }

  function render() {
    var names = parseNames($('names').value, $('tidy').checked);
    var over = names.length > MAX_NAMES;
    if (over) names = names.slice(0, MAX_NAMES);
    var d = dateParts($('date').value);
    var program = $('program').value.replace(/\s+/g, ' ').trim().slice(0, 80);
    var stage = $('stage');
    stage.textContent = '';
    var list = names.length ? names : [''];
    list.forEach(function (n, i) {
      var s = buildSheet({ name: n, program: program, day: d.day, month: d.month, year: d.year }, i, names.length ? names.length : 0);
      if (!names.length) s.classList.add('blank');
      stage.appendChild(s);
    });
    fit(stage);
    $('print').disabled = !names.length;
    $('print').textContent = names.length > 1 ? 'PRINT / SAVE AS PDF (' + names.length + ' CERTIFICATES)' : 'PRINT / SAVE AS PDF';
    $('count').textContent = over ? 'Only the first ' + MAX_NAMES + ' names are used. Run the rest as a second batch.' :
      (names.length ? names.length + (names.length === 1 ? ' certificate' : ' certificates') + ' ready.' : 'Add at least one name to print.');
  }

  P.start({ roles: ['caseworker', 'supervisor'] }).then(function () {
    var dt = new Date();
    $('date').value = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    ['program', 'date', 'names', 'tidy'].forEach(function (id) { $(id).addEventListener('input', render); $(id).addEventListener('change', render); });
    $('print').addEventListener('click', function () { render(); window.print(); });
    $('clear').addEventListener('click', function () { $('program').value = ''; $('names').value = ''; $('tidy').checked = false; render(); });
    window.addEventListener('beforeprint', function () { fit($('stage')); document.title = 'Certificates - ' + ($('program').value.trim() || 'Completion'); });
    window.addEventListener('afterprint', function () { document.title = 'Certificates of Completion · ADOC Staff Portal'; });
    render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fit($('stage')); });
    var bgImg = new Image(); bgImg.src = BG;
  });
})();
