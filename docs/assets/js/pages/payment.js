/* Payment: review, method, promotional code, and the transition to a booking. */

import { page, el, clear, qs, duration, clockAt, paymentList, toast } from '../ui.js';
import { Net } from '../data.js';
import { money, Theme, PAYMENT_METHODS } from '../theme.js';
import { PRODUCTS, priceLine, priceBasket, getProvider } from '../fares.js';
import { loadBasket, saveBasket, resolveJourney, createBooking, clearBasket, tooCloseToDeparture } from '../booking.js';

await page({ active: 'book', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

const basket = loadBasket();
const tenantParam = new URLSearchParams(location.search).get('tenant');
const withTenant = (href) => href + (tenantParam ? `?tenant=${tenantParam}` : '');

if (!basket.selections.length || !basket.contact.email) {
  location.replace(withTenant(basket.selections.length ? 'book.html' : 'search.html'));
}

/* Promotional codes are tenant configuration in a production deployment; three
   are hard-wired here so the mechanism is demonstrable end to end. */
const PROMOS = {
  RAILCARD10: { kind: 'pct', value: 10, label: 'RAILCARD10 — 10% off' },
  FIRSTTRIP: { kind: 'fixed', value: 15, label: 'FIRSTTRIP — 15 off' },
  COACH25: { kind: 'pct', value: 25, label: 'COACH25 — 25% off Thruway coach legs' },
};

let method = Theme.tenant.payments[0];

paintStepper(2);
paintReview();
paintMethods();
paintBreakdown();
paintDemoNotice();

function paintStepper(active) {
  const steps = ['Choose trains', 'Travellers', 'Payment', 'Confirmation'];
  const mount = qs('#stepper');
  clear(mount);
  steps.forEach((label, i) => {
    const cls = i < active ? 'step step-done' : i === active ? 'step step-now' : 'step';
    mount.append(el('li', { class: cls, 'aria-current': i === active ? 'step' : null },
      el('span', { class: 'step-num' }, String(i + 1)), label));
  });
}

function paintReview() {
  const mount = qs('#review');
  clear(mount);

  for (const sel of basket.selections) {
    const j = resolveJourney(sel.journeyRef);
    if (!j) continue;
    const a = Net.stations[j.legs[0].fromStn];
    const b = Net.stations[j.legs[j.legs.length - 1].toStn];
    const block = el('div', { class: 'mt-4', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
      el('div', { class: 'row row-between row-wrap', style: 'gap:var(--sp-3)' },
        el('strong', {}, `${sel.label}: ${a.n} → ${b.n}`),
        el('span', { class: 'badge badge-brand' }, sel.productName)),
      el('div', { class: 'mono mt-2', style: 'font-size:var(--step--1)' },
        `${clockAt(j.depInstant, a)} – ${clockAt(j.arrInstant, b)} · ${duration(j.durationMin)} · `
        + (j.transfers ? `${j.transfers} change${j.transfers > 1 ? 's' : ''}` : 'direct')),
      el('div', { class: 'text-soft', style: 'font-size:var(--step--2)' },
        j.legs.map((l) => `${l.trip.route.n}${l.trip.num ? ' ' + l.trip.num : ''}`).join(' · ')));
    if (tooCloseToDeparture(j.depInstant)) {
      block.append(el('p', { class: 'note note-err mt-2' },
        'This departure is now inside the booking cut-off. Go back and pick another train.'));
    }
    mount.append(block);
  }

  mount.append(el('div', { class: 'mt-6', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
    el('strong', { style: 'font-size:var(--step--1)' }, 'Travellers'),
    el('ul', { class: 'mt-2', style: 'padding-left:var(--sp-6);font-size:var(--step--1)' },
      basket.passengers.map((p) => el('li', {},
        `${p.firstName} ${p.lastName}`.trim(), ' ',
        el('span', { class: 'text-mute' }, `(${p.type})`))))));

  if (basket.assistance.required) {
    mount.append(el('p', { class: 'note note-ok mt-4' },
      el('strong', {}, 'Station assistance requested. '),
      basket.assistance.travellers.length
        ? `For ${basket.assistance.travellers.length} traveller${basket.assistance.travellers.length > 1 ? 's' : ''}. `
        : '',
      basket.assistance.notes || 'Recorded on the reservation.'));
  }
}

function paintMethods() {
  const mount = qs('#methods');
  clear(mount);
  for (const id of Theme.tenant.payments) {
    const m = PAYMENT_METHODS[id];
    if (!m) continue;
    mount.append(el('label', { class: 'choice' },
      el('input', {
        type: 'radio', name: 'method', value: id, checked: id === method,
        onchange: () => { method = id; paintCardFields(); },
      }),
      el('span', {},
        el('strong', {}, m.name),
        m.note ? el('span', { class: 'text-soft', style: 'display:block;font-size:var(--step--2)' }, m.note) : null)));
  }
  paintCardFields();
}

function paintCardFields() {
  const mount = qs('#card-fields');
  clear(mount);
  const kind = PAYMENT_METHODS[method]?.kind;

  if (kind === 'card') {
    mount.append(el('div', { class: 'grid grid-2' },
      textField('card-number', 'Card number', { inputmode: 'numeric', autocomplete: 'cc-number', placeholder: '0000 0000 0000 0000' }),
      textField('card-name', 'Name on card', { autocomplete: 'cc-name' }),
      textField('card-exp', 'Expiry', { placeholder: 'MM/YY', autocomplete: 'cc-exp' }),
      textField('card-cvc', 'Security code', { inputmode: 'numeric', autocomplete: 'cc-csc', maxlength: '4' })));
    mount.append(el('p', { class: 'note note-warn mt-4' },
      el('strong', {}, 'Do not enter a real card. '),
      'These fields are inert. In a production deployment they would be hosted fields belonging to the '
      + 'payment provider, so card data never reaches this page and the merchant stays outside PCI scope.'));
  } else if (kind === 'bank') {
    mount.append(el('p', { class: 'note note-info' },
      `${PAYMENT_METHODS[method].name} would hand you to your bank to approve the payment, then return `
      + 'you here. Nothing is collected on this page.'));
  } else {
    mount.append(el('p', { class: 'note note-info' },
      `${PAYMENT_METHODS[method].name} would open its own approval step. Nothing is collected on this page.`));
  }
}

function textField(id, label, opts = {}) {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { class: 'label', for: id }, label));
  wrap.append(el('input', Object.assign({ class: 'input', id, name: id, autocomplete: 'off' }, opts)));
  return wrap;
}

/* -------------------------------------------------------------------------- */

function priced() {
  const provider = getProvider();
  const lines = [];
  for (const sel of basket.selections) {
    const journey = resolveJourney(sel.journeyRef);
    if (!journey) continue;
    const d = new Date(journey.depInstant);
    const ctx = {
      ymd: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(),
      daysAhead: Math.max(0, Math.round((journey.depInstant - Date.now()) / 86400000)),
      dow: d.getDay(),
    };
    const quote = provider.quoteSync(journey, ctx).find((q) => q.product === sel.product);
    if (!quote) continue;
    const product = PRODUCTS[sel.product];
    const paying = basket.passengers.filter((p) => p.type !== 'infant').length;
    const units = product.kind === 'room' ? Math.max(1, Math.ceil(paying / (product.sleeps || 2))) : 1;
    lines.push(priceLine({
      quote, journey,
      party: { passengers: basket.passengers, units },
      policy: Theme.tenant.policy,
      promo: basket.promo,
    }));
  }
  return priceBasket(lines);
}

function paintBreakdown() {
  const mount = qs('#breakdown');
  clear(mount);
  const p = priced();

  mount.append(el('h2', { style: 'font-size:var(--step-0)' }, 'Price breakdown'));

  const table = el('table', { class: 'breakdown mt-4' });
  const body = el('tbody');

  for (const line of p.lines) {
    body.append(el('tr', {}, el('td', { colspan: '2' },
      el('strong', { style: 'font-size:var(--step--1)' }, line.productName))));
    for (const item of line.items) {
      body.append(el('tr', { class: 'row-sub' },
        el('td', {}, `${item.who} · ${item.label}${item.discountPct ? ` (${item.discountPct}% off)` : ''}`),
        el('td', {}, item.free ? 'Free' : money(item.net))));
    }
    body.append(el('tr', { class: 'row-sub' },
      el('td', {}, `${line.markupLabel} (${line.markupPct}%)`),
      el('td', {}, money(line.markup))));
    if (line.promoAmount) {
      body.append(el('tr', { class: 'row-sub row-credit' },
        el('td', {}, line.promoLabel), el('td', {}, `−${money(line.promoAmount)}`)));
    }
  }

  body.append(el('tr', { class: 'row-rule' },
    el('td', {}, 'Carrier fare'), el('td', {}, money(p.carrierNet))));
  body.append(el('tr', {},
    el('td', {}, Theme.tenant.policy.serviceChargeLabel), el('td', {}, money(p.markup))));
  if (p.promoAmount) {
    body.append(el('tr', { class: 'row-credit' },
      el('td', {}, 'Promotion'), el('td', {}, `−${money(p.promoAmount)}`)));
  }
  body.append(el('tr', { class: 'row-total' },
    el('td', {}, 'Total'), el('td', {}, money(p.total, { showBase: true }))));

  table.append(body);
  mount.append(table);

  const m = Theme.tenant.money;
  if (m.rateFromUsd !== 1 && m.rateAsOf) {
    mount.append(el('p', { class: 'text-mute mt-4', style: 'font-size:var(--step--2)' },
      `Converted from US dollars at a rate of ${m.rateFromUsd} set on `
      + `${new Date(m.rateAsOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. `
      + 'This is the agency\'s declared rate, not a live market rate.'));
  }

  mount.append(el('p', { class: 'text-mute mt-4', style: 'font-size:var(--step--2)' },
    'The carrier\'s fare and this agency\'s charge are shown separately, on every booking. ',
    el('a', { class: 'link-quiet', href: withTenant('fares.html') }, 'How pricing works')));
}

function paintDemoNotice() {
  qs('#demo-notice').append(
    el('strong', {}, 'No payment will be taken. '),
    document.createTextNode(
      'Completing this step writes a booking to this browser only. Nothing is transmitted, no reservation '
      + 'is created in any carrier system, and the documents produced are specimens that are not valid for travel.'));
}

/* -------------------------------------------------------------------------- */

qs('#apply-promo').addEventListener('click', () => {
  const code = qs('#promo').value.trim().toUpperCase();
  const note = qs('#promo-note');
  if (!code) { basket.promo = null; note.textContent = ''; saveBasket(basket); paintBreakdown(); return; }
  const hit = PROMOS[code];
  if (!hit) {
    basket.promo = null;
    note.textContent = `“${code}” is not a code we recognise.`;
    note.className = 'field-help text-accent';
  } else {
    basket.promo = { ...hit, valid: true, code };
    note.textContent = `${hit.label} applied.`;
    note.className = 'field-help';
    toast('Promotional code applied.');
  }
  saveBasket(basket);
  paintBreakdown();
});

qs('#pay-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = qs('#pay-error');
  err.textContent = '';

  for (const sel of basket.selections) {
    const j = resolveJourney(sel.journeyRef);
    if (j && tooCloseToDeparture(j.depInstant)) {
      err.textContent = 'One of your trains is now inside the booking cut-off. Choose another departure.';
      return;
    }
  }

  const button = qs('#place');
  button.disabled = true;
  button.textContent = 'Completing…';

  const booking = createBooking({
    basket,
    priced: priced(),
    tenantId: Theme.tenant.id,
    currency: Theme.tenant.money.currency,
    rate: Theme.tenant.money.rateFromUsd,
  });

  clearBasket();
  const p = new URLSearchParams({ pnr: booking.pnr });
  if (tenantParam) p.set('tenant', tenantParam);
  location.href = `confirmation.html?${p}`;
});
