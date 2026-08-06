/* ==========================================================================
   Railhead — minimal PDF writer
   --------------------------------------------------------------------------
   Enough of PDF 1.4 to produce a travel document: pages, the base-14 fonts,
   text with real metrics, lines, rectangles and vector paths. No dependency,
   no build step, no network — the ticket must render on a phone with no signal.

   Deliberately NOT supported: embedded fonts, images, transparency. The QR code
   is drawn as vector rectangles instead of a bitmap, which keeps it sharp at any
   print resolution and avoids an image codec entirely.
   ========================================================================== */

/* Advance widths per 1000 units for the base-14 fonts, from the Adobe AFM
   metrics, indexed by character code 32 to 126. Without real metrics, centring
   and right-alignment are guesses and columns drift.

   Written out one code point per entry rather than packed into a string: the
   packed form is unreadable, and a single mis-parsed entry silently makes every
   measurement wrong in a way that only shows up as truncated text on a ticket.
   tools/qa_pdf.mjs checks these against known totals. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32-47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,                               // 48-57  0-9
  278, 278, 584, 584, 584, 556, 1015,                                             // 58-64
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,                // 65-77  A-M
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,                // 78-90  N-Z
  278, 278, 278, 469, 556, 333,                                                   // 91-96
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,                // 97-109 a-m
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,                // 110-122 n-z
  334, 260, 334, 584,                                                             // 123-126
];

const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889,
  611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

const WIDTHS = {
  Helvetica: { table: HELVETICA, fallback: 556 },
  'Helvetica-Bold': { table: HELVETICA_BOLD, fallback: 611 },
};

function charWidth(font, ch) {
  const spec = WIDTHS[font];
  if (!spec) return 600; // Courier is monospaced
  const code = ch.charCodeAt(0);
  const w = code >= 32 && code <= 126 ? spec.table[code - 32] : undefined;
  return Number.isFinite(w) ? w : spec.fallback;
}

const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  mono: 'Courier',
  monoBold: 'Courier-Bold',
};

export const PAGE = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/* WinAnsi has no glyph for these, and a PDF viewer will render a blank or a
   wrong character. Substituting is better than shipping a hole in a ticket. */
const TRANSLIT = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '--', '…': '...', ' ': ' ',
  ' ': ' ', '→': '->', '·': '-', '•': '-',
};

function toWinAnsi(text) {
  let out = '';
  for (const ch of String(text)) {
    if (TRANSLIT[ch]) { out += TRANSLIT[ch]; continue; }
    const code = ch.codePointAt(0);
    if (code < 0x100) out += ch;
    else {
      const stripped = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += stripped.codePointAt(0) < 0x100 ? stripped : '?';
    }
  }
  return out;
}

function escapeText(s) {
  return s.replace(/[\\()]/g, (c) => '\\' + c);
}

export class Pdf {
  constructor({ size = 'a4', margin = 40, title = '', author = '', subject = '' } = {}) {
    const [w, h] = PAGE[size] || PAGE.a4;
    this.width = w;
    this.height = h;
    this.margin = margin;
    this.meta = { title, author, subject };
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.height - this.margin;
    return this;
  }

  /* -- primitives -------------------------------------------------------- */

  /** @param {number[]} rgb 0-255 */
  fill(rgb) {
    this.ops.push(`${(rgb[0] / 255).toFixed(4)} ${(rgb[1] / 255).toFixed(4)} ${(rgb[2] / 255).toFixed(4)} rg`);
    return this;
  }

  stroke(rgb) {
    this.ops.push(`${(rgb[0] / 255).toFixed(4)} ${(rgb[1] / 255).toFixed(4)} ${(rgb[2] / 255).toFixed(4)} RG`);
    return this;
  }

  lineWidth(w) { this.ops.push(`${w} w`); return this; }

