/* ==========================================================================
   Railhead — travel documents
   --------------------------------------------------------------------------
   Two documents, deliberately separated, because that is how rail ticketing
   actually works and conflating them is the tell of a mock:

     TICKET   what you show to board. Reservation number, who is travelling,
              which train, from where to where, and a scannable barcode.
              It carries NO price — an Amtrak eTicket does not either.
     RECEIPT  what you keep for your records. Ticket numbers, the fare, the
              agency's charge, the total, and how it was paid.

   Every document this build issues is a SPECIMEN. European rail ticketing
   standards define a specimen flag inside the barcode payload for exactly this
   purpose ("The bit must be set if the barcode is issued for test purpose"), so
   the marking is in the encoded data as well as printed on the face. It is not
   removable by editing the page.
   ========================================================================== */

import { Pdf } from './pdf.js';
import { encode, toSvg } from './qr.js';
import { Net, station, localClock, localYmd, zoneAbbr, dayOffset } from './data.js';
import { el, duration } from './ui.js';

const INK = [16, 26, 24];
const GREY = [90, 105, 100];
const RULE = [175, 188, 183];

/** The barcode payload. Mirrors the shape of a real rail eTicket payload —
    record locator plus issue date — with an explicit specimen marker. */
export function ticketPayload(booking, legIndex = 0) {
  const issued = new Date(booking.createdAt);
  const ymd = issued.getFullYear() * 10000 + (issued.getMonth() + 1) * 100 + issued.getDate();
  return `RAILHEAD*${booking.pnr}*${ymd}*L${legIndex + 1}*SPECIMEN`;
}

export function ticketQr(booking, legIndex = 0) {
  return encode(ticketPayload(booking, legIndex), { ec: 'M' });
}

/* --------------------------------------------------------------------------
   Screen rendering
   -------------------------------------------------------------------------- */

function passengerName(p) {
  return `${(p.lastName || '').toUpperCase()}, ${p.firstName || ''}`.trim().replace(/^,\s*/, '');
}

