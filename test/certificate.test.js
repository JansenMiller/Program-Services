'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../public/tools/certificates/certificate.js');

test('date is split into day, month and year', () => {
  assert.deepEqual(c.dateParts('2026-11-12'), { day: '12', month: 'November', year: '2026' });
  assert.deepEqual(c.dateParts('2027-01-05'), { day: '5', month: 'January', year: '2027' });
  assert.deepEqual(c.dateParts(''), { day: '', month: '', year: '' });
});

test('roster lines are cleaned and blank lines dropped', () => {
  assert.deepEqual(c.parseNames('  Mary   Ann Smith \r\n\r\nJohn Doe\n   \n', false), ['Mary Ann Smith', 'John Doe']);
  assert.equal(c.parseNames('x'.repeat(200), false)[0].length, 80);
});

test('tidy turns LAST, FIRST and ALL CAPS into First Last', () => {
  assert.deepEqual(c.parseNames('ALSTON, DESTINY S\nCARDWELL-WOODS, FANAURIA T\nO\'NEAL, DE\'ANDRE\nmikayla tolbert', true),
    ['Destiny S. Alston', 'Fanauria T. Cardwell-Woods', "De'Andre O'Neal", 'Mikayla Tolbert']);
  assert.equal(c.tidyName('Aja Kylandrea B. Whitt'), 'Aja Kylandrea B. Whitt'); // already fine: untouched
  assert.equal(c.tidyName('John Smith, Jr.'), 'John Smith, Jr.');               // suffix is not a first name
  assert.equal(c.tidyName('MCDONALD, JOHN'), 'John McDonald');
  assert.equal(c.tidyName('DeShawn Jackson'), 'DeShawn Jackson');                // mixed case left alone
});

test('artwork file is valid and contains no scripts or external links', () => {
  const svg = fs.readFileSync(path.join(__dirname, '../public/tools/certificates/certificate-bg.svg'), 'utf8');
  assert.match(svg, /^<svg /);
  assert.ok(!/<script|href=|onload=|<image/i.test(svg.replace(/xmlns:xlink="[^"]*"/, '')), 'artwork must be plain vector shapes');
});
