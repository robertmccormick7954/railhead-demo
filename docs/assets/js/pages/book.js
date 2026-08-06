/* Travellers: names, passenger types, station assistance, extras, contact. */

import { page, el, clear, qs, duration, clockAt } from '../ui.js';
import { Net, station } from '../data.js';
import { money, Theme } from '../theme.js';
import { PASSENGER_TYPES, PRODUCTS, priceLine, priceBasket, getProvider } from '../fares.js';
import {
  loadBasket, saveBasket, resolveJourney, validatePassengers, validateContact, LIMITS,
} from '../booking.js';

await page({ active: 'book', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

const basket = loadBasket();
/* The lead traveller is almost always the contact. Mirror the name across until
   someone edits the contact block by hand, then stop touching it. */
let contactTouched = Boolean(basket.contact.firstName || basket.contact.lastName);
const tenantParam = new URLSearchParams(location.search).get('tenant');
const withTenant = (href) => href + (tenantParam ? `?tenant=${tenantParam}` : '');
qs('#back-link').href = withTenant('search.html');

if (!basket.selections.length) {
  location.replace(withTenant('search.html'));
}

paintStepper(1);
paintPassengers();
paintAssistance();
paintExtras();
paintContact();
paintSummary();

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

/* -------------------------------------------------------------------------- */

function paintPassengers() {
  const mount = qs('#passengers');
  clear(mount);

  basket.passengers.forEach((p, i) => {
    const card = el('fieldset', { class: 'fieldset card', style: i ? 'margin-top:var(--sp-4)' : '' });
    card.append(el('legend', { class: 'legend' }, `Traveller ${i + 1}`));

    const grid = el('div', { class: 'grid grid-3' });

    grid.append(field(`p${i}-first`, 'First name', {
      value: p.firstName || '', autocomplete: i === 0 ? 'given-name' : 'off', required: true,
      oninput: (v) => { p.firstName = v; mirrorContact(i); },
    }));
    grid.append(field(`p${i}-last`, 'Last name', {
      value: p.lastName || '', autocomplete: i === 0 ? 'family-name' : 'off', required: true,
      oninput: (v) => { p.lastName = v; mirrorContact(i); },
    }));

    const typeWrap = el('div', { class: 'field' });
    typeWrap.append(el('label', { class: 'label', for: `p${i}-type` }, 'Passenger type'));
    const select = el('select', {
      class: 'select', id: `p${i}-type`,
      onchange: (e) => { p.type = e.target.value; save(); paintSummary(); paintAssistance(); },
    }, PASSENGER_TYPES.map((t) => el('option', { value: t.key, selected: t.key === p.type },
      `${t.name} · ${t.ageNote}`)));
    typeWrap.append(select);
    grid.append(typeWrap);

    card.append(grid);

    if (basket.passengers.length > 1) {
      card.append(el('button', {
        type: 'button', class: 'btn btn-secondary btn-sm mt-4',
        onclick: () => { basket.passengers.splice(i, 1); save(); paintPassengers(); paintAssistance(); paintSummary(); },
      }, `Remove traveller ${i + 1}`));
    }
    mount.append(card);
  });

  const paying = basket.passengers.filter((p) => p.type !== 'infant').length;
  const controls = el('div', { class: 'row row-wrap mt-4', style: 'gap:var(--sp-3)' },
    el('button', {
      type: 'button', class: 'btn btn-secondary',
      disabled: paying >= LIMITS.maxPassengers,
      onclick: () => { basket.passengers.push({ type: 'adult' }); save(); paintPassengers(); paintAssistance(); paintSummary(); },
    }, '+ Add a traveller'));

  if (paying > LIMITS.carrierMaxPassengers) {
    controls.append(el('span', { class: 'badge badge-info' },
      `Over the carrier's own online limit of ${LIMITS.carrierMaxPassengers} — kept on one reservation`));
  }
  if (paying >= LIMITS.maxPassengers) {
    controls.append(el('span', { class: 'text-soft', style: 'font-size:var(--step--2)' },
      el('a', { class: 'link-quiet', href: withTenant('groups.html') }, 'Parties this size are a group enquiry')));
  }
  mount.append(controls);

  const types = new Set(basket.passengers.map((p) => p.type));
  if (types.size > LIMITS.carrierMaxPassengerTypes) {
    mount.append(el('p', { class: 'note note-info mt-4' },
      `This party mixes ${types.size} passenger types. The carrier's own website refuses more than `
      + `${LIMITS.carrierMaxPassengerTypes} in one reservation; here they stay together.`));
  }
}

function field(id, label, opts = {}) {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { class: 'label', for: id },
    label, opts.required ? el('span', { class: 'label-hint' }, ' (required)') : null,
    opts.hint ? el('span', { class: 'label-hint' }, ` ${opts.hint}`) : null));
  const input = el('input', {
    class: 'input', id, name: id, type: opts.type || 'text',
    value: opts.value || '', autocomplete: opts.autocomplete || 'off',
    required: opts.required || null,
    oninput: (e) => { opts.oninput?.(e.target.value); save(); },
  });
  wrap.append(input);
  wrap.append(el('p', { class: 'field-error', id: `${id}-error` }));
  return wrap;
}

