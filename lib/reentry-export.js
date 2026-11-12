'use strict';
// Fills in the department's own Statistical and Tracking Report workbook (men's or women's) from saved report data,
// so the file that goes to the Regional Reentry Coordinator looks exactly like the one staff used to type into.
const fs = require('node:fs');
const path = require('node:path');
const X = require('./xlsx');
const R = require('../public/tools/reentry-report/report-core.js');

const TEMPLATE = { men: path.join(__dirname, 'templates', 'men.xlsx'), women: path.join(__dirname, 'templates', 'women.xlsx') };
const BLOCK_COLS = [1, 8, 16, 24];            // programs: four blocks across (A, H, P, X); the numbers sit four columns in
const ROSTER_FIRST_ROW = 7, ROSTER_LAST_ROW = 1564;
// Service document blocks: [id, first column, top row]. The Refusals and Non-Driver ID blocks swap places between the two workbooks.
const DOC_LAYOUT = {
  men: [['birth', 1, 3], ['license', 8, 3], ['food', 15, 3], ['medical', 22, 3], ['ss', 1, 20], ['ndid', 8, 20], ['refusals', 15, 20]],
  women: [['birth', 1, 3], ['license', 8, 3], ['food', 15, 3], ['medical', 22, 3], ['ss', 1, 20], ['refusals', 8, 20], ['ndid', 15, 20]],
};

// Which part of the zip is which sheet, by order in the workbook: Programs Report Blank, <month>, Graduation Roster, Service Docs Reports.
function sheetFiles(entries) {
  const wb = entries.find((e) => e.name === 'xl/workbook.xml').data.toString('utf8');
  const rels = entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels').data.toString('utf8');
  const target = {};
  rels.replace(/<Relationship\b[^>]*>/g, (tag) => {
    const id = (tag.match(/\bId="([^"]+)"/) || [])[1], t = (tag.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && t) target[id] = 'xl/' + t.replace(/^\/?(xl\/)?/, '');
    return tag;
  });
  const sheets = [];
  wb.replace(/<sheet\b[^>]*>/g, (tag) => {
    sheets.push({ name: (tag.match(/\bname="([^"]*)"/) || [])[1], file: target[(tag.match(/\br:id="([^"]+)"/) || [])[1]] });
    return tag;
  });
  return sheets;
}

function programCells(cells, programs, facility, rosterCounts, population) {
  const put = (col, row, v) => cells.set(X.addr(col, row), v);
  for (let i = 0; i < R.SLOTS[population]; i++) {
    const top = 3 + 20 * Math.floor(i / 4), c0 = BLOCK_COLS[i % 4], vc = c0 + 4, p = programs[i];
    put(c0, top + 1, { s: 'Program' });
    if (!p) { put(c0 + 2, top + 1, { clear: true }); continue; }
    put(c0 + 2, top, { s: facility });
    put(c0 + 2, top + 1, { s: p.name });
    const grad = R.effGrad(p, rosterCounts[p.name] || 0);
    [p.bf, p.enr, p.tdisc, p.toth, grad].forEach((v, k) => put(vc, top + 4 + k, { n: v === null ? 0 : v }));
    put(vc, top + 9, { n: R.programTotal(p, rosterCounts[p.name] || 0) });
    [p.black, p.white, p.other].forEach((v, k) => put(vc, top + 12 + k, { n: v === null ? 0 : v }));
    put(vc, top + 15, { n: R.raceTotal(p) });
  }
}

function docCells(cells, docs, facility, population) {
  const put = (col, row, v) => cells.set(X.addr(col, row), v);
  for (const [id, c0, top] of DOC_LAYOUT[population]) {
    const def = R.DOCS.find((d) => d.id === id), doc = docs[id], vc = c0 + 4;
    put(c0 + 2, top, { s: facility });
    def.rows.forEach((_, k) => put(vc, top + 4 + k, { n: doc.v[k] === null ? 0 : doc.v[k] }));
    put(vc, top + 12, { n: doc.total === null ? 0 : doc.total });
  }
}

// report: { population, programs[], docs{} }; roster: [{ ais, program, date }] (already filtered and sorted); rosterCounts: { program: n } for the month.
function buildWorkbook({ report, facility, month, roster, rosterCounts }) {
  const population = report.population === 'women' ? 'women' : 'men';
  const entries = X.readZip(fs.readFileSync(TEMPLATE[population]));
  const sheets = sheetFiles(entries);
  const part = (name) => entries.find((e) => e.name === name);
  const monthSheet = sheets[1], rosterSheet = sheets[2], docsSheet = sheets[3];
  const label = R.monthLabel(month);

  // Programs tab (renamed to the month)
  let cells = new Map();
  programCells(cells, report.programs, facility, rosterCounts || {}, population);
  part(monthSheet.file).data = Buffer.from(X.fillSheet(part(monthSheet.file).data.toString('utf8'), cells), 'utf8');

  // Service Docs tab
  cells = new Map();
  docCells(cells, report.docs, facility, population);
  part(docsSheet.file).data = Buffer.from(X.fillSheet(part(docsSheet.file).data.toString('utf8'), cells), 'utf8');

  // Graduation Roster tab: AIS number, program, graduation date
  if (roster.length > ROSTER_LAST_ROW - ROSTER_FIRST_ROW + 1) throw new Error('Too many graduates for the roster sheet.');
  let rosterXml = part(rosterSheet.file).data.toString('utf8');
  if (roster.length) {
    const styles = part('xl/styles.xml');
    const ds = X.withDateStyle(styles.data.toString('utf8'), X.styleOf(rosterXml, 'K7'));
    styles.data = Buffer.from(ds.xml, 'utf8');
    cells = new Map();
    roster.forEach((g, i) => {
      const r = ROSTER_FIRST_ROW + i;
      cells.set('A' + r, { s: g.ais });
      cells.set('D' + r, { s: g.program });
      cells.set('K' + r, { d: X.excelDate(g.date), style: ds.index });
    });
    rosterXml = X.fillSheet(rosterXml, cells);
    part(rosterSheet.file).data = Buffer.from(rosterXml, 'utf8');
  }

  // Name the month tab, and keep the document properties tidy
  const wb = part('xl/workbook.xml');
  wb.data = Buffer.from(wb.data.toString('utf8').replace(`name="${monthSheet.name}"`, `name="${X.esc(label)}"`), 'utf8');
  const app = part('docProps/app.xml');
  if (app) app.data = Buffer.from(app.data.toString('utf8').replace(`<vt:lpstr>${monthSheet.name}</vt:lpstr>`, `<vt:lpstr>${X.esc(label)}</vt:lpstr>`), 'utf8');
  const core = part('docProps/core.xml');
  if (core) core.data = Buffer.from(core.data.toString('utf8').replace(/(<dcterms:modified[^>]*>)[^<]*/, `$1${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`), 'utf8');

  return X.writeZip(entries);
}

const fileName = (facility, month) => `${facility.replace(/[^A-Za-z0-9 ._-]/g, '').trim().replace(/\s+/g, '_')}_Tracking_Report_${R.monthLabel(month).replace(' ', '_')}.xlsx`;

module.exports = { buildWorkbook, fileName, DOC_LAYOUT };
