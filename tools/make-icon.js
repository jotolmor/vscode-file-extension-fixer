// Generates the Marketplace icon as a 256x256 RGBA PNG using only Node built-ins.
// Shapes are evaluated with 4x4 supersampling per pixel, which gives clean
// antialiased edges without any drawing library.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SS = 4;

// ---------- signed distance helpers, all in 256-space ----------
const roundedRect = (px, py, x, y, w, h, r) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};

const circle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

const capsule = (px, py, ax, ay, bx, by, r) => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - t * vx, wy - t * vy) - r;
};

const hex = (value) => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255
];

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const BG_TOP = hex('#5B9BFF');
const BG_BOTTOM = hex('#1B3FA8');
const SHEET = hex('#FFFFFF');
const FOLD = hex('#C4D6F2');
const BAR = hex('#9FB0CD');
const BADGE = hex('#22C55E');
const WHITE = hex('#FFFFFF');

// Document geometry.
const SX = 64, SY = 40, SW = 128, SH = 160, SR = 14;
const FOLD_SIZE = 42;
const FOLD_X = SX + SW - FOLD_SIZE; // 150

/** Colour of one supersample, composited front to back. */
function sample(px, py) {
  // Background: rounded card with a diagonal gradient. Outside stays transparent.
  if (roundedRect(px, py, 0, 0, SIZE, SIZE, 56) > 0) {
    return null;
  }
  let colour = lerp(BG_TOP, BG_BOTTOM, (px + py) / (SIZE * 2));

  const over = (rgb, alpha) => {
    colour = [
      colour[0] * (1 - alpha) + rgb[0] * alpha,
      colour[1] * (1 - alpha) + rgb[1] * alpha,
      colour[2] * (1 - alpha) + rgb[2] * alpha
    ];
  };

  const inSheet = roundedRect(px, py, SX, SY, SW, SH, SR) < 0;
  // The folded corner is cut away from the sheet along a 45 degree line.
  const cut = (px - FOLD_X) - (py - SY);

  // Soft drop shadow: several offset copies at low alpha approximate a blur.
  // The cut-away corner is excluded, otherwise the shadow shows through the
  // notch and muddies the fold.
  if (cut <= 4) {
    for (let k = 1; k <= 7; k++) {
      if (roundedRect(px, py, SX - k, SY - k + 5, SW + 2 * k, SH + 2 * k, SR + k) < 0) {
        over([0, 0, 0], 0.045);
      }
    }
  }

  if (inSheet && cut <= 0) {
    const isFlap = px >= FOLD_X && py <= SY + FOLD_SIZE;
    over(isFlap ? FOLD : SHEET, 1);

    if (!isFlap) {
      const bars = [
        [86, 110, 170, 110],
        [86, 132, 170, 132],
        [86, 154, 140, 154]
      ];
      for (const [ax, ay, bx, by] of bars) {
        if (capsule(px, py, ax, ay, bx, by, 6) < 0) {
          over(BAR, 1);
        }
      }
    }
  }

  // Badge: white ring, green disc, white check mark.
  if (circle(px, py, 186, 176, 40) < 0) {
    over(WHITE, 1);
    if (circle(px, py, 186, 176, 32) < 0) {
      over(BADGE, 1);
      const stroke =
        capsule(px, py, 172, 177, 182, 187, 6) < 0 ||
        capsule(px, py, 182, 187, 201, 165, 6) < 0;
      if (stroke) {
        over(WHITE, 1);
      }
    }
  }

  return colour;
}

// ---------- render with supersampling ----------
const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const result = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (result) {
          r += result[0];
          g += result[1];
          b += result[2];
          a += 1;
        }
      }
    }
    const total = SS * SS;
    const offset = (y * SIZE + x) * 4;
    // Un-premultiply so transparent corners keep the edge colour.
    const alpha = a / total;
    pixels[offset] = Math.round((a ? r / a : 0) * 255);
    pixels[offset + 1] = Math.round((a ? g / a : 0) * 255);
    pixels[offset + 2] = Math.round((a ? b / a : 0) * 255);
    pixels[offset + 3] = Math.round(alpha * 255);
  }
}

// ---------- PNG container ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // colour type: RGBA
ihdr[10] = 0;  // deflate
ihdr[11] = 0;  // adaptive filtering
ihdr[12] = 0;  // no interlace

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const target = path.join(process.argv[2] ?? path.join(__dirname, '..'), 'images', 'icon.png');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, png);
console.log(`Escrito ${target} (${png.length} bytes, ${SIZE}x${SIZE})`);