/* -------------------------------------------------------------------------- */

function paintAssistance() {
  const mount = qs('#assistance-fields');
  clear(mount);

  const toggle = el('label', { class: 'check' },
    el('input', {
      type: 'checkbox', checked: basket.assistance.required,
      onchange: (e) => { basket.assistance.required = e.target.checked; save(); paintAssistance(); },
    }),
    el('span', { class: 'check-text' },
      el('span', { class: 'check-title' }, 'Someone in my party needs assistance at the station or on board'),
      el('span', { class: 'check-note' },
        'Wheelchair assistance, help boarding, a service animal, or a mobility device to be carried.')));
  mount.append(toggle);

  if (!basket.assistance.required) return;

  const who = el('fieldset', { class: 'fieldset mt-4' },
    el('legend', { class: 'label' }, 'Who needs assistance'));
  basket.passengers.forEach((p, i) => {
    const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || `Traveller ${i + 1}`;
    who.append(el('label', { class: 'check' },
      el('input', {
        type: 'checkbox',
        checked: basket.assistance.travellers.includes(i),
        onchange: (e) => {
          const set = new Set(basket.assistance.travellers);
          if (e.target.checked) set.add(i); else set.delete(i);
          basket.assistance.travellers = [...set].sort();
          save();
        },
      }),
      el('span', { class: 'check-text' }, el('span', { class: 'check-title' }, name))));
  });
  mount.append(who);

  mount.append(el('p', { class: 'note note-ok mt-4' },
    'More than one traveller here is fine. The carrier\'s own website sends a party like this to a '
    + 'telephone line; this booking keeps them together.'));

  const notes = el('div', { class: 'field mt-4' },
    el('label', { class: 'label', for: 'assist-notes' }, 'What would help'),
    el('textarea', {
      class: 'textarea', id: 'assist-notes', rows: '3',
      placeholder: 'For example: wheelchair assistance from the entrance to the platform at both stations.',
      oninput: (e) => { basket.assistance.notes = e.target.value; save(); },
    }, basket.assistance.notes || ''));
  mount.append(notes);

  const stops = new Set();
  for (const sel of basket.selections) {
    const j = resolveJourney(sel.journeyRef);
    if (!j) continue;
    stops.add(Net.stations[j.legs[0].fromStn].c);
    stops.add(Net.stations[j.legs[j.legs.length - 1].toStn].c);
    for (const c of j.changes) stops.add(Net.stations[c.stn].c);
  }
  if (stops.size) {
    const box = el('fieldset', { class: 'fieldset mt-4' },
      el('legend', { class: 'label' }, 'Which stations'));
    for (const code of stops) {
      const s = station(code);
      box.append(el('label', { class: 'check' },
        el('input', {
          type: 'checkbox',
          checked: basket.assistance.stations.includes(code),
          onchange: (e) => {
            const set = new Set(basket.assistance.stations);
            if (e.target.checked) set.add(code); else set.delete(code);
            basket.assistance.stations = [...set];
            save();
          },
        }),
        el('span', { class: 'check-text' },
          el('span', { class: 'check-title' }, s ? s.n : code),
          el('span', { class: 'check-note' }, s ? `${s.c} · ${s.y}, ${s.s}` : ''))));
    }
    box.append(el('p', { class: 'field-help' },
      'Assistance is provided by the carrier and varies by station. We pass the request on with the booking.'));
    mount.append(box);
  }
}

