/* Documents: on-screen tickets, print, and a generated PDF. */

import { page, el, clear, qs, toast } from '../ui.js';
import { money, Theme, hour12 } from '../theme.js';
import { findBooking } from '../booking.js';
import { renderTicket, buildPdf } from '../ticket.js';

await page({ active: 'manage', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

const params = new URLSearchParams(location.search);
const tenantParam = params.get('tenant');
const withTenant = (href) => href + (tenantParam ? (href.includes('?') ? '&' : '?') + `tenant=${tenantParam}` : '');
const booking = findBooking(params.get('pnr'));
const mount = qs('#tickets');

if (!booking) {
  qs('#ticket-sub').textContent = '';
  qs('#print').disabled = true;
  qs('#download').disabled = true;
  mount.append(el('div', { class: 'empty card' },
    el('p', { class: 'empty-title' }, 'No booking to show'),
    el('p', {}, 'Documents live in the browser that made the booking. Find your trip to open its tickets.'),
    el('div', { class: 'empty-actions' },
      el('a', { class: 'btn', href: withTenant('manage.html') }, 'Find a booking'))));
} else {
  qs('#ticket-sub').textContent =
    `Reservation ${booking.pnr} · ${booking.legs.length} ${booking.legs.length === 1 ? 'ticket' : 'tickets'} · `
    + `${booking.passengers.length} ${booking.passengers.length === 1 ? 'traveller' : 'travellers'}`;

  booking.legs.forEach((_, i) => {
    mount.append(renderTicket(booking, i, Theme.tenant, { hour12: hour12() }));
  });

  mount.append(el('p', { class: 'note note-info mt-6 no-print' },
    'The barcode encodes the reservation number, the issue date and an explicit specimen marker. '
    + 'Rail ticketing standards define exactly such a flag for test documents, so this ticket declares '
    + 'itself a specimen in its data as well as on its face.'));

  qs('#print').addEventListener('click', () => window.print());
  qs('#download').addEventListener('click', () => {
    const pdf = buildPdf(booking, Theme.tenant, { hour12: hour12(), money: (n) => money(n) });
    pdf.download(`${Theme.tenant.brand.wordmark}-${booking.pnr}.pdf`);
    toast('Ticket PDF downloaded.');
  });
}
