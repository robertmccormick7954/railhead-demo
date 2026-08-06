/* Railhead — PDF metric and structure checks. Run: node tools/qa_pdf.mjs */
import { Pdf } from '../docs/assets/js/pdf.js';

let pass = 0, fail = 0;
const ok = (c, m, d='') => { if (c) { pass++; console.log('  PASS ', m); } else { fail++; console.log('  FAIL ', m, d); } };
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const p = new Pdf();
console.log('=== font metrics vs Adobe AFM ===');
const cases = [
  ['Hello', 'regular', 10, (722+556+222+222+556)/100],
  ['WWWWW', 'regular', 10, 944*5/100],
  ['iiiii', 'regular', 10, 222*5/100],
  ['0123456789', 'regular', 10, 556*10/100],
  ['Hello', 'bold', 10, (722+556+278+278+611)/100],
  ['WWWWW', 'bold', 10, 944*5/100],
  ['ABC', 'mono', 10, 600*3/100],
];
for (const [t, f, s, want] of cases) {
  const got = p.measure(t, { font: f, size: s });
  ok(near(got, want), `${f} "${t}" @${s}pt = ${got.toFixed(2)}pt (expected ${want.toFixed(2)})`);
}

console.log('\n=== no spurious truncation ===');
for (const [t, w] of [['Northeast Regional 179', 200], ['6 August 2026 at 22:31', 365], ['WHITFIELD, Alice  (Adult)', 375]]) {
  const out = p.truncate(t, w, { font: 'regular', size: 9 });
  ok(out === t, `"${t}" fits in ${w}pt untruncated`, `got "${out}"`);
}
ok(p.truncate('x'.repeat(400), 50, { font: 'regular', size: 9 }).endsWith('...'), 'genuinely long text does truncate');

console.log('\n=== structure ===');
const doc = new Pdf({ title: 'T', author: 'A', subject: 'S' });
doc.text('Page one', 40, 700, { font: 'bold', size: 12 });
doc.newPage();
doc.text('Page two', 40, 700);
const raw = doc.build();
ok(raw.startsWith('%PDF-1.4'), 'starts with a PDF 1.4 header');
ok(raw.trimEnd().endsWith('%%EOF'), 'ends with %%EOF');
ok((raw.match(/\/Type \/Page[^s]/g) || []).length === 2, 'declares two page objects');
ok(/\/Type \/Pages/.test(raw) && /\/Count 2/.test(raw), 'page tree counts two');
const xref = Number(raw.slice(raw.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
ok(raw.slice(xref, xref + 4) === 'xref', `startxref offset ${xref} points at the xref table`);
const objCount = (raw.match(/^\d+ 0 obj$/gm) || []).length;
const xrefRows = (raw.slice(xref).match(/^\d{10} \d{5} [nf] $/gm) || []).length;
ok(objCount + 1 === xrefRows, `xref has one row per object plus the free head (${objCount} objects, ${xrefRows} rows)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