function paintExtras() {
  const mount = qs('#extras');
  clear(mount);
  const items = [
    ['checkedBags', 'Checked bags', 'Carried in the baggage car on services that offer it.'],
    ['bikes', 'Bicycles', 'Space is limited and not available on every service.'],
    ['pets', 'Pets', 'Dogs and cats in a carrier, on services that allow them.'],
  ];
  for (const [key, label, note] of items) {
    const wrap = el('div', { class: 'field' });
    const id = `extra-${key}`;
    wrap.append(el('label', { class: 'label', for: id }, label));
    wrap.append(el('input', {
      class: 'input', id, type: 'number', min: '0', max: '4', inputmode: 'numeric',
      value: String(basket.extras[key] || 0),
      oninput: (e) => { basket.extras[key] = Math.max(0, Math.min(4, Number(e.target.value) || 0)); save(); },
    }));
    wrap.append(el('p', { class: 'field-help' }, note));
    mount.append(wrap);
  }
}

function mirrorContact(index) {
  if (index !== 0 || contactTouched) return;
  const lead = basket.passengers[0];
  basket.contact.firstName = lead.firstName || '';
  basket.contact.lastName = lead.lastName || '';
  const first = qs('#c-first');
  const last = qs('#c-last');
  if (first) first.value = basket.contact.firstName;
  if (last) last.value = basket.contact.lastName;
}

function paintContact() {
  const mount = qs('#contact');
  clear(mount);
  const c = basket.contact;
  if (!contactTouched && basket.passengers[0]?.firstName) {
    c.firstName = basket.passengers[0].firstName;
    c.lastName = basket.passengers[0].lastName || '';
  }
  mount.append(field('c-first', 'First name', {
    value: c.firstName, autocomplete: 'given-name', required: true,
    hint: '— copied from traveller 1 until you change it',
    oninput: (v) => { c.firstName = v; contactTouched = true; },
  }));
  mount.append(field('c-last', 'Last name', {
    value: c.lastName, autocomplete: 'family-name', required: true,
    oninput: (v) => { c.lastName = v; contactTouched = true; },
  }));
  mount.append(field('c-email', 'Email', {
    value: c.email, type: 'email', autocomplete: 'email', required: true,
    hint: '— the ticket goes here', oninput: (v) => { c.email = v; },
  }));
  mount.append(field('c-phone', 'Phone', {
    value: c.phone, type: 'tel', autocomplete: 'tel', hint: 'optional', oninput: (v) => { c.phone = v; },
  }));
}

/* -------------------------------------------------------------------------- */

function pricedLines() {
  const provider = getProvider();
  const lines = [];
  for (const sel of basket.selections) {
    const journey = resolveJourney(sel.journeyRef);
    if (!journey) continue;
    const ctx = ctxFor(sel);
    const quote = provider.quoteSync(journey, ctx).find((q) => q.product === sel.product);
    if (!quote) continue;
    lines.push(priceLine({
      quote, journey,
      party: { passengers: basket.passengers, units: roomsNeeded(sel) },
      policy: Theme.tenant.policy,
      promo: basket.promo,
    }));
  }
  return priceBasket(lines);
}

