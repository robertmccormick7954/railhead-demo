/* ==========================================================================
   Railhead — QR encoder (byte mode, versions 1-20, EC levels L/M/Q/H)
   --------------------------------------------------------------------------
   Written out rather than pulled from a library because the ticket has to work
   offline, in a print stylesheet, inside a PDF we also generate ourselves, with
   no third-party script on the page. A ticket that needs a CDN is not a ticket.

   Output is a boolean matrix. Rendering to SVG, canvas or PDF vector paths is
   the caller's business — see ticket.js and pdf.js.

   Verified two ways in tools/qa_qr.mjs: the matrix is compared module-for-
   module against a reference implementation, and the rendered image is decoded
   back to the original payload.
   ========================================================================== */

/* --- Galois field GF(256), primitive polynomial 0x11D --------------------- */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    // Coefficients are stored highest-degree first, so multiplying by
    // (x + a^i) raises poly[j] into next[j] and scales it into next[j+1].
    // Getting these two the wrong way round yields a reversed generator,
    // which still looks plausible and corrupts every EC codeword.
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

/* --- Block structure -----------------------------------------------------
   [ecCodewordsPerBlock, blocksInGroup1, dataCodewordsInGroup1,
    blocksInGroup2, dataCodewordsInGroup2] indexed by version then EC level. */
const EC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };

const BLOCKS = {
  1:  [[7, 1, 19, 0, 0], [10, 1, 16, 0, 0], [13, 1, 13, 0, 0], [17, 1, 9, 0, 0]],
  2:  [[10, 1, 34, 0, 0], [16, 1, 28, 0, 0], [22, 1, 22, 0, 0], [28, 1, 16, 0, 0]],
  3:  [[15, 1, 55, 0, 0], [26, 1, 44, 0, 0], [18, 2, 17, 0, 0], [22, 2, 13, 0, 0]],
  4:  [[20, 1, 80, 0, 0], [18, 2, 32, 0, 0], [26, 2, 24, 0, 0], [16, 4, 9, 0, 0]],
  5:  [[26, 1, 108, 0, 0], [24, 2, 43, 0, 0], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]],
  6:  [[18, 2, 68, 0, 0], [16, 4, 27, 0, 0], [24, 4, 19, 0, 0], [28, 4, 15, 0, 0]],
  7:  [[20, 2, 78, 0, 0], [18, 4, 31, 0, 0], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]],
  8:  [[24, 2, 97, 0, 0], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]],
  9:  [[30, 2, 116, 0, 0], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]],
  10: [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]],
  11: [[20, 4, 81, 0, 0], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]],
  12: [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]],
  13: [[26, 4, 107, 0, 0], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]],
  14: [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]],
  15: [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13]],
  16: [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]],
  17: [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47], [28, 1, 22, 15, 23], [28, 2, 14, 17, 15]],
  18: [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44], [28, 17, 22, 1, 23], [28, 2, 14, 19, 15]],
  19: [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45], [26, 17, 21, 4, 22], [26, 9, 13, 16, 14]],
  20: [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42], [30, 15, 24, 5, 25], [28, 15, 15, 10, 16]],
};

/** Centres of the alignment patterns, per version. */
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66],
  15: [6, 26, 48, 70], 16: [6, 26, 50, 74], 17: [6, 30, 54, 78],
  18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
};

function dataCapacity(version, ecKey) {
  const [, g1, d1, g2, d2] = BLOCKS[version][EC_LEVELS[ecKey]];
  return g1 * d1 + g2 * d2;
}

/* --- Bit buffer ----------------------------------------------------------- */
class Bits {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

/* --- Encoding ------------------------------------------------------------- */

function toUtf8(str) {
  return new TextEncoder().encode(str);
}

function chooseVersion(byteLength, ecKey, minVersion = 1) {
  for (let v = minVersion; v <= 20; v++) {
    const countBits = v < 10 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= dataCapacity(v, ecKey)) return v;
  }
  throw new Error(`payload of ${byteLength} bytes does not fit a version 20 QR at level ${ecKey}`);
}