export function renderTicket(booking, legIndex, tenant, { hour12 = true } = {}) {
  const leg = booking.legs[legIndex];
  const s = leg.summary;
  if (!s) return el('div', { class: 'note note-err' }, 'This leg cannot be displayed.');

  const from = station(s.from);
  const to = station(s.to);
  const qr = ticketQr(booking, legIndex);

  const wrap = el('article', { class: 'ticket card', 'aria-label': `Ticket for ${leg.label}` });

  wrap.append(el('div', { class: 'ticket-head row row-between row-wrap' },
    el('div', { class: 'ticket-qr' },
      el('div', { html: toSvg(qr, { scale: 3, quiet: 4, dark: '#101A18' }), style: 'width:132px' }),
      el('p', { class: 'mono ticket-payload' }, ticketPayload(booking, legIndex))),
    el('div', { style: 'text-align:right' },
      el('p', { class: 'eyebrow', style: 'margin:0' }, `${tenant.name} · eTicket`),
      el('p', { class: 'ticket-instruction' }, 'Present this document for boarding'),
      el('p', { class: 'text-mute', style: 'font-size:var(--step--2);margin-top:var(--sp-2)' }, 'Reservation number'),
      el('p', { class: 'pnr', style: 'font-size:var(--step-3)' }, booking.pnr))));

  wrap.append(el('p', { class: 'ticket-specimen' },
    'Specimen — not valid for travel. Issued by a demonstration system.'));

  const dayShift = dayOffset(localYmd(s.depInstant, from.tz), localYmd(s.arrInstant, to.tz));

  wrap.append(el('div', { class: 'ticket-journey' },
    el('div', {},
      el('p', { class: 'ticket-label' }, 'From'),
      el('p', { class: 'ticket-station' }, from.n),
      el('p', { class: 'mono ticket-meta' }, `${from.c} · ${from.y}, ${from.s}`),
      el('p', { class: 'ticket-time' },
        localClock(s.depInstant, from.tz, hour12), ' ', el('span', { class: 'ticket-tz' }, zoneAbbr(s.depInstant, from.tz))),
      el('p', { class: 'ticket-meta' }, formatLongDate(s.depInstant, from.tz))),
    el('div', { class: 'ticket-arrow', 'aria-hidden': 'true' }, '→'),
    el('div', {},
      el('p', { class: 'ticket-label' }, 'To'),
      el('p', { class: 'ticket-station' }, to.n),
      el('p', { class: 'mono ticket-meta' }, `${to.c} · ${to.y}, ${to.s}`),
      el('p', { class: 'ticket-time' },
        localClock(s.arrInstant, to.tz, hour12),
        dayShift ? el('sup', {}, `+${dayShift}`) : null,
        ' ', el('span', { class: 'ticket-tz' }, zoneAbbr(s.arrInstant, to.tz))),
      el('p', { class: 'ticket-meta' }, formatLongDate(s.arrInstant, to.tz)))));

  const svc = el('table', { class: 'table ticket-table' },
    el('caption', { class: 'visually-hidden' }, 'Services on this ticket'),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Service'),
      el('th', { scope: 'col' }, 'From'),
      el('th', { scope: 'col' }, 'Depart'),
      el('th', { scope: 'col' }, 'To'),
      el('th', { scope: 'col' }, 'Arrive'))),
    el('tbody', {}, s.services.map((x) => {
      const a = station(x.from);
      const b = station(x.to);
      return el('tr', {},
        el('td', {}, `${x.route}${x.num ? ' ' + x.num : ''}`,
          x.mode === 'bus' ? el('span', { class: 'badge badge-info' }, 'Coach') : null),
        el('td', { class: 'mono' }, x.from),
        el('td', { class: 'mono' }, localClock(x.dep, a.tz, hour12)),
        el('td', { class: 'mono' }, x.to),
        el('td', { class: 'mono' }, localClock(x.arr, b.tz, hour12)));
    })));
  wrap.append(el('div', { class: 'table-scroll mt-6' }, svc));

  const pax = el('table', { class: 'table ticket-table' },
    el('caption', { class: 'visually-hidden' }, 'Travellers on this ticket'),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Traveller'),
      el('th', { scope: 'col' }, 'Type'),
      el('th', { scope: 'col' }, 'Accommodation'),
      el('th', { scope: 'col' }, 'Ticket number'))),
    el('tbody', {}, booking.passengers.map((p, i) => el('tr', {},
      el('td', {}, passengerName(p)),
      el('td', {}, capitalise(p.type)),
      el('td', {}, leg.productName),
      el('td', { class: 'mono' }, leg.ticketNumbers[i] || '—')))));
  wrap.append(el('div', { class: 'table-scroll mt-4' }, pax));

  if (booking.assistance?.required) {
    wrap.append(el('p', { class: 'note note-info mt-4' },
      el('strong', {}, 'Station assistance requested. '),
      booking.assistance.notes || 'Assistance has been recorded on this reservation.'));
  }

  wrap.append(el('p', { class: 'ticket-foot' },
    `${tenant.legalName} acts as a retailer. The transport contract is with the operating carrier and `
    + 'their conditions of carriage apply. Bring photo identification.'));

  return wrap;
}

function capitalise(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

function formatLongDate(instant, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(instant));
}

/* --------------------------------------------------------------------------
   PDF
   -------------------------------------------------------------------------- */

export function buildPdf(booking, tenant, { hour12 = true, money = (n) => `$${n.toFixed(2)}` } = {}) {
  const pdf = new Pdf({
    size: 'a4',
    title: `${tenant.name} eTicket ${booking.pnr}`,
    author: tenant.legalName,
    subject: 'Specimen travel document — not valid for travel',
  });

  booking.legs.forEach((leg, i) => {
    if (i > 0) pdf.newPage();
    drawTicket(pdf, booking, leg, i, tenant, hour12);
  });

  pdf.newPage();
  drawReceipt(pdf, booking, tenant, money);

  return pdf;
}