  rect(x, y, w, h, mode = 'f') {
    this.ops.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re ${mode}`);
    return this;
  }

  line(x1, y1, x2, y2) {
    this.ops.push(`${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`);
    return this;
  }

  /** Dashed rule, used for the tear line between ticket and receipt. */
  dashedLine(x1, y1, x2, y2, dash = 3) {
    this.ops.push(`[${dash} ${dash}] 0 d`);
    this.line(x1, y1, x2, y2);
    this.ops.push('[] 0 d');
    return this;
  }

  measure(text, { font = 'regular', size = 10 } = {}) {
    const name = FONTS[font] || FONTS.regular;
    let total = 0;
    for (const ch of toWinAnsi(text)) total += charWidth(name, ch);
    return (total / 1000) * size;
  }

  text(text, x, y, { font = 'regular', size = 10, color = [0, 0, 0], align = 'left', maxWidth = null, letterSpacing = 0 } = {}) {
    let str = toWinAnsi(text);
    if (maxWidth) str = this.truncate(str, maxWidth, { font, size });
    const w = this.measure(str, { font, size }) + letterSpacing * Math.max(0, str.length - 1);
    let dx = x;
    if (align === 'center') dx = x - w / 2;
    else if (align === 'right') dx = x - w;

    this.fill(color);
    this.ops.push('BT');
    this.ops.push(`/${fontKey(font)} ${size} Tf`);
    if (letterSpacing) this.ops.push(`${f(letterSpacing)} Tc`);
    this.ops.push(`${f(dx)} ${f(y)} Td (${escapeText(str)}) Tj`);
    if (letterSpacing) this.ops.push('0 Tc');
    this.ops.push('ET');
    return w;
  }

  truncate(text, maxWidth, opts) {
    if (this.measure(text, opts) <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && this.measure(s + '...', opts) > maxWidth) s = s.slice(0, -1);
    return s + '...';
  }

  /** Word-wrapped paragraph. Returns the y position after the last line. */
  paragraph(text, x, y, width, { font = 'regular', size = 9, leading = 1.35, color = [0, 0, 0] } = {}) {
    const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
    let line = '';
    let cursor = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (this.measure(test, { font, size }) > width && line) {
        this.text(line, x, cursor, { font, size, color });
        cursor -= size * leading;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      this.text(line, x, cursor, { font, size, color });
      cursor -= size * leading;
    }
    return cursor;
  }

  /** Draw a QR matrix as vector rectangles. `size` is the side in points. */
  qr(matrix, x, y, size, { color = [0, 0, 0], quiet = 4 } = {}) {
    const modules = matrix.size + quiet * 2;
    const unit = size / modules;
    this.fill(color);
    // Runs of adjacent dark modules become one rectangle, which keeps the
    // content stream small and the printed edges clean.
    for (let r = 0; r < matrix.size; r++) {
      let start = -1;
      for (let c = 0; c <= matrix.size; c++) {
        const on = c < matrix.size && matrix.modules[r][c];
        if (on && start === -1) start = c;
        else if (!on && start !== -1) {
          const px = x + (start + quiet) * unit;
          const py = y + size - (r + quiet + 1) * unit;
          this.ops.push(`${f(px)} ${f(py)} ${f((c - start) * unit)} ${f(unit)} re f`);
          start = -1;
        }
      }
    }
    return this;
  }

  /* -- output ------------------------------------------------------------ */

  build() {
    const objects = [];
    const push = (body) => { objects.push(body); return objects.length; };

    const fontIds = {};
    for (const [key, name] of Object.entries(FONTS)) {
      fontIds[key] = push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
    }

    const pagesId = objects.length + 1 + this.pages.length * 2 + 1;
    const pageIds = [];
    for (const ops of this.pages) {
      const content = ops.join('\n');
      const contentId = push(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
      const resources = '/Font << '
        + Object.entries(fontIds).map(([k, id]) => `/${fontKey(k)} ${id} 0 R`).join(' ')
        + ' >>';
      pageIds.push(push(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] `
        + `/Resources << ${resources} >> /Contents ${contentId} 0 R >>`));
    }

    const actualPagesId = push(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const catalogId = push(`<< /Type /Catalog /Pages ${actualPagesId} 0 R >>`);
    const infoId = push(
      `<< /Title (${escapeText(toWinAnsi(this.meta.title))}) `
      + `/Author (${escapeText(toWinAnsi(this.meta.author))}) `
      + `/Subject (${escapeText(toWinAnsi(this.meta.subject))}) `
      + `/Producer (Railhead) /Creator (Railhead) >>`);

    // Page objects were written before the /Pages object existed, so patch the
    // parent reference now that its real id is known.
    for (const id of pageIds) {
      objects[id - 1] = objects[id - 1].replace(`/Parent ${pagesId} 0 R`, `/Parent ${actualPagesId} 0 R`);
    }

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [0];
    objects.forEach((body, i) => {
      offsets.push(byteLength(out));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = byteLength(out);
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`
        + `startxref\n${xref}\n%%EOF`;
    return out;
  }

  blob() {
    const raw = this.build();
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  download(filename) {
    const url = URL.createObjectURL(this.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function fontKey(key) {
  return { regular: 'F1', bold: 'F2', mono: 'F3', monoBold: 'F4' }[key] || 'F1';
}

function f(n) {
  return Number(n).toFixed(2).replace(/\.00$/, '');
}

/* Content-stream /Length is a BYTE count. Our strings are Latin-1 by
   construction, but a stray multi-byte character would silently corrupt the
   object offsets, so count bytes rather than characters. */
function byteLength(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) n += str.charCodeAt(i) > 0xff ? 2 : 1;
  return n;
}
