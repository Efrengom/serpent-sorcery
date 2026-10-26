// Writes src/ui/fonts/silkscreen-bold-w.ttf: a one-glyph TrueType font holding a W (and w) drawn
// for Silkscreen Bold, whose own W is nearly solid and reads as a heart. styles.css layers it over
// Google's Silkscreen Bold for just those two letters (unicode-range), so everything else is as it was.
//
//   node scripts/make-bold-w.mjs
//
// The glyph is drawn on Silkscreen's grid: 8 font pixels to the em, capitals 5 tall, a pixel's gap
// before each letter. Its metrics match Silkscreen Bold's as measured in the browser (ascent 82%,
// descent 20%), so lines keep their height.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.BOLD_W_OUT ?? path.join(ROOT, 'src/ui/fonts/silkscreen-bold-w.ttf');

/** The W, top row first: X is ink. Wider than M by a pixel, like most fonts' W. */
const ROWS = (process.env.BOLD_W_ROWS ?? 'XX...XX,XX...XX,XX.X.XX,XXXXXXX,.XX.XX.').split(',');

const PX = 100; // font units per font pixel
const UPM = 8 * PX;
const ASCENT = 820;
const DESCENT = 200;
const LSB = PX;
const WIDTH = Math.max(...ROWS.map((r) => r.length));
const ADVANCE = LSB + (WIDTH + 1) * PX;

// ---------------------------------------------------------------- the outline

/** Each row's runs of ink as rectangles, wound clockwise (TrueType's outer direction, y up). */
const contours = [];
ROWS.forEach((row, r) => {
  const top = (ROWS.length - r) * PX;
  const bottom = top - PX;
  for (let x = 0; x < row.length; ) {
    if (row[x] !== 'X') {
      x++;
      continue;
    }
    let end = x;
    while (row[end] === 'X') end++;
    const x0 = LSB + x * PX;
    const x1 = LSB + end * PX;
    contours.push([
      [x0, bottom],
      [x0, top],
      [x1, top],
      [x1, bottom],
    ]);
    x = end;
  }
});
const points = contours.flat();
const xMin = Math.min(...points.map((p) => p[0]));
const xMax = Math.max(...points.map((p) => p[0]));
const yMin = Math.min(...points.map((p) => p[1]));
const yMax = Math.max(...points.map((p) => p[1]));

// ---------------------------------------------------------------- binary helpers

class Out {
  bytes = [];
  u8(v) {
    this.bytes.push(v & 255);
    return this;
  }
  u16(v) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v) {
    return this.u16(v < 0 ? v + 65536 : v);
  }
  u32(v) {
    return this.u16(Math.floor(v / 65536) & 65535).u16(v & 65535);
  }
  tag(s) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  buf() {
    return Buffer.from(this.bytes);
  }
}

