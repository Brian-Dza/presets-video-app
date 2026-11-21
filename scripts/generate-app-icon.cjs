const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// CRC32 table for valid PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdTrianglePlay(px, py, radius) {
  // Equilateral-ish play triangle centered slightly right
  const ax = -radius * 0.52;
  const ay = -radius * 0.68;
  const bx = -radius * 0.52;
  const by = radius * 0.68;
  const cx = radius * 0.72;
  const cy = 0;

  function edgeDist(x1, y1, x2, y2) {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const wx = px - x1;
    const wy = py - y1;
    const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
    const dx = wx - vx * t;
    const dy = wy - vy * t;
    return Math.hypot(dx, dy);
  }

  const d = Math.min(edgeDist(ax, ay, bx, by), edgeDist(bx, by, cx, cy), edgeDist(cx, cy, ax, ay));
  // Winding check (inside triangle -> negative)
  const c1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const c2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const c3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const inside = (c1 >= 0 && c2 >= 0 && c3 >= 0) || (c1 <= 0 && c2 <= 0 && c3 <= 0);
  return (inside ? -d : d) - radius * 0.1;
}

function renderIconRgba(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.35 / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const px = (u - 0.5) * 2;
      const py = (v - 0.5) * 2;

      const tileDist = sdRoundedBox(px, py, 0.88, 0.88, 0.38);
      const tileAlpha = 1 - smoothstep(-aa, aa, tileDist);
      if (tileAlpha <= 0.001) continue;

      // Gradient background: deep obsidian -> electric indigo -> cyan glow
      const diag = clamp((u * 0.65 + v * 0.35), 0, 1);
      const glow = Math.exp(-((px - 0.25) ** 2 + (py + 0.25) ** 2) * 2.4);
      let r = 13 + diag * 28 + glow * 88;
      let g = 16 + diag * 22 + glow * 54;
      let b = 30 + diag * 65 + glow * 175;

      // Subtle inner cinema frame border
      const ringDist = Math.abs(sdRoundedBox(px, py, 0.72, 0.72, 0.26)) - 0.025;
      const ringAlpha = (1 - smoothstep(-aa, aa, ringDist)) * 0.42;
      r = r * (1 - ringAlpha) + (34 + u * 90) * ringAlpha;
      g = g * (1 - ringAlpha) + (211 - u * 80) * ringAlpha;
      b = b * (1 - ringAlpha) + 238 * ringAlpha;

      // Prism accent pill behind play glyph
      const prismDist = sdRoundedBox(px + 0.04, py, 0.4, 0.4, 0.18);
      const prismAlpha = (1 - smoothstep(-aa, aa, prismDist)) * 0.92;
      if (prismAlpha > 0) {
        const prR = 124 * (1 - u * 0.45) + 34 * (u * 0.45);
        const prG = 92 * (1 - u * 0.45) + 211 * (u * 0.45);
        const prB = 255 * (1 - u * 0.2) + 238 * (u * 0.2);
        r = r * (1 - prismAlpha) + prR * prismAlpha;
        g = g * (1 - prismAlpha) + prG * prismAlpha;
        b = b * (1 - prismAlpha) + prB * prismAlpha;
      }

      // Crisp white play glyph
      const playDist = sdTrianglePlay(px - 0.01, py, 0.24);
      const playAlpha = 1 - smoothstep(-aa * 1.1, aa * 1.1, playDist);
      if (playAlpha > 0) {
        r = r * (1 - playAlpha) + 248 * playAlpha;
        g = g * (1 - playAlpha) + 250 * playAlpha;
        b = b * (1 - playAlpha) + 255 * playAlpha;
      }

      // Cyan spark dot in top-right corner
      const dotDist = Math.hypot(px - 0.44, py + 0.44) - 0.085;
      const dotAlpha = 1 - smoothstep(-aa, aa, dotDist);
      if (dotAlpha > 0) {
        r = r * (1 - dotAlpha) + 34 * dotAlpha;
        g = g * (1 - dotAlpha) + 211 * dotAlpha;
        b = b * (1 - dotAlpha) + 238 * dotAlpha;
      }

      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(clamp(r, 0, 255));
      buf[idx + 1] = Math.round(clamp(g, 0, 255));
      buf[idx + 2] = Math.round(clamp(b, 0, 255));
      buf[idx + 3] = Math.round(clamp(tileAlpha * 255, 0, 255));
    }
  }
  return buf;
}

function buildIco(sizes) {
  const images = sizes.map((size) => ({
    size,
    png: encodePng(size, renderIconRgba(size)),
  }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(images.length, 4);

  const dirEntries = Buffer.alloc(16 * images.length);
  let offset = 6 + 16 * images.length;

  images.forEach((img, index) => {
    const base = index * 16;
    dirEntries[base] = img.size >= 256 ? 0 : img.size;
    dirEntries[base + 1] = img.size >= 256 ? 0 : img.size;
    dirEntries[base + 2] = 0; // palette
    dirEntries[base + 3] = 0; // reserved
    dirEntries.writeUInt16LE(1, base + 4); // color planes
    dirEntries.writeUInt16LE(32, base + 6); // bpp
    dirEntries.writeUInt32LE(img.png.length, base + 8);
    dirEntries.writeUInt32LE(offset, base + 12);
    offset += img.png.length;
  });

  return {
    ico: Buffer.concat([header, dirEntries, ...images.map((i) => i.png)]),
    png256: images.find((i) => i.size === 256)?.png,
  };
}

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const publicDir = path.join(root, 'public');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

// electron-builder requires at least 256x256 in Windows .ico
const { ico, png256 } = buildIco([256, 128, 64, 48, 32, 16]);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
if (png256) {
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);
}
console.log('Generated build/icon.ico (' + ico.length + ' bytes) and build/icon.png');
