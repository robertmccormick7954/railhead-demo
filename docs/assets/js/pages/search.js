/* Results: journeys, the fare ladder, the price calendar, and selection. */

import { page, el, clear, qs, qsa, duration, clockAt, toast } from '../ui.js';
import { Net, station, dateFromYmd, ymdOf, addDays, localYmd, dayOffset, zoneAbbr, serviceLabel } from '../data.js';
import { findJourneys, priceCalendar, CONNECT } from '../search.js';
import { getProvider, priceLine, PRODUCTS, leadPrice } from '../fares.js';
import { money, formatDate, Theme, distance } from '../theme.js';
import { mountSearchForm } from '../searchform.js';
import { loadBasket, saveBasket, journeyRef, tooCloseToDeparture, LIMITS } from '../booking.js';

await page({ active: 'book', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

const params = new URLSearchParams(location.search);
const basket = loadBasket();
const provider = getProvider();

const query = {
  from: params.get('from') || basket.legs[0]?.from || '',
  to: params.get('to') || basket.legs[0]?.to || '',
  ymd: Number(params.get('date')) || basket.legs[0]?.date || ymdOf(addDays(new Date(), 14)),
  mode: params.get('mode') || basket.mode || 'oneway',
  returnYmd: Number(params.get('return')) || basket.legs[0]?.returnDate || 0,
};

/* Which leg of the trip we are choosing right now. For a return trip the second
   pass runs with origin and destination swapped. */
let phase = 0;
const legPlan = buildLegPlan();

function buildLegPlan() {
  if (query.mode === 'multi' && basket.legs.length > 1) {
    return basket.legs.map((l, i) => ({ from: l.from, to: l.to, ymd: l.date, label: `Leg ${i + 1}` }));
  }
  const out = [{ from: query.from, to: query.to, ymd: query.ymd, label: 'Outbound' }];
  if (query.mode === 'return' && query.returnYmd) {
    out.push({ from: query.to, to: query.from, ymd: query.returnYmd, label: 'Return' });
  }
  return out;
}

const filters = { directOnly: false, morning: false, afternoon: false, evening: false, accessible: false };
let sortBy = 'dep';
let journeys = [];

mountSearchForm(qs('#search-mount'), {
  mode: query.mode,
  legs: basket.legs.length ? basket.legs : [{ from: query.from, to: query.to, date: query.ymd, returnDate: query.returnYmd }],
  passengers: basket.passengers,
  action: 'search.html',
});

paintStepper();
paintFilters();
run();

/* -------------------------------------------------------------------------- */

function paintStepper() {
  const steps = ['Choose trains', 'Travellers', 'Payment', 'Confirmation'];
  const mount = qs('#stepper');
  clear(mount);
  steps.forEach((label, i) => {
    mount.append(el('li', { class: `step ${i === 0 ? 'step-now' : ''}`, 'aria-current': i === 0 ? 'step' : null },
      el('span', { class: 'step-num' }, String(i + 1)), label));
  });
}

function currentLeg() { return legPlan[phase]; }

function ctxFor(ymd) {
  const daysAhead = Math.max(0, Math.round((dateFromYmd(ymd) - new Date()) / 86400000));
  return { ymd, daysAhead, dow: dateFromYmd(ymd).getDay() };
}

function run() {
  const leg = currentLeg();
  const a = station(leg.from);
  const b = station(leg.to);
  const summary = qs('#results-summary');

  if (!a || !b) {
    summary.textContent = '';
    renderEmpty('Choose where you are travelling from and to.', 'The search above needs both a start and an end.');
    return;
  }

  const result = findJourneys({ from: leg.from, to: leg.to, ymd: leg.ymd, maxTransfers: 2, limit: 60 });
  journeys = result.journeys || [];

  summary.textContent = `${leg.label} · ${a.n} to ${b.n} · `
    + formatDate(leg.ymd, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    + ` · ${basket.passengers.length} ${basket.passengers.length === 1 ? 'traveller' : 'travellers'}`;

  paintCalendar(leg);
  paintResults();
  paintBasket();
}

function paintFilters() {
  const mount = qs('#filters');
  clear(mount);
  const box = el('div', { class: 'row row-wrap', style: 'gap:var(--sp-2)' });

  const toggles = [
    ['directOnly', 'Direct only'],
    ['morning', 'Morning'],
    ['afternoon', 'Afternoon'],
    ['evening', 'Evening'],
    ['accessible', 'Has an accessible room'],
  ];
  for (const [key, label] of toggles) {
    box.append(el('button', {
      type: 'button', class: 'search-mode', 'aria-pressed': String(filters[key]),
      style: 'border:1px solid var(--rule)',
      onclick: (e) => {
        filters[key] = !filters[key];
        e.currentTarget.setAttribute('aria-pressed', String(filters[key]));
        paintResults();
      },
    }, label));
  }
  mount.append(el('h2', { class: 'visually-hidden' }, 'Filter results'), box);
}

function passes(j) {
  if (filters.directOnly && j.transfers > 0) return false;
  const hour = new Date(j.depInstant).getHours();
  const anyTime = filters.morning || filters.afternoon || filters.evening;
  if (anyTime) {
    const ok = (filters.morning && hour < 12) || (filters.afternoon && hour >= 12 && hour < 18)
            || (filters.evening && hour >= 18);
    if (!ok) return false;
  }
  if (filters.accessible) {
    const quotes = provider.quoteSync(j, ctxFor(currentLeg().ymd));
    if (!quotes.some((q) => q.product === 'access' && q.available)) return false;
  }
  return true;
}

function paintResults() {
  const mount = qs('#results');
  clear(mount);

  const leg = currentLeg();
  const ctx = ctxFor(leg.ymd);
  let list = journeys.filter(passes).filter((j) => !tooCloseToDeparture(j.depInstant));

  if (sortBy === 'dur') list = list.slice().sort((a, b) => a.durationMin - b.durationMin);
  else if (sortBy === 'price') {
    list = list.slice().sort((a, b) => (leadPrice(a, ctx, Theme.tenant.policy) ?? 1e9) - (leadPrice(b, ctx, Theme.tenant.policy) ?? 1e9));
  } else list = list.slice().sort((a, b) => a.depInstant - b.depInstant);

  if (!list.length) {
    const anyAtAll = journeys.length > 0;
    renderEmpty(
      anyAtAll ? 'No trains match those filters' : 'No trains on this date',
      anyAtAll
        ? 'Clear a filter, or try the next day.'
        : 'This pair may not have a through service every day. Try a nearby date, or search a larger nearby station.');
    return;
  }

  for (const j of list) mount.append(resultCard(j, ctx));
}

function renderEmpty(title, body) {
  const mount = qs('#results');
  clear(mount);
  mount.append(el('div', { class: 'empty card' },
    el('p', { class: 'empty-title' }, title),
    el('p', {}, body),
    el('div', { class: 'empty-actions' },
      el('button', {
        class: 'btn btn-secondary', type: 'button',
        onclick: () => { const l = currentLeg(); l.ymd = ymdOf(addDays(dateFromYmd(l.ymd), 1)); run(); },
      }, 'Try the next day'))));
}

function resultCard(j, ctx) {
  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  const a = Net.stations[first.fromStn];
  const b = Net.stations[last.toStn];
  const price = leadPrice(j, ctx, Theme.tenant.policy);

  const dayShift = dayOffset(localYmd(j.depInstant, a.tz), localYmd(j.arrInstant, b.tz));

  const card = el('article', { class: 'result' });
  const main = el('div', { class: 'result-main' });

  const times = el('div', { class: 'result-times' },
    el('div', {},
      el('div', { class: 'result-time' }, clockAt(j.depInstant, a)),
      el('div', { class: 'result-stn' }, a.c)),
    runGraphic(j),
    el('div', {},
      el('div', { class: 'result-time' },
        clockAt(j.arrInstant, b),
        dayShift ? el('sup', { class: 'text-accent', style: 'font-size:.6em;margin-left:2px' }, `+${dayShift}`) : null),
      el('div', { class: 'result-stn' }, b.c)));

  const meta = el('div', { class: 'result-meta' });
  meta.append(el('span', { class: 'badge' }, duration(j.durationMin)));
  for (const l of j.legs) {
    meta.append(el('span', { class: l.trip.route.mode === 'bus' ? 'badge badge-info' : 'badge badge-brand' },
      serviceLabel(l.trip)));
  }
  if (j.isFastest) meta.append(el('span', { class: 'badge badge-accent' }, 'Fastest'));
  if (j.changes.some((c) => c.tight)) meta.append(el('span', { class: 'badge badge-warn' }, 'Tight connection'));
  if (j.modes.includes('bus')) meta.append(el('span', { class: 'badge badge-info' }, 'Includes a coach leg'));

  const left = el('div', {}, times, meta);

  const fares = el('div', { class: 'result-fares', hidden: true });
  const toggle = el('button', {
    type: 'button', class: 'btn', 'aria-expanded': 'false',
    onclick: () => {
      const open = fares.hidden;
      qsa('.result', qs('#results')).forEach((n) => {
        if (n !== card) {
          n.classList.remove('is-open');
          const f = qs('.result-fares', n);
          const t = qs('button[aria-expanded]', n);
          if (f) f.hidden = true;
          if (t) t.setAttribute('aria-expanded', 'false');
        }
      });
      fares.hidden = !open;
      card.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open && !fares.dataset.built) { buildFares(fares, j, ctx); fares.dataset.built = '1'; }
    },
  }, 'Select');

  const right = el('div', { class: 'result-price' },
    el('span', { class: 'result-price-from' }, 'From'),
    el('span', { class: 'result-price-value' }, price == null ? '—' : money(price)),
    el('div', { class: 'mt-4' }, toggle));

  main.append(left, right);
  card.append(main, fares);
  return card;
}

function runGraphic(j) {
  const wrap = el('div', { class: 'result-run' });
  wrap.append(el('span', { class: 'result-node result-node-start' }));
  wrap.append(el('span', { class: 'result-run-label' },
    j.transfers === 0 ? 'Direct' : `${j.transfers} change${j.transfers > 1 ? 's' : ''}`));
  wrap.append(el('span', { class: 'result-node result-node-end' }));
  return wrap;
}

function buildFares(mount, j, ctx) {
  clear(mount);

  mount.append(itineraryDetail(j));

  const quotes = provider.quoteSync(j, ctx);
  const grid = el('div', { class: 'fare-grid mt-6' });

  for (const q of quotes) {
    const product = PRODUCTS[q.product];
    const line = priceLine({
      quote: q, journey: j,
      party: { passengers: basket.passengers, units: 1 },
      policy: Theme.tenant.policy,
    });

    const card = el('button', {
      type: 'button',
      class: `fare${q.available ? '' : ' fare-sold'}`,
      'aria-pressed': 'false',
      disabled: !q.available,
      onclick: () => select(j, q, line),
    },
      el('span', { class: 'row row-between', style: 'gap:var(--sp-2)' },
        el('span', { class: 'fare-name' }, product.name),
        product.kind === 'room' ? el('span', { class: 'badge' }, 'Per room') : null),
      el('span', { class: 'fare-price' }, q.available ? money(line.total) : 'Sold out'),
      el('span', { class: 'text-mute', style: 'font-size:var(--step--2)' },
        q.available
          ? (product.kind === 'room'
              ? `Sleeps up to ${product.sleeps} · ${q.remaining} left`
              : `${basket.passengers.length} ${basket.passengers.length === 1 ? 'traveller' : 'travellers'} · ${q.remaining} left`)
          : 'No availability at this fare'),
      el('ul', { class: 'fare-rules' }, product.rules.map((r) => el('li', {}, el('span', { 'aria-hidden': 'true' }, '·'), r))));
    grid.append(card);
  }

  mount.append(grid);
  mount.append(el('p', { class: 'note note-info mt-6', style: 'font-size:var(--step--2)' },
    el('strong', {}, 'Fares on this demonstration are simulated. '),
    'Schedules are the carrier\'s real published timetable; the carrier publishes no public fare data, so prices ',
    'here are generated by a labelled model behind a swappable provider. ',
    el('a', { class: 'link-quiet', href: 'architecture.html' }, 'How pricing would connect')));
}

function itineraryDetail(j) {
  const wrap = el('div', {});
  wrap.append(el('h3', { style: 'font-size:var(--step-0)' }, 'Your journey'));
  const list = el('ol', { class: 'legs mt-4' });

  j.legs.forEach((leg, i) => {
    const from = Net.stations[leg.fromStn];
    const to = Net.stations[leg.toStn];

    list.append(el('li', { class: 'leg' },
      el('div', { class: 'leg-time' }, clockAt(leg.depInstant, from)),
      el('div', { class: 'leg-rail' }, el('span', { class: 'leg-dot' })),
      el('div', { class: 'leg-body' },
        el('div', { class: 'leg-station' }, from.n),
        el('div', { class: 'leg-detail' }, `${from.y}, ${from.s} · ${zoneAbbr(leg.depInstant, from.tz)}`),
        el('div', { class: 'leg-service' },
          el('strong', {}, serviceLabel(leg.trip)),
          el('span', { class: 'text-soft' },
            `${duration(Math.round((leg.arrInstant - leg.depInstant) / 60000))} · ${distance(leg.miles)}`),
          leg.trip.route.mode === 'bus' ? el('span', { class: 'badge badge-info' }, 'Coach') : null),
        stopsDisclosure(leg))));

    list.append(el('li', { class: 'leg' },
      el('div', { class: 'leg-time leg-time-arr' }, clockAt(leg.arrInstant, to)),
      el('div', { class: 'leg-rail' },
        el('span', { class: i === j.legs.length - 1 ? 'leg-dot' : 'leg-dot leg-dot-change' })),
      el('div', { class: 'leg-body' },
        el('div', { class: 'leg-station' }, to.n),
        el('div', { class: 'leg-detail' }, `${to.y}, ${to.s} · ${zoneAbbr(leg.arrInstant, to.tz)}`),
        j.changes[i]
          ? el('div', { class: `leg-change${j.changes[i].tight ? ' leg-change-tight' : ''}` },
              `Change here · ${duration(j.changes[i].waitMin)} between trains`
              + (j.changes[i].tight ? ' · tight, but within our minimum' : ''))
          : null)));
  });

  wrap.append(list);
  if (j.transfers > 0) {
    wrap.append(el('p', { class: 'text-mute mt-4', style: 'font-size:var(--step--2)' },
      `Minimum connection times: ${CONNECT.standard} minutes normally, ${CONNECT.hub} at the busiest stations, `
      + `${CONNECT.longDistance} where a long-distance train is involved.`));
  }
  return wrap;
}

function stopsDisclosure(leg) {
  const stops = leg.trip.stops.slice(leg.fromPos + 1, leg.toPos);
  if (!stops.length) return null;
  const list = el('ul', { class: 'stops-list', hidden: true });
  for (const s of stops) {
    const stn = Net.stations[s.s];
    list.append(el('li', { class: 'text-soft', style: 'font-size:var(--step--2)' },
      el('span', { class: 'mono' }, stn.c), ' ', stn.n));
  }
  const btn = el('button', {
    type: 'button', class: 'stops-toggle', 'aria-expanded': 'false',
    onclick: (e) => {
      const open = list.hidden;
      list.hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
      e.currentTarget.textContent = open ? 'Hide calling points' : `${stops.length} stops on the way`;
    },
  }, `${stops.length} stops on the way`);
  return el('div', {}, btn, list);
}

/* -------------------------------------------------------------------------- */

function select(journey, quote, line) {
  const b = loadBasket();
  b.selections = b.selections.filter((s) => s.phase !== phase);
  b.selections.push({
    phase,
    label: currentLeg().label,
    journeyRef: journeyRef(journey),
    product: quote.product,
    productName: PRODUCTS[quote.product].name,
    unit: quote.unit,
    netPerUnit: quote.netPerUnit,
    total: line.total,
  });
  b.selections.sort((x, y) => x.phase - y.phase);
  b.passengers = basket.passengers;
  b.mode = query.mode;
  saveBasket(b);
  basket.selections = b.selections;

  if (phase < legPlan.length - 1) {
    phase += 1;
    toast(`${legPlan[phase - 1].label} selected. Now choose your ${legPlan[phase].label.toLowerCase()}.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    run();
  } else {
    const tenant = new URLSearchParams(location.search).get('tenant');
    location.href = 'book.html' + (tenant ? `?tenant=${tenant}` : '');
  }
}

function paintBasket() {
  const mount = qs('#basket');
  clear(mount);
  mount.append(el('h2', { style: 'font-size:var(--step-0)' }, 'Your trip'));

  if (!basket.selections.length) {
    mount.append(el('p', { class: 'text-soft mt-4', style: 'font-size:var(--step--1)' },
      'Pick a train and a fare. Your choices collect here.'));
  } else {
    for (const sel of basket.selections) {
      mount.append(el('div', { class: 'mt-4', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
        el('div', { class: 'row row-between' },
          el('strong', { style: 'font-size:var(--step--1)' }, sel.label),
          el('span', { class: 'money' }, money(sel.total))),
        el('div', { class: 'text-soft', style: 'font-size:var(--step--2)' }, sel.productName)));
    }
    const total = basket.selections.reduce((n, s) => n + s.total, 0);
    mount.append(el('div', { class: 'row row-between mt-6', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
      el('strong', {}, 'Total so far'), el('span', { class: 'money', style: 'font-size:var(--step-1)' }, money(total))));
  }

  mount.append(el('p', { class: 'text-mute mt-6', style: 'font-size:var(--step--2)' },
    `Choosing ${currentLeg().label.toLowerCase()} of ${legPlan.length}.`));
}

/* Cheapest-date strip. The carrier's own site has no equivalent view. */
function paintCalendar(leg) {
  const wrap = qs('#calendar-wrap');
  const mount = qs('#calendar');
  clear(mount);

  const start = ymdOf(addDays(dateFromYmd(leg.ymd), -3));
  const today = ymdOf(new Date());
  const from = start < today ? today : start;

  const days = priceCalendar(leg.from, leg.to, from, 9, (j, ymd) => {
    const daysAhead = Math.max(0, Math.round((dateFromYmd(ymd) - new Date()) / 86400000));
    return leadPrice(j, { ymd, daysAhead, dow: dateFromYmd(ymd).getDay() }, Theme.tenant.policy);
  });

  const priced = days.filter((d) => d.price != null);
  if (priced.length < 2) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const min = Math.min(...priced.map((d) => d.price));

  for (const d of days) {
    const isNow = d.ymd === leg.ymd;
    const cheapest = d.price != null && d.price === min;
    const tenant = new URLSearchParams(location.search).get('tenant');
    const p = new URLSearchParams({ from: leg.from, to: leg.to, date: String(d.ymd), mode: query.mode });
    if (query.returnYmd) p.set('return', String(query.returnYmd));
    if (tenant) p.set('tenant', tenant);

    mount.append(el('a', {
      class: 'card',
      href: d.price == null ? null : `search.html?${p}`,
      'aria-current': isNow ? 'true' : null,
      style: 'text-align:center;min-width:96px;text-decoration:none;padding:var(--sp-3)'
        + (isNow ? ';border-color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand)' : '')
        + (d.price == null ? ';opacity:.55' : ''),
    },
      el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' },
        formatDate(d.ymd, { weekday: 'short' })),
      el('div', { style: 'font-weight:600;font-size:var(--step--1)' },
        formatDate(d.ymd, { day: 'numeric', month: 'short' })),
      el('div', { class: 'money mt-2', style: cheapest ? 'color:var(--accent-text)' : '' },
        d.price == null ? 'No service' : money(d.price)),
      cheapest ? el('span', { class: 'badge badge-accent mt-2' }, 'Lowest') : null));
  }
}

qs('#sort').addEventListener('change', (e) => { sortBy = e.target.value; paintResults(); });