function drawTicket(pdf, booking, leg, index, tenant, hour12) {
  const M = pdf.margin;
  const W = pdf.width - M * 2;
  let y = pdf.height - M;
  const s = leg.summary;

  pdf.stroke(RULE).lineWidth(1).rect(M - 12, M - 12, W + 24, pdf.height - M * 2 + 24, 'S');

  // Barcode top-left, brand block top-right — the layout a rail eTicket uses.
  const qr = ticketQr(booking, index);
  pdf.qr(qr, M, y - 108, 108);
  pdf.text(ticketPayload(booking, index), M, y - 122, { font: 'mono', size: 6.5, color: GREY });

  pdf.text(`${tenant.name}`, M + W, y - 12, { font: 'bold', size: 15, align: 'right', color: INK });
  pdf.text('eTicket', M + W, y - 28, { font: 'regular', size: 10, align: 'right', color: GREY });

  pdf.stroke(INK).lineWidth(1).rect(M + W - 190, y - 54, 190, 20, 'S');
  pdf.text('PRESENT THIS DOCUMENT FOR BOARDING', M + W - 95, y - 48,
    { font: 'bold', size: 7.5, align: 'center', color: INK, letterSpacing: 0.6 });

  pdf.text('RESERVATION NUMBER', M + W, y - 74, { font: 'regular', size: 7, align: 'right', color: GREY, letterSpacing: 1 });
  pdf.text(booking.pnr, M + W, y - 100, { font: 'monoBold', size: 22, align: 'right', color: INK, letterSpacing: 2 });

  y -= 140;

  pdf.fill([248, 240, 228]).rect(M, y - 4, W, 18, 'f');
  pdf.text('SPECIMEN — NOT VALID FOR TRAVEL. ISSUED BY A DEMONSTRATION SYSTEM.',
    M + W / 2, y + 2, { font: 'bold', size: 8, align: 'center', color: [120, 70, 10], letterSpacing: 0.8 });
  y -= 34;

  const from = station(s.from);
  const to = station(s.to);
  const dayShift = dayOffset(localYmd(s.depInstant, from.tz), localYmd(s.arrInstant, to.tz));
  const colW = (W - 40) / 2;

  const drawEnd = (label, stn, instant, x, extra) => {
    pdf.text(label.toUpperCase(), x, y, { font: 'regular', size: 7, color: GREY, letterSpacing: 1 });
    pdf.text(stn.n, x, y - 20, { font: 'bold', size: 15, color: INK, maxWidth: colW });
    pdf.text(`${stn.c} · ${stn.y}, ${stn.s}`, x, y - 34, { font: 'regular', size: 8, color: GREY, maxWidth: colW });
    const t = localClock(instant, stn.tz, hour12) + (extra || '');
    pdf.text(t, x, y - 58, { font: 'monoBold', size: 17, color: INK });
    const tw = pdf.measure(t, { font: 'monoBold', size: 17 });
    pdf.text(zoneAbbr(instant, stn.tz), x + tw + 6, y - 58, { font: 'regular', size: 8, color: GREY });
    pdf.text(formatLongDate(instant, stn.tz), x, y - 74, { font: 'regular', size: 8.5, color: INK });
  };

  drawEnd('From', from, s.depInstant, M);
  pdf.text('->', M + colW + 20, y - 56, { font: 'bold', size: 13, align: 'center', color: GREY });
  drawEnd('To', to, s.arrInstant, M + colW + 40, dayShift ? ` +${dayShift}` : '');

  y -= 96;
  pdf.stroke(RULE).lineWidth(0.6).line(M, y, M + W, y);
  y -= 16;

  pdf.text(`${leg.label.toUpperCase()} · ${leg.productName.toUpperCase()} · ${duration(s.durationMin).toUpperCase()}`
    + (s.transfers ? ` · ${s.transfers} CHANGE${s.transfers > 1 ? 'S' : ''}` : ' · DIRECT'),
    M, y, { font: 'bold', size: 8.5, color: INK, letterSpacing: 0.6 });
  y -= 22;

  // services
  const cols = [M, M + 210, M + 270, M + 340, M + 400];
  const heads = ['SERVICE', 'FROM', 'DEPART', 'TO', 'ARRIVE'];
  heads.forEach((h, i) => pdf.text(h, cols[i], y, { font: 'regular', size: 7, color: GREY, letterSpacing: 0.8 }));
  y -= 6;
  pdf.stroke(RULE).line(M, y, M + W, y);
  y -= 14;

  for (const x of s.services) {
    const a = station(x.from);
    const b = station(x.to);
    pdf.text(`${x.route}${x.num ? ' ' + x.num : ''}${x.mode === 'bus' ? ' (coach)' : ''}`, cols[0], y,
      { font: 'regular', size: 9, color: INK, maxWidth: 200 });
    pdf.text(x.from, cols[1], y, { font: 'mono', size: 9, color: INK });
    pdf.text(localClock(x.dep, a.tz, hour12), cols[2], y, { font: 'mono', size: 9, color: INK });
    pdf.text(x.to, cols[3], y, { font: 'mono', size: 9, color: INK });
    pdf.text(localClock(x.arr, b.tz, hour12), cols[4], y, { font: 'mono', size: 9, color: INK });
    y -= 15;
  }

  y -= 8;
  pdf.stroke(RULE).line(M, y, M + W, y);
  y -= 16;

  pdf.text('TRAVELLERS', M, y, { font: 'regular', size: 7, color: GREY, letterSpacing: 0.8 });
  pdf.text('TICKET NUMBER', M + W, y, { font: 'regular', size: 7, color: GREY, align: 'right', letterSpacing: 0.8 });
  y -= 16;
  booking.passengers.forEach((p, i) => {
    pdf.text(`${passengerName(p)}  (${capitalise(p.type)})`, M, y, { font: 'regular', size: 9.5, color: INK, maxWidth: W - 140 });
    pdf.text(leg.ticketNumbers[i] || '-', M + W, y, { font: 'mono', size: 9.5, color: INK, align: 'right' });
    y -= 15;
  });

  if (booking.assistance?.required) {
    y -= 10;
    pdf.stroke(RULE).line(M, y, M + W, y);
    y -= 16;
    pdf.text('STATION ASSISTANCE REQUESTED', M, y, { font: 'bold', size: 8.5, color: INK, letterSpacing: 0.6 });
    y -= 13;
    y = pdf.paragraph(booking.assistance.notes || 'Assistance has been recorded on this reservation.',
      M, y, W, { size: 8.5, color: GREY });
  }

  // footer
  const footY = M + 26;
  pdf.stroke(RULE).line(M, footY + 18, M + W, footY + 18);
  pdf.paragraph(
    `${tenant.legalName} acts as a retailer of rail travel. The transport contract is with the operating `
    + 'carrier and their conditions of carriage apply. Bring photo identification. '
    + 'This document is a specimen produced by a demonstration system and is not valid for travel.',
    M, footY + 6, W, { size: 7, color: GREY, leading: 1.3 });
}

