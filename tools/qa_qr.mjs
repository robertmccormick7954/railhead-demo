/* Emit QR matrices from our encoder for tools/qa_qr.py to verify. */
import { encode } from '../docs/assets/js/qr.js';
import { writeFileSync } from 'node:fs';

const payloads = [
  'RAILHEAD',
  'RH1|K7J2QX|2209|NYP>WAS|20260820|1',
  'RH1|PNR=A1B2C3|TRAIN=449|FROM=BOS|TO=ALB|DATE=20261114|PAX=2|CLASS=business|SEQ=1',
  'https://railhead.example/t/K7J2QX?v=1&sig=3f9a2b7c8d1e4f5a6b7c8d9e0f1a2b3c',
  'RH1|' + 'X'.repeat(180),
  'Montréal — Gare Centrale · Voyager Reizen B.V. · €249,50',
  'RH1|' + 'Y'.repeat(420),
];

const out = [];
for (const text of payloads) {
  for (const ec of ['L', 'M', 'Q', 'H']) {
    let qr;
    try { qr = encode(text, { ec }); } catch (e) { out.push({ text, ec, error: String(e.message) }); continue; }
    out.push({
      text, ec, version: qr.version, mask: qr.mask, size: qr.size,
      modules: qr.modules.map((r) => r.map((v) => (v ? 1 : 0)).join('')).join('\n'),
    });
  }
}
writeFileSync(new URL('../research/qr_out.json', import.meta.url), JSON.stringify(out));
console.log(`emitted ${out.length} matrices (${out.filter((o) => o.error).length} errors)`);
for (const o of out.filter((x) => x.error)) console.log('  error:', o.ec, o.error);
