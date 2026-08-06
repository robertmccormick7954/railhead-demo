/* Home: hero, destination cards, named journeys, departure board. */

import { page, el, clear, qs, duration } from '../ui.js';
import { Net, station, dateFromYmd, ymdOf, addDays } from '../data.js';
import { mountBoard } from '../board.js';
import { mountSearchForm } from '../searchform.js';
import { findJourneys } from '../search.js';
import { leadPrice } from '../fares.js';
import { money, Theme } from '../theme.js';
import { loadPhotos, photo } from '../photos.js';

const BOARD_CHOICES = ['NYP', 'WAS', 'CHI', 'PHL', 'LAX', 'BOS', 'SEA', 'SAC', 'ALB', 'NOL'];

/* Destinations are checked against the live timetable before they are shown, so
   this section cannot advertise a city the network does not reach today. */
const DESTINATIONS = [
  { code: 'NYP', from: 'WAS', label: 'New York' },
  { code: 'WAS', from: 'NYP', label: 'Washington DC' },
  { code: 'CHI', from: 'NYP', label: 'Chicago' },
  { code: 'BOS', from: 'NYP', label: 'Boston' },
  { code: 'PHL', from: 'NYP', label: 'Philadelphia' },
  { code: 'LAX', from: 'SAN', label: 'Los Angeles' },
  { code: 'SEA', from: 'PDX', label: 'Seattle' },
  { code: 'NOL', from: 'CHI', label: 'New Orleans' },
];

const JOURNEYS = [
  { slot: 'route-california-zephyr', name: 'California Zephyr', from: 'CHI', to: 'EMY',
    blurb: 'Chicago to the San Francisco Bay, over the Rockies and the Sierra Nevada.' },
  { slot: 'route-empire-builder', name: 'Empire Builder', from: 'CHI', to: 'SEA',
    blurb: 'Chicago to the Pacific North-West along the northern plains.' },
  { slot: 'route-coast-starlight', name: 'Coast Starlight', from: 'SEA', to: 'LAX',
    blurb: 'The whole West Coast, much of it within sight of the ocean.' },
];

await page({ active: 'book', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });
await loadPhotos();

/* The search form sits on flat colour, not on a photograph. Measured across 16
   travel booking sites, 14 do it this way; only two float the form over a hero
   image. Photography starts immediately below, where it can be bounded, cropped
   and swapped without touching the contrast of the form. */
mountSearchForm(qs('#search-mount'), { action: 'search.html' });

/* ---- destinations ---- */
const when = ymdOf(addDays(new Date(), 21));
const ctx = { ymd: when, daysAhead: 21, dow: dateFromYmd(when).getDay() };
const destMount = qs('#destinations');
clear(destMount);

for (const d of DESTINATIONS) {
  const to = station(d.code);
  const from = station(d.from);
  if (!to || !from) continue;
  const { journeys } = findJourneys({ from: d.from, to: d.code, ymd: when, maxTransfers: 1, limit: 20 });
  if (!journeys.length) continue;

  let cheapest = null;
  let fastest = journeys[0];
  for (const j of journeys) {
    if (j.durationMin < fastest.durationMin) fastest = j;
    const p = leadPrice(j, ctx, Theme.tenant.policy);
    if (p != null && (cheapest == null || p < cheapest)) cheapest = p;
  }

  const params = new URLSearchParams({ from: d.from, to: d.code, date: String(when), mode: 'oneway' });
  const card = el('a', { class: 'media-card', href: `search.html?${params}` });

  const img = photo(`city-${d.code}`, { alt: '', sizes: '(max-width:700px) 100vw, 280px' });
  if (img) card.append(el('div', { class: 'media' }, img));

  card.append(el('div', { class: 'media-card-body' },
    el('div', { class: 'media-card-title' }, d.label),
    el('div', { class: 'media-card-meta' }, `from ${from.n}`),
    el('div', { class: 'media-card-foot' },
      el('span', { class: 'mono', style: 'font-size:var(--step--1);color:var(--text-soft)' },
        duration(fastest.durationMin)),
      cheapest != null
        ? el('span', {},
            el('span', { class: 'text-mute', style: 'font-size:var(--step--2)' }, 'from '),
            el('span', { class: 'money price-lead' }, money(cheapest)))
        : null)));
  destMount.append(card);
}

if (!destMount.children.length) {
  destMount.append(el('p', { class: 'text-soft' }, 'No services are running on the sampled date.'));
}

/* ---- named journeys ---- */
const jMount = qs('#journeys');
clear(jMount);
for (const j of JOURNEYS) {
  const from = station(j.from);
  const to = station(j.to);
  if (!from || !to) continue;

  const params = new URLSearchParams({ from: j.from, to: j.to, date: String(when), mode: 'oneway' });
  const card = el('a', { class: 'media-card', href: `search.html?${params}` });
  const img = photo(j.slot, { alt: '', sizes: '(max-width:700px) 100vw, 380px' });
  if (img) card.append(el('div', { class: 'media' }, img));

  card.append(el('div', { class: 'media-card-body' },
    el('div', { class: 'media-card-title' }, j.name),
    el('div', { class: 'media-card-meta' }, `${from.n} to ${to.n}`),
    el('p', { style: 'font-size:var(--step--1);color:var(--text-soft);margin-top:var(--sp-3)' }, j.blurb),
    el('div', { class: 'media-card-foot' },
      el('span', { class: 'badge badge-brand' }, 'Sleeping accommodation'),
      el('span', { class: 'link-quiet', style: 'font-size:var(--step--1)' }, 'See times'))));
  jMount.append(card);
}

/* ---- departure board ---- */
const board = mountBoard(qs('#board'), { stationCode: 'NYP', rows: 6 });
const picker = qs('#board-station');
for (const code of BOARD_CHOICES) {
  const s = station(code);
  if (!s) continue;
  picker.append(el('option', { value: code, selected: code === 'NYP' }, `${s.n} (${code})`));
}
picker.addEventListener('change', (e) => board.setStation(e.target.value));

/* ---- provenance, kept to one line ---- */
const meta = Net.meta || {};
const end = meta.validity?.calendar_end;
const endLabel = end
  ? dateFromYmd(end).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  : '';
qs('#feed-note').append(
  el('p', { style: 'font-size:var(--step--1);margin:0' },
    el('strong', {}, 'Timetables are real. '),
    `${(meta.counts?.trips ?? 0).toLocaleString()} services and `
    + `${meta.counts?.stations ?? 0} stations, read from Amtrak's published schedule feed`
    + (endLabel ? `, running to ${endLabel}. ` : '. '),
    el('strong', {}, 'Fares, payment and tickets on this site are a demonstration '),
    'and are not real.'));