function drawReceipt(pdf, booking, tenant, money) {
  const M = pdf.margin;
  const W = pdf.width - M * 2;
  let y = pdf.height - M;

  pdf.text(tenant.name, M, y - 14, { font: 'bold', size: 15, color: INK });
  pdf.text('Sales receipt', M, y - 30, { font: 'regular', size: 10, color: GREY });
  pdf.text('RESERVATION', M + W, y - 8, { font: 'regular', size: 7, align: 'right', color: GREY, letterSpacing: 1 });
  pdf.text(booking.pnr, M + W, y - 28, { font: 'monoBold', size: 16, align: 'right', color: INK, letterSpacing: 2 });
  y -= 54;

  pdf.stroke(RULE).line(M, y, M + W, y);
  y -= 20;

  const issued = new Date(booking.createdAt);
  const rows = [
    ['Issued', issued.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })],
    ['Lead traveller', `${booking.contact.firstName} ${booking.contact.lastName}`.trim()],
    ['Email', booking.contact.email || '-'],
    ['Storefront', tenant.legalName],
  ];
  for (const [k, v] of rows) {
    pdf.text(k, M, y, { font: 'regular', size: 9, color: GREY });
    pdf.text(v, M + 150, y, { font: 'regular', size: 9, color: INK, maxWidth: W - 150 });
    y -= 15;
  }

  y -= 10;
  pdf.stroke(RULE).line(M, y, M + W, y);
  y -= 20;
  pdf.text('CHARGES', M, y, { font: 'bold', size: 8, color: INK, letterSpacing: 1 });
  y -= 18;

  for (const line of booking.money.lines) {
    pdf.text(line.productName, M, y, { font: 'bold', size: 9.5, color: INK });
    y -= 14;
    for (const item of line.items) {
      const label = item.discount
        ? `${item.who} (${item.label}, ${item.discountPct}% off)`
        : `${item.who} (${item.label})`;
      pdf.text(label, M + 12, y, { font: 'regular', size: 9, color: GREY, maxWidth: W - 150 });
      pdf.text(money(item.net), M + W, y, { font: 'mono', size: 9, color: INK, align: 'right' });
      y -= 13;
    }
    pdf.text(`${line.markupLabel} (${line.markupPct}%)`, M + 12, y, { font: 'regular', size: 9, color: GREY });
    pdf.text(money(line.markup), M + W, y, { font: 'mono', size: 9, color: INK, align: 'right' });
    y -= 13;
    if (line.promoAmount) {
      pdf.text(line.promoLabel || 'Promotion', M + 12, y, { font: 'regular', size: 9, color: GREY });
      pdf.text(`-${money(line.promoAmount)}`, M + W, y, { font: 'mono', size: 9, color: INK, align: 'right' });
      y -= 13;
    }
    y -= 6;
  }

  pdf.stroke(RULE).line(M, y, M + W, y);
  y -= 20;
  pdf.text('Carrier fare', M, y, { font: 'regular', size: 9.5, color: GREY });
  pdf.text(money(booking.money.carrierNet), M + W, y, { font: 'mono', size: 9.5, color: INK, align: 'right' });
  y -= 15;
  pdf.text('Agency charge', M, y, { font: 'regular', size: 9.5, color: GREY });
  pdf.text(money(booking.money.markup), M + W, y, { font: 'mono', size: 9.5, color: INK, align: 'right' });
  y -= 20;
  pdf.text('TOTAL PAID', M, y, { font: 'bold', size: 12, color: INK });
  pdf.text(money(booking.money.total), M + W, y, { font: 'monoBold', size: 14, color: INK, align: 'right' });
  y -= 28;

  pdf.stroke(RULE).line(M, y, M + W, y);
  y -= 20;
  pdf.text('TICKET NUMBERS', M, y, { font: 'bold', size: 8, color: INK, letterSpacing: 1 });
  y -= 16;
  for (const leg of booking.legs) {
    pdf.text(leg.label, M, y, { font: 'regular', size: 9, color: GREY });
    pdf.text(leg.ticketNumbers.join('  '), M + 150, y, { font: 'mono', size: 9, color: INK, maxWidth: W - 150 });
    y -= 14;
  }

  const footY = M + 30;
  pdf.stroke(RULE).line(M, footY + 22, M + W, footY + 22);
  pdf.paragraph(
    'No payment was taken. This receipt is a specimen produced by a demonstration system: no contract has '
    + 'been formed, no reservation exists in any carrier system, and no document issued here is valid for '
    + 'travel. Fares shown are simulated and are not carrier fares.',
    M, footY + 10, W, { size: 7.5, color: GREY, leading: 1.35 });
}
