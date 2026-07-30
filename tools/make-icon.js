// Generates the Marketplace icon as a 256x256 RGBA PNG using only Node
// built-ins. Shapes are signed distance fields evaluated with 4x4
// supersampling per pixel, which gives clean antialiased edges without any
// drawing library.
//
// The idea: the dot is the product. A bright comet flies in from the corner
// and lands on the file, which is what the extension does.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = Number(process.argv[3]) || 256;
const SS = 4;

// Shapes are authored in a fixed 256-unit space; SIZE only changes the
// output resolution, so previews at 32 or 48 px show the same drawing.
const DESIGN = 256;
const SCALE = DESIGN / SIZE;

// ---------- geometry helpers, all in 256-space ----------
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

/** Capsule whose radius grows from r0 at A to r1 at B: a comet trail. */
const taperedCapsule = (px, py, ax, ay, bx, by, r0, r1) => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - t * vx, wy - t * vy) - (r0 + (r1 - r0) * t);
};

/** Rotates a sample point around a pivot, so shapes can be drawn tilted. */
function rotate(px, py, cx, cy, degrees) {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

const hex = (value) => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255
];

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const BG_A = hex('#4C1D95');
const BG_B = hex('#7C3AED');
const BG_C = hex('#2563EB');
const SHEET = hex('#FFFFFF');
const SHEET_EDGE = hex('#DDE4F3');
const BAR = hex('#A9B6D4');
const COMET = hex('#FFC53D');
const COMET_HOT = hex('#FFF3CC');

// Document, drawn tilted so the icon has movement.
const TILT = -11;
const SX = 58, SY = 44, SW = 118, SH = 150, SR = 16;
const PIVOT_X = SX + SW / 2;
const PIVOT_Y = SY + SH / 2;
const FOLD = 40;
const FOLD_X = SX + SW - FOLD;

// The comet lands at the end of the document's first line, which is exactly
// where a file name gains its extension. The landing point is expressed in
// document space and mapped to screen space, so it follows the tilt.
const LANDING_DOC_X = 166;
const LANDING_DOC_Y = 108;
const [HEAD_X, HEAD_Y] = rotate(LANDING_DOC_X, LANDING_DOC_Y, PIVOT_X, PIVOT_Y, TILT);

// Long tail from the lower right corner. A straight line reads as a pushpin,
// so the path is a quadratic curve, sampled as a chain of discs whose radius
// and opacity both fade towards the tail.
const TAIL_X = 254, TAIL_Y = 250;
const CTRL_X = 236, CTRL_Y = 170;

/** [x, y, radius, alpha] along the curve, tail first. */
const TRAIL = (() => {
  const steps = 40;
  const discs = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * TAIL_X + 2 * u * t * CTRL_X + t * t * HEAD_X;
    const y = u * u * TAIL_Y + 2 * u * t * CTRL_Y + t * t * HEAD_Y;
    discs.push([x, y, 0.8 + 8.7 * t * t, 0.16 + 0.78 * t]);
  }
  return discs;
})();

/** Specks flung off the curve, offset sideways so they read as separate. */
const SPARKS = [
  [0.34, 14, 4.2],
  [0.55, -11, 3.0],
  [0.74, 9, 2.2]
].map(([t, offset, r]) => {
  const u = 1 - t;
  const x = u * u * TAIL_X + 2 * u * t * CTRL_X + t * t * HEAD_X;
  const y = u * u * TAIL_Y + 2 * u * t * CTRL_Y + t * t * HEAD_Y;
  const dx = HEAD_X - TAIL_X;
  const dy = HEAD_Y - TAIL_Y;
  const length = Math.hypot(dx, dy);
  return [x + (-dy / length) * offset, y + (dx / length) * offset, r];
});

function sample(px, py) {
  if (roundedRect(px, py, 0, 0, DESIGN, DESIGN, 58) > 0) {
    return null;
  }

  // Three-stop diagonal gradient, so the card has depth instead of a flat wash.
  const d = (px + py) / (DESIGN * 2);
  let colour = d < 0.5 ? lerp(BG_A, BG_B, d * 2) : lerp(BG_B, BG_C, (d - 0.5) * 2);

  const over = (rgb, alpha) => {
    colour = [
      colour[0] * (1 - alpha) + rgb[0] * alpha,
      colour[1] * (1 - alpha) + rgb[1] * alpha,
      colour[2] * (1 - alpha) + rgb[2] * alpha
    ];
  };

  const [rx, ry] = rotate(px, py, PIVOT_X, PIVOT_Y, -TILT);
  const inSheet = roundedRect(rx, ry, SX, SY, SW, SH, SR) < 0;
  const cut = (rx - FOLD_X) - (ry - SY);

  // Soft drop shadow, kept out of the cut corner so the fold stays clean.
  if (cut <= 4) {
    for (let k = 1; k <= 8; k++) {
      if (roundedRect(rx, ry, SX - k, SY - k + 6, SW + 2 * k, SH + 2 * k, SR + k) < 0) {
        over([0, 0, 0], 0.04);
      }
    }
  }

  if (inSheet && cut <= 0) {
    const isFlap = rx >= FOLD_X && ry <= SY + FOLD;
    over(isFlap ? SHEET_EDGE : SHEET, 1);

    if (!isFlap) {
      const lines = [
        [80, 108, 152, 108, 7],
        [80, 136, 156, 136, 6],
        [80, 158, 126, 158, 6]
      ];
      for (const [ax, ay, bx, by, r] of lines) {
        if (capsule(rx, ry, ax, ay, bx, by, r) < 0) {
          over(BAR, 1);
        }
      }
    }
  }

  // Comet trail, drawn over the sheet so it reads as motion across it. The
  // strongest disc covering the point wins, which keeps the fade smooth.
  let trailAlpha = 0;
  for (const [cx, cy, cr, ca] of TRAIL) {
    if (ca > trailAlpha && circle(px, py, cx, cy, cr) < 0) {
      trailAlpha = ca;
    }
  }
  if (trailAlpha > 0) {
    over(COMET, trailAlpha);
  }
  for (const [sx, sy, sr] of SPARKS) {
    if (circle(px, py, sx, sy, sr) < 0) {
      over(COMET, 0.9);
    }
  }

  // The dot itself: the payload of the whole extension.
  if (circle(px, py, HEAD_X, HEAD_Y, 21) < 0) {
    over(COMET, 1);
    if (circle(px, py, HEAD_X - 5, HEAD_Y - 6, 8) < 0) {
      over(COMET_HOT, 0.75);
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
        const result = sample((x + (sx + 0.5) / SS) * SCALE, (y + (sy + 0.5) / SS) * SCALE);
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
    pixels[offset] = Math.round((a ? r / a : 0) * 255);
    pixels[offset + 1] = Math.round((a ? g / a : 0) * 255);
    pixels[offset + 2] = Math.round((a ? b / a : 0) * 255);
    pixels[offset + 3] = Math.round((a / total) * 255);
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

const target = process.argv[4] ?? path.join(process.argv[2] ?? path.join(__dirname, '..'), 'images', 'icon.png');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, png);
console.log(`Escrito ${target} (${png.length} bytes, ${SIZE}x${SIZE})`);