function buildCodewords(bytes, version, ecKey) {
  const capacity = dataCapacity(version, ecKey);
  const countBits = version < 10 ? 8 : 16;

  const bits = new Bits();
  bits.put(0b0100, 4);              // byte mode
  bits.put(bytes.length, countBits);
  for (const b of bytes) bits.put(b, 8);

  const capacityBits = capacity * 8;
  bits.put(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8) bits.bits.push(0);

  const data = Array.from(bits.toBytes());
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < capacity; i++) data.push(PAD[i % 2]);

  // split into blocks, then interleave data and EC as the spec requires
  const [ecLen, g1, d1, g2, d2] = BLOCKS[version][EC_LEVELS[ecKey]];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < g1; i++) { blocks.push(data.slice(at, at + d1)); at += d1; }
  for (let i = 0; i < g2; i++) { blocks.push(data.slice(at, at + d2)); at += d2; }

  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));

  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of ecBlocks) out.push(b[i]);
  }
  return out;
}

/* --- Matrix --------------------------------------------------------------- */

function newMatrix(size) {
  return { size, m: Array.from({ length: size }, () => new Int8Array(size).fill(-1)) };
}

function placeFinder(mx, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= mx.size || cc < 0 || cc >= mx.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      mx.m[rr][cc] = inRing || inCore ? 1 : 0;
    }
  }
}

function placeAlignment(mx, version) {
  const centres = ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      // skip the three corners occupied by finder patterns
      if ((r === 6 && c === 6) || (r === 6 && c === mx.size - 7) || (r === mx.size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          mx.m[r + dr][c + dc] = ring === 1 ? 0 : 1;
        }
      }
    }
  }
}

function placeTiming(mx) {
  for (let i = 8; i < mx.size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (mx.m[6][i] === -1) mx.m[6][i] = v;
    if (mx.m[i][6] === -1) mx.m[i][6] = v;
  }
}

function reserveFormat(mx, version) {
  for (let i = 0; i < 9; i++) {
    if (mx.m[8][i] === -1) mx.m[8][i] = 0;
    if (mx.m[i][8] === -1) mx.m[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (mx.m[8][mx.size - 1 - i] === -1) mx.m[8][mx.size - 1 - i] = 0;
    if (mx.m[mx.size - 1 - i][8] === -1) mx.m[mx.size - 1 - i][8] = 0;
  }
  mx.m[mx.size - 8][8] = 1; // the always-dark module
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mx.m[mx.size - 11 + j][i] = 0;
        mx.m[i][mx.size - 11 + j] = 0;
      }
    }
  }
}

