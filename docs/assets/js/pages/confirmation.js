/* Confirmation: the reservation number, what happens next, and the documents. */

import { page, el, clear, qs, duration, clockAt } from '../ui.js';
import { Net } from '../data.js';
import { money, Theme } from '../theme.js';
import { findBooking } from '../booking.js';
import { resolveJourney } from '../booking.js';
import { loadPhotos, photo } from '../photos.js';

await page({ active: 'book', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });
await loadPhotos();

const params = new URLSearchParams(location.search);
const tenantParam = params.get('tenant');
const withTenant = (href) => href + (tenantParam ? (href.includes('?') ? '&' : '?') + `tenant=${tenantParam}` : '');
const booking = findBooking(params.get('pnr'));
const mount = qs('#conf-body');

const steps = ['Choose trains', 'Travellers', 'Payment', 'Confirmation'];
const stepper = qs('#stepper');
steps.forEach((label, i) => {
  const cls = i < 3 ? 'step step-done' : 'step step-now';
  stepper.append(el('li', { class: cls, 'aria-current': i === 3 ? 'step' : null },
    el('span', { class: 'step-num' }, String(i + 1)), label));
});

if (!booking) {
  mount.append(el('div', { class: 'empty card' },
    el('h1', { class: 'empty-title' }, 'We cannot find that booking'),
    el('p', {}, 'Bookings made in this demonstration are stored in the browser that made them. '
      + 'If you cleared site data or switched browser, it will not be here.'),
    el('div', { class: 'empty-actions' },
      el('a', { class: 'btn', href: withTenant('index.html') }, 'Start again'))));
} else {
  paint(booking);
}

function paint(b) {
  /* The destination, once, at the top. A confirmation is the one moment in a
     booking where a picture is doing emotional work rather than informational. */
  const dest = b.legs[0]?.summary?.to;
  const pic = dest ? photo(`city-${dest}`, { alt: '', sizes: '100vw' }) : null;
  if (pic) mount.append(el('div', { class: 'media media-hero mb-4' }, pic));

  mount.append(el('div', { class: 'card card-raise' },
    el('span', { class: 'badge badge-ok' }, 'Confirmed'),
    el('h1', { class: 'sign mt-4', style: 'font-size:var(--step-4)' }, 'Your trip is booked.'),
    el('p', { class: 'text-soft mt-4' },
      'We have sent the documents to ', el('strong', {}, b.contact.email), '.'),
    el('div', { class: 'mt-6', style: 'padding-top:var(--sp-5);border-top:1px solid var(--rule)' },
      el('p', { class: 'eyebrow', style: 'margin:0' }, 'Reservation number'),
      el('p', { class: 'pnr', style: 'font-size:var(--step-5);line-height:1.1' }, b.pnr),
      el('p', { class: 'text-soft', style: 'font-size:var(--step--1)' },
        'Quote this to find your booking or to speak to us about it.')),
    el('div', { class: 'row row-wrap mt-6', style: 'gap:var(--sp-3)' },
      el('a', { class: 'btn btn-lg', href: withTenant(`ticket.html?pnr=${b.pnr}`) }, 'View your tickets'),
      el('a', { class: 'btn btn-secondary btn-lg', href: withTenant('manage.html') }, 'My trips'))));

  const trip = el('section', { class: 'card mt-6', 'aria-labelledby': 'trip-title' },
    el('h2', { id: 'trip-title', style: 'font-size:var(--step-0)' }, 'What you booked'));

  for (const leg of b.legs) {
    const s = leg.summary;
    if (!s) continue;
    const a = Net.stations.find((x) => x.c === s.from);
    const z = Net.stations.find((x) => x.c === s.to);
    trip.append(el('div', { class: 'mt-4', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
      el('div', { class: 'row row-between row-wrap', style: 'gap:var(--sp-3)' },
        el('strong', {}, `${leg.label}: ${a.n} → ${z.n}`),
        el('span', { class: 'badge badge-brand' }, leg.productName)),
      el('div', { class: 'mono mt-2', style: 'font-size:var(--step--1)' },
        `${clockAt(s.depInstant, a)} – ${clockAt(s.arrInstant, z)} · ${duration(s.durationMin)}`),
      el('div', { class: 'text-soft', style: 'font-size:var(--step--2)' },
        s.services.map((x) => `${x.route}${x.num ? ' ' + x.num : ''}`).join(' · '))));
  }

  trip.append(el('table', { class: 'breakdown mt-6' }, el('tbody', {},
    el('tr', {}, el('td', {}, 'Carrier fare'), el('td', {}, money(b.money.carrierNet))),
    el('tr', {}, el('td', {}, Theme.tenant.policy.serviceChargeLabel), el('td', {}, money(b.money.markup))),
    b.money.promoAmount ? el('tr', { class: 'row-credit' },
      el('td', {}, 'Promotion'), el('td', {}, `−${money(b.money.promoAmount)}`)) : null,
    el('tr', { class: 'row-total' }, el('td', {}, 'Total'), el('td', {}, money(b.money.total, { showBase: true }))))));
  mount.append(trip);

  const next = el('section', { class: 'card mt-6', 'aria-labelledby': 'next-title' },
    el('h2', { id: 'next-title', style: 'font-size:var(--step-0)' }, 'Before you travel'),
    el('ul', { class: 'mt-4', style: 'padding-left:var(--sp-6);font-size:var(--step--1)' },
      el('li', {}, 'Bring photo identification for each traveller aged 16 or over.'),
      el('li', {}, 'Show the barcode on your ticket from a phone screen or a printed page.'),
      el('li', {}, 'Arrive at the station in good time. Boarding can close before departure.'),
      b.assistance?.required
        ? el('li', {}, 'Your assistance request is on the reservation. Speak to station staff on arrival.')
        : null));
  mount.append(next);

  mount.append(el('p', { class: 'note note-warn mt-6' },
    el('strong', {}, 'This is a demonstration. '),
    'No payment was taken, no reservation exists in any carrier system, and the documents are specimens '
    + 'that are not valid for travel. The schedule shown is real.'));
}