function checksum(buf) {
  const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

// ---------------------------------------------------------------- tables

const glyph = new Out().i16(contours.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
let end = -1;
for (const c of contours) glyph.u16((end += c.length));
glyph.u16(0); // no instructions
for (let i = 0; i < points.length; i++) glyph.u8(1); // on-curve, coordinates as 16-bit deltas
points.forEach(([x], i) => glyph.i16(x - (i > 0 ? points[i - 1][0] : 0)));
points.forEach(([, y], i) => glyph.i16(y - (i > 0 ? points[i - 1][1] : 0)));
while (glyph.bytes.length % 4) glyph.u8(0);
const glyf = glyph.buf();

// Glyph 0 (.notdef) is empty; glyph 1 is the W. Short offsets, in halves.
const loca = new Out().u16(0).u16(0).u16(glyf.length / 2).buf();

const head = new Out()
  .u32(0x00010000)
  .u32(0x00010000)
  .u32(0) // checkSumAdjustment, set below
  .u32(0x5f0f3cf5)
  .u16(0x000b)
  .u16(UPM)
  .u32(0)
  .u32(0)
  .u32(0)
  .u32(0)
  .i16(xMin)
  .i16(yMin)
  .i16(xMax)
  .i16(yMax)
  .u16(1) // bold
  .u16(8)
  .i16(2)
  .i16(0)
  .i16(0)
  .buf();

const hhea = new Out()
  .u32(0x00010000)
  .i16(ASCENT)
  .i16(-DESCENT)
  .i16(0)
  .u16(ADVANCE)
  .i16(0)
  .i16(0)
  .i16(xMax)
  .i16(1)
  .i16(0)
  .i16(0)
  .i16(0)
  .i16(0)
  .i16(0)
  .i16(0)
  .i16(0)
  .u16(2)
  .buf();

const maxp = new Out().u32(0x00010000).u16(2).u16(points.length).u16(contours.length).u16(0).u16(0).u16(2);
for (let i = 0; i < 8; i++) maxp.u16(0);

const hmtx = new Out().u16(ADVANCE).i16(0).u16(ADVANCE).i16(xMin).buf();

// cmap: format 4 for Windows Unicode, W and w to glyph 1.
const codes = [0x57, 0x77];
const segs = [...codes.map((c) => ({ start: c, end: c, delta: 1 - c })), { start: 0xffff, end: 0xffff, delta: 1 }];
const segX2 = segs.length * 2;
const searchRange = 2 * 2 ** Math.floor(Math.log2(segs.length));
const sub = new Out().u16(4).u16(16 + segs.length * 8).u16(0).u16(segX2).u16(searchRange).u16(Math.floor(Math.log2(segs.length))).u16(segX2 - searchRange);
for (const s of segs) sub.u16(s.end);
sub.u16(0);
for (const s of segs) sub.u16(s.start);
for (const s of segs) sub.i16(s.delta > 32767 ? s.delta - 65536 : s.delta);
for (let i = 0; i < segs.length; i++) sub.u16(0);
const cmap = Buffer.concat([new Out().u16(0).u16(1).u16(3).u16(1).u32(12).buf(), sub.buf()]);

const os2 = new Out()
  .u16(4)
  .i16(ADVANCE)
  .u16(700)
  .u16(5)
  .u16(0)
  .i16(400)
  .i16(400)
  .i16(0)
  .i16(100)
  .i16(400)
  .i16(400)
  .i16(0)
  .i16(300)
  .i16(PX)
  .i16(300)
  .i16(0);
for (let i = 0; i < 10; i++) os2.u8(0); // panose
os2
  .u32(1)
  .u32(0)
  .u32(0)
  .u32(0)
  .tag('NONE')
  .u16(0x20) // bold
  .u16(0x57)
  .u16(0x77)
  .i16(ASCENT)
  .i16(-DESCENT)
  .i16(0)
  .u16(ASCENT)
  .u16(DESCENT)
  .u32(1)
  .u32(0)
  .i16(5 * PX)
  .i16(5 * PX)
  .u16(0)
  .u16(0x20)
  .u16(1);

const names = [
  [1, 'Silkscreen Bold W'],
  [2, 'Bold'],
  [3, 'Silkscreen Bold W'],
  [4, 'Silkscreen Bold W'],
  [6, 'SilkscreenBoldW'],
];
const strings = names.map(([, s]) => Buffer.from(s, 'utf16le').swap16());
const name = new Out().u16(0).u16(names.length).u16(6 + names.length * 12);
let at = 0;
names.forEach(([id], i) => {
  name.u16(3).u16(1).u16(0x0409).u16(id).u16(strings[i].length).u16(at);
  at += strings[i].length;
});
const nameTable = Buffer.concat([name.buf(), ...strings]);

const post = new Out().u32(0x00030000).u32(0).i16(-PX).i16(PX / 2).u32(0).u32(0).u32(0).u32(0).u32(0).buf();

// ---------------------------------------------------------------- the file

const tables = [
  ['OS/2', os2.buf()],
  ['cmap', cmap],
  ['glyf', glyf],
  ['head', head],
  ['hhea', hhea],
  ['hmtx', hmtx],
  ['loca', loca],
  ['maxp', maxp.buf()],
  ['name', nameTable],
  ['post', post],
];
const n = tables.length;
const range = 16 * 2 ** Math.floor(Math.log2(n));
const dir = new Out().u32(0x00010000).u16(n).u16(range).u16(Math.floor(Math.log2(n))).u16(n * 16 - range);
let offset = 12 + n * 16;
const body = [];
for (const [tag, data] of tables) {
  dir.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  body.push(padded);
  offset += padded.length;
}
const font = Buffer.concat([dir.buf(), ...body]);
const headAt = 12 + n * 16 + tables.slice(0, 3).reduce((s, [, d]) => s + Math.ceil(d.length / 4) * 4, 0);
font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headAt + 8);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, font);
console.log(`${path.relative(ROOT, OUT)}: ${font.length} bytes, W ${WIDTH} pixels wide`);
