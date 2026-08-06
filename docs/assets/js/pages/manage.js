/* My trips: the bookings this browser holds, and a lookup by reservation number. */

import { page, el, clear, qs, duration, clockAt, toast } from '../ui.js';
import { Net } from '../data.js';
import { money, Theme } from '../theme.js';
import { loadBookings, findBooking, cancelBooking, isPast, normaliseReference } from '../booking.js';

await page({ active: 'manage', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

const tenantParam = new URLSearchParams(location.search).get('tenant');
const withTenant = (href) => href + (tenantParam ? (href.includes('?') ? '&' : '?') + `tenant=${tenantParam}` : '');

paint();

function paint(highlight) {
  const mount = qs('#bookings');
  clear(mount);
  const all = loadBookings();

  if (!all.length) {
    mount.append(el('div', { class: 'empty card' },
      el('p', { class: 'empty-title' }, 'No trips yet'),
      el('p', {}, 'Bookings you make appear here. They are stored in this browser only, so they will not '
        + 'follow you to another device.'),
      el('div', { class: 'empty-actions' },
        el('a', { class: 'btn', href: withTenant('index.html') }, 'Find a train'))));
    return;
  }

  const upcoming = all.filter((b) => !isPast(b));
  const past = all.filter(isPast);

  if (upcoming.length) {
    mount.append(el('h2', { style: 'font-size:var(--step-1)' }, 'Upcoming'));
    for (const b of upcoming) mount.append(card(b, highlight === b.pnr));
  }
  if (past.length) {
    mount.append(el('h2', { class: 'mt-8', style: 'font-size:var(--step-1)' }, 'Past'));
    for (const b of past) mount.append(card(b, highlight === b.pnr));
  }
}

function card(b, highlight) {
  const wrap = el('article', {
    class: 'card mt-4',
    style: highlight ? 'border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)' : '',
  });

  wrap.append(el('div', { class: 'row row-between row-wrap', style: 'gap:var(--sp-3)' },
    el('div', {},
      el('span', { class: 'eyebrow', style: 'margin:0' }, 'Reservation'),
      el('span', { class: 'pnr', style: 'font-size:var(--step-2)' }, b.pnr)),
    el('span', { class: b.status === 'cancelled' ? 'badge badge-err' : 'badge badge-ok' },
      b.status === 'cancelled' ? 'Cancelled' : 'Confirmed')));

  for (const leg of b.legs) {
    const s = leg.summary;
    if (!s) continue;
    const a = Net.stations.find((x) => x.c === s.from);
    const z = Net.stations.find((x) => x.c === s.to);
    wrap.append(el('div', { class: 'mt-4', style: 'padding-top:var(--sp-3);border-top:1px solid var(--rule)' },
      el('div', { class: 'row row-between row-wrap', style: 'gap:var(--sp-3)' },
        el('strong', { style: 'font-size:var(--step--1)' }, `${leg.label}: ${a.n} → ${z.n}`),
        el('span', { class: 'badge' }, leg.productName)),
      el('div', { class: 'mono text-soft', style: 'font-size:var(--step--2)' },
        `${clockAt(s.depInstant, a)} – ${clockAt(s.arrInstant, z)} · ${duration(s.durationMin)}`)));
  }

  wrap.append(el('div', { class: 'row row-between row-wrap mt-6', style: 'gap:var(--sp-3)' },
    el('span', { class: 'money' }, money(b.money.total)),
    el('div', { class: 'row row-wrap', style: 'gap:var(--sp-2)' },
      el('a', { class: 'btn btn-sm', href: withTenant(`ticket.html?pnr=${b.pnr}`) }, 'Tickets'),
      b.status === 'cancelled' ? null : el('button', {
        class: 'btn btn-danger btn-sm', type: 'button',
        onclick: () => {
          if (!confirm(`Cancel reservation ${b.pnr}? In this demonstration nothing is refunded because nothing was paid.`)) return;
          cancelBooking(b.pnr);
          toast(`Reservation ${b.pnr} cancelled.`);
          paint(b.pnr);
        },
      }, 'Cancel'))));

  return wrap;
}

qs('#find-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = qs('#find-error');
  const pnr = normaliseReference(qs('#pnr').value);
  const last = qs('#lastname').value.trim();
  err.textContent = '';

  if (pnr.length !== 6) { err.textContent = 'A reservation number is six characters.'; qs('#pnr').focus(); return; }
  if (!last) { err.textContent = 'Enter the last name on the booking.'; qs('#lastname').focus(); return; }

  const hit = findBooking(pnr, last);
  if (!hit) {
    err.textContent = 'No booking here matches that reservation number and last name. '
      + 'Bookings are held in the browser that made them.';
    return;
  }
  location.href = withTenant(`ticket.html?pnr=${hit.pnr}`);
});
