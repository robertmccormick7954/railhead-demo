/* Home: departure board, search widget, and the feed-provenance panel. */

import { page, el, clear, qs, duration } from '../ui.js';
import { Net, station, dateFromYmd } from '../data.js';
import { mountBoard } from '../board.js';
import { mountSearchForm } from '../searchform.js';
import { findJourneys } from '../search.js';
import { leadPrice } from '../fares.js';
import { money, Theme } from '../theme.js';
import { ymdOf, addDays } from '../data.js';

/* Stations offered for the board. Chosen by how many trains actually call, so
   the list stays right if the feed changes underneath us. */
const BOARD_CHOICES = ['NYP', 'WAS', 'CHI', 'PHL', 'LAX', 'BOS', 'SEA', 'SAC', 'ALB', 'NOL'];

/* City pairs worth showing on the front page. Not a hand-picked marketing list:
   each is checked against the live timetable below and dropped if it has no
   service, so this section cannot go stale into a lie. */
const CANDIDATE_PAIRS = [
  ['NYP', 'WAS'], ['NYP', 'BOS'], ['LAX', 'SAN'], ['CHI', 'STL'],
  ['SEA', 'PDX'], ['NYP', 'ALB'], ['WAS', 'PHL'], ['SAC', 'EMY'],
  ['CHI', 'MKE'], ['LAX', 'SBA'], ['NYP', 'PHL'], ['CHI', 'NYP'],
];

await page({ active: 'book', depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

/* ---- departure board ---- */
const boardMount = qs('#board');
const board = mountBoard(boardMount, { stationCode: 'NYP', rows: 6 });

const picker = qs('#board-station');
for (const code of BOARD_CHOICES) {
  const s = station(code);
  if (!s) continue;
  picker.append(el('option', { value: code, selected: code === 'NYP' }, `${s.n} (${code})`));
}
picker.addEventListener('change', (e) => board.setStation(e.target.value));

/* ---- search ---- */
mountSearchForm(qs('#search-mount'), { action: 'search.html' });

/* ---- popular pairs, priced against the real timetable ---- */
const routesMount = qs('#popular-routes');
const when = ymdOf(addDays(new Date(), 21));
const cards = [];

for (const [from, to] of CANDIDATE_PAIRS) {
  if (cards.length >= 6) break;
  const a = station(from);
  const b = station(to);
  if (!a || !b) continue;
  const { journeys } = findJourneys({ from, to, ymd: when, maxTransfers: 0, limit: 30 });
  if (!journeys.length) continue;

  const fastest = journeys.reduce((m, j) => (j.durationMin < m.durationMin ? j : m));
  let cheapest = null;
  for (const j of journeys.slice(0, 8)) {
    const p = leadPrice(j, { ymd: when, daysAhead: 21, dow: dateFromYmd(when).getDay() }, Theme.tenant.policy);
    if (p != null && (cheapest == null || p < cheapest)) cheapest = p;
  }

  const params = new URLSearchParams({ from, to, date: String(when), mode: 'oneway' });
  const tenant = new URLSearchParams(location.search).get('tenant');
  if (tenant) params.set('tenant', tenant);

  cards.push(el('a', { class: 'card', href: `search.html?${params}`, style: 'text-decoration:none;display:block' },
    el('div', { class: 'row row-between', style: 'gap:var(--sp-3)' },
      el('div', {},
        el('div', { style: 'font-weight:700' }, `${a.n} → ${b.n}`),
        el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' },
          `${a.c} → ${b.c} · ${a.s}${a.s !== b.s ? ' to ' + b.s : ''}`)),
      el('span', { class: 'badge badge-brand' }, `${journeys.length}/day`)),
    el('div', { class: 'row mt-4', style: 'gap:var(--sp-5)' },
      el('div', {},
        el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' }, 'Fastest'),
        el('div', { class: 'mono', style: 'font-weight:600' }, duration(fastest.durationMin))),
      cheapest != null
        ? el('div', {},
            el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' }, 'From'),
            el('div', { class: 'money', style: 'font-weight:600' }, money(cheapest)))
        : null)));
}

clear(routesMount);
if (cards.length) {
  routesMount.append(...cards);
} else {
  routesMount.append(el('p', { class: 'text-soft' }, 'No services are running on the sampled date.'));
}

/* ---- feed provenance ---- */
const meta = Net.meta || {};
const tbody = qs('#feed-table tbody');
const fmt = (ymd) => (ymd ? dateFromYmd(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const rows = [
  ['Source', 'Amtrak published GTFS'],
  ['Stations', String(meta.counts?.stations ?? '—')],
  ['Routes', `${meta.counts?.rail_routes ?? '—'} rail, ${meta.counts?.thruway_routes ?? '—'} Thruway coach`],
  ['Services', (meta.counts?.trips ?? 0).toLocaleString()],
  ['Calling points', (meta.counts?.stop_times ?? 0).toLocaleString()],
  ['Timetable to', fmt(meta.validity?.calendar_end)],
  ['Fares in feed', 'None — see architecture'],
];
const corrections = (meta.timezone_reconciliation?.corrected?.length || 0)
  + (meta.clock_normalisation?.shifted?.length || 0);
if (corrections) rows.push(['Defects corrected', `${corrections} station time errors`]);

for (const [k, v] of rows) {
  tbody.append(el('tr', {}, el('th', { scope: 'row' }, k), el('td', { class: 'num' }, v)));
}