function ctxFor(sel) {
  const journey = resolveJourney(sel.journeyRef);
  const d = new Date(journey.depInstant);
  const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const daysAhead = Math.max(0, Math.round((journey.depInstant - Date.now()) / 86400000));
  return { ymd, daysAhead, dow: d.getDay() };
}

function roomsNeeded(sel) {
  const product = PRODUCTS[sel.product];
  if (product?.kind !== 'room') return 1;
  const paying = basket.passengers.filter((p) => p.type !== 'infant').length;
  return Math.max(1, Math.ceil(paying / (product.sleeps || 2)));
}

function paintSummary() {
  const mount = qs('#summary');
  clear(mount);
  mount.append(el('h2', { style: 'font-size:var(--step-0)' }, 'Your trip'));

  for (const sel of basket.selections) {
    const j = resolveJourney(sel.journeyRef);
    if (!j) continue;
    const a = Net.stations[j.legs[0].fromStn];
    const b = Net.stations[j.legs[j.legs.length - 1].toStn];
    mount.append(el('div', { class: 'mt-4', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
      el('div', { class: 'row row-between' },
        el('strong', { style: 'font-size:var(--step--1)' }, sel.label),
        el('span', { class: 'badge' }, sel.productName)),
      el('div', { class: 'mt-2', style: 'font-size:var(--step--1)' }, `${a.n} → ${b.n}`),
      el('div', { class: 'text-soft mono', style: 'font-size:var(--step--2)' },
        `${clockAt(j.depInstant, a)} – ${clockAt(j.arrInstant, b)} · ${duration(j.durationMin)}`)));
  }

  const priced = pricedLines();
  mount.append(el('table', { class: 'breakdown mt-6' },
    el('tbody', {},
      el('tr', {}, el('td', {}, 'Carrier fare'), el('td', {}, money(priced.carrierNet))),
      el('tr', {}, el('td', {}, Theme.tenant.policy.serviceChargeLabel), el('td', {}, money(priced.markup))),
      el('tr', { class: 'row-total' }, el('td', {}, 'Total'), el('td', {}, money(priced.total, { showBase: true }))))));

  mount.append(el('p', { class: 'text-mute mt-4', style: 'font-size:var(--step--2)' },
    'Fares on this demonstration are simulated.'));
}

function save() { saveBasket(basket); }

/* -------------------------------------------------------------------------- */

qs('#book-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = qs('#form-error');
  err.textContent = '';
  document.querySelectorAll('.field-error').forEach((n) => { n.textContent = ''; });
  document.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));

  const pErrors = validatePassengers(basket.passengers);
  const cErrors = validateContact(basket.contact);

  let firstBad = null;
  for (const [key, message] of Object.entries(pErrors)) {
    const m = key.match(/^p(\d+)\.(firstName|lastName)$/);
    if (!m) continue;
    const id = `p${m[1]}-${m[2] === 'firstName' ? 'first' : 'last'}`;
    setFieldError(id, message);
    firstBad = firstBad || id;
  }
  for (const [key, message] of Object.entries(cErrors)) {
    const id = { firstName: 'c-first', lastName: 'c-last', email: 'c-email' }[key];
    if (!id) continue;
    setFieldError(id, message);
    firstBad = firstBad || id;
  }

  const generic = pErrors.types || pErrors.party || pErrors.infants;
  if (generic) err.textContent = generic;

  if (firstBad || generic) {
    if (firstBad) qs(`#${firstBad}`)?.focus();
    else err.scrollIntoView({ block: 'center' });
    return;
  }

  save();
  location.href = withTenant('payment.html');
});

function setFieldError(id, message) {
  const input = qs(`#${id}`);
  const box = qs(`#${id}-error`);
  if (box) box.textContent = message;
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${id}-error`);
  }
}
