// Generates simple solid-color placeholder PWA icons (no external deps).
// Replace with real artwork before shipping; this only satisfies the
// manifest's icon requirements so the app installs cleanly (FR-051, T099).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const BG = [0x2f, 0x6f, 0xed]; // #2f6fed
const FG = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.32;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    let offset = y * (size * 4 + 1);
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < size; x++) {
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
      const color = inCircle ? FG : BG;
      raw[offset + x * 4] = color[0];
      raw[offset + x * 4 + 1] = color[1];
      raw[offset + x * 4 + 2] = color[2];
      raw[offset + x * 4 + 3] = 255;
    }
  }

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(outDir, `icon-${size}x${size}.png`), makePng(size));
  console.log(`wrote icon-${size}x${size}.png`);
}