function placeData(mx, codewords) {
  let bitIndex = 0;
  let upward = true;
  for (let right = mx.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped entirely
    for (let step = 0; step < mx.size; step++) {
      const row = upward ? mx.size - 1 - step : step;
      for (let k = 0; k < 2; k++) {
        const col = right - k;
        if (mx.m[row][col] !== -1) continue;
        const byte = codewords[bitIndex >> 3];
        const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
        mx.m[row][col] = bit;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function isFunction(version, size, r, c) {
  if (r === 6 || c === 6) return true;
  if (r < 9 && c < 9) return true;
  if (r < 9 && c >= size - 8) return true;
  if (r >= size - 8 && c < 9) return true;
  if (version >= 7 && ((r < 6 && c >= size - 11) || (c < 6 && r >= size - 11))) return true;
  const centres = ALIGN[version];
  for (const ar of centres) {
    for (const ac of centres) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
      if (Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2) return true;
    }
  }
  return false;
}

function penalty(grid) {
  const n = grid.length;
  let score = 0;

  // rule 1: runs of five or more
  for (let i = 0; i < n; i++) {
    for (const line of [grid[i], grid.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        if (line[j] === line[j - 1]) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // rule 2: 2x2 blocks of one colour
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }

  // rule 3: the finder-like 1:1:3:1:1 pattern with four light modules either side
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const scan = (line) => {
    for (let i = 0; i + 11 <= n; i++) {
      const seg = line.slice(i, i + 11);
      if (P1.every((v, k) => v === seg[k]) || P2.every((v, k) => v === seg[k])) score += 40;
    }
  };
  for (let i = 0; i < n; i++) { scan(grid[i]); scan(grid.map((row) => row[i])); }

  // rule 4: deviation from an even split of dark and light
  const dark = grid.flat().reduce((a, b) => a + b, 0);
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

function formatBits(ecKey, mask) {
  const ecBits = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }[ecKey];
  const data = (ecBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= 0b1111100100101 << (i - 12);
  return (version << 12) | rem;
}

function applyFormat(grid, version, ecKey, mask) {
  const n = grid.length;
  const bits = formatBits(ecKey, mask);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    // Copy 1, around the top-left finder: bits 0-5 run down column 8, bits
    // 6-8 turn the corner, bits 9-14 run right to left along row 8.
    if (i < 6) grid[i][8] = bit;
    else if (i === 6) grid[7][8] = bit;
    else if (i === 7) grid[8][8] = bit;
    else if (i === 8) grid[8][7] = bit;
    else grid[8][14 - i] = bit;
    // Copy 2: bits 0-7 along row 8 from the right edge inward, bits 8-14 up
    // column 8 from the bottom edge.
    if (i < 8) grid[8][n - 1 - i] = bit;
    else grid[n - 15 + i][8] = bit;
  }
  grid[n - 8][8] = 1;

  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >> i) & 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      grid[n - 11 + c][r] = bit;
      grid[r][n - 11 + c] = bit;
    }
  }
}

/* --- Public API ----------------------------------------------------------- */

/**
 * Encode a string as a QR matrix.
 * @param {string} text
 * @param {{ec?: 'L'|'M'|'Q'|'H', minVersion?: number}} [opts]
 * @returns {{size: number, modules: boolean[][], version: number, ec: string, mask: number}}
 */
export function encode(text, opts = {}) {
  const ecKey = opts.ec || 'M';
  if (!(ecKey in EC_LEVELS)) throw new Error(`unknown EC level ${ecKey}`);
  const bytes = toUtf8(text);
  const version = chooseVersion(bytes.length, ecKey, opts.minVersion || 1);
  const codewords = buildCodewords(bytes, version, ecKey);

  const size = version * 4 + 17;
  const mx = newMatrix(size);
  placeFinder(mx, 0, 0);
  placeFinder(mx, 0, size - 7);
  placeFinder(mx, size - 7, 0);
  placeAlignment(mx, version);
  placeTiming(mx);
  reserveFormat(mx, version);
  // reserveFormat wrote zeros into the reserved cells; clear them so the data
  // walk skips those cells but does not treat them as data.
  placeData(mx, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const grid = mx.m.map((row, r) => Array.from(row, (v, c) => (
      isFunction(version, size, r, c) ? v : v ^ (MASKS[mask](r, c) ? 1 : 0)
    )));
    applyFormat(grid, version, ecKey, mask);
    const score = penalty(grid);
    if (!best || score < best.score) best = { score, grid, mask };
  }

  return {
    size,
    version,
    ec: ecKey,
    mask: best.mask,
    modules: best.grid.map((row) => row.map((v) => v === 1)),
  };
}

/** Render a matrix as a standalone SVG string, quiet zone included. */
export function toSvg(qr, { scale = 4, quiet = 4, dark = '#000000', light = null } = {}) {
  const dim = (qr.size + quiet * 2) * scale;
  let path = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }
  const bg = light ? `<rect width="${dim}" height="${dim}" fill="${light}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img">${bg}<path fill="${dark}" d="${path}"/></svg>`;
}

/** Rectangles in module units, for callers that draw their own output (PDF). */
export function toRects(qr) {
  const rects = [];
  for (let r = 0; r < qr.size; r++) {
    let start = -1;
    for (let c = 0; c <= qr.size; c++) {
      const on = c < qr.size && qr.modules[r][c];
      if (on && start === -1) start = c;
      else if (!on && start !== -1) { rects.push([start, r, c - start, 1]); start = -1; }
    }
  }
  return rects;
}
