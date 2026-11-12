'use strict';
// Just enough of the .xlsx format to fill in an existing workbook and keep all of its formatting.
// No dependencies: a .xlsx is a zip of XML files, and Node ships with the compression and CRC routines.
const zlib = require('node:zlib');

/* ---------- zip ---------- */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    entries.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

function writeZip(entries) {
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const deflated = packed.length < data.length;
    const body = deflated ? packed : data, method = deflated ? 8 : 0, crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

/* ---------- cells ---------- */
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colLetters(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
const addr = (col, row) => colLetters(col) + row;

// A cell value is { n: number } | { s: text } | { d: Excel date serial, style: n } | { clear: true }.
function cellXml(ref, attrs, value) {
  attrs = attrs.replace(/\s(t|s)="[^"]*"/g, (m, k) => (k === 's' ? m : ''));
  if (value.style !== undefined) attrs = attrs.replace(/\ss="[^"]*"/, '') + ` s="${value.style}"`;
  if (value.clear) return `<c r="${ref}"${attrs}/>`;
  if (value.n !== undefined) return `<c r="${ref}"${attrs}><v>${value.n}</v></c>`;
  if (value.d !== undefined) return `<c r="${ref}"${attrs}><v>${value.d}</v></c>`;
  return `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(value.s)}</t></is></c>`;
}

// cells: Map of "E7" -> value. Only the rows that are mentioned are rewritten, so even the big roster sheet is quick.
function fillSheet(xml, cells) {
  const byRow = new Map();
  for (const [ref, v] of cells) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    const r = +m[2];
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push({ ref, col: colIndex(m[1]), v });
  }
  const a = xml.indexOf('<sheetData>'), b = xml.indexOf('</sheetData>');
  if (a < 0 || b < 0) throw new Error('Unexpected sheet layout');
  const head = xml.slice(0, a + 11), tail = xml.slice(b);
  const missing = new Set(byRow.keys());
  const body = xml.slice(a + 11, b).replace(/<row r="(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (whole, rn, rattrs, _end, inner) => {
    const r = +rn;
    if (!byRow.has(r)) return whole;
    missing.delete(r);
    const list = byRow.get(r).sort((x, y) => x.col - y.col);
    let content = inner || '';
    for (const c of list) {
      const re = new RegExp(`<c r="${c.ref}"((?:\\s[^>]*?)?)(?:/>|>[\\s\\S]*?</c>)`);
      if (re.test(content)) content = content.replace(re, (_w, attrs) => cellXml(c.ref, attrs, c.v));
      else {
        // the template has no such cell: put a new one in column order
        const cellRe = /<c r="([A-Z]+)\d+"/g;
        let at = content.length, mm;
        while ((mm = cellRe.exec(content))) if (colIndex(mm[1]) > c.col) { at = mm.index; break; }
        content = content.slice(0, at) + cellXml(c.ref, '', c.v) + content.slice(at);
      }
    }
    return `<row r="${rn}"${rattrs.replace(/\/$/, '')}>${content}</row>`;
  });
  if (missing.size) throw new Error('Template has no row ' + [...missing][0]);
  return head + body + tail;
}

// Style of one cell (its "s" number) -- used to build a date-formatted copy for the roster.
function styleOf(xml, ref) {
  const m = xml.match(new RegExp(`<c r="${ref}"[^>]*?\\ss="(\\d+)"`));
  return m ? +m[1] : 0;
}

// Add a copy of cell style `index` that shows dates (m/d/yyyy). Returns { xml, index } for the new style.
function withDateStyle(stylesXml, index) {
  const a = stylesXml.indexOf('<cellXfs'), b = stylesXml.indexOf('</cellXfs>');
  const block = stylesXml.slice(a, b);
  const xfs = block.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  let xf = xfs[index] || xfs[0];
  xf = xf.replace(/numFmtId="\d+"/, 'numFmtId="14"');
  if (!/applyNumberFormat=/.test(xf)) xf = xf.replace(/^<xf\b/, '<xf applyNumberFormat="1"'); else xf = xf.replace(/applyNumberFormat="\d"/, 'applyNumberFormat="1"');
  const next = xfs.length;
  const patched = block.replace(/count="\d+"/, `count="${next + 1}"`) + xf;
  return { xml: stylesXml.slice(0, a) + patched + stylesXml.slice(b), index: next };
}

const excelDate = (iso) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);

module.exports = { readZip, writeZip, fillSheet, styleOf, withDateStyle, excelDate, colIndex, colLetters, addr, esc };
