/**
 * Generate the PWA / apple-touch PNG icons (no image deps — hand-rolled PNG
 * encoder). Draws a simple barcode motif on the app's slate background.
 *
 * Run: node scripts/make-icons.mjs
 */
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [15, 23, 42, 255]; // slate-900
const FG = [52, 211, 153, 255]; // emerald-400

// Barcode bar ranges as fractions of the inner (padded) width.
const BARS = [
  [0.0, 0.08], [0.12, 0.17], [0.23, 0.35], [0.41, 0.45],
  [0.5, 0.62], [0.68, 0.73], [0.79, 0.87], [0.93, 1.0],
];

function makeRGBA(size) {
  const pad = Math.round(size * 0.2);
  const inner = size - pad * 2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = BG;
      if (y >= pad && y <= size - pad) {
        const f = (x - pad) / inner;
        if (f >= 0 && f <= 1 && BARS.some(([a, b]) => f >= a && f <= b)) color = FG;
      }
      const i = (y * size + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
  return data;
}

// --- minimal PNG encoder ---------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  // Add filter byte (0) at the start of each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(join(outDir, `icon-${size}.png`), encodePNG(size, makeRGBA(size)));
}
// iOS apple-touch-icon (180x180, no transparency needed).
writeFileSync(join(outDir, 'apple-touch-icon.png'), encodePNG(180, makeRGBA(180)));

console.log('Icons written to', outDir);
