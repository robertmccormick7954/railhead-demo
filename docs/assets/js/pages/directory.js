/* Routes, stations and the architecture feed panel — all read from the compiled
   network, so none of them can describe a service the timetable does not have. */

import { page, el, clear, qs, duration } from '../ui.js';
import { Net, station, stateName, searchStations, dateFromYmd } from '../data.js';
import { productsForRoute } from '../fares.js';
import { loadPhotos, stationPhoto, photo, hasPhoto } from '../photos.js';

await page({
  active: document.body.dataset.nav || '',
  depth: Number(document.body.dataset.depth || 0),
  needsNetwork: true,
});

/* -------------------------------------------------------------------------- */

function routeStats() {
  const stats = new Map();
  for (const trip of Net.trips) {
    let s = stats.get(trip.routeIdx);
    if (!s) stats.set(trip.routeIdx, (s = { trips: 0, stations: new Set(), longest: 0, ends: new Map() }));
    s.trips += 1;
    for (const stop of trip.stops) s.stations.add(stop.s);
    const span = trip.stops[trip.stops.length - 1].arr - trip.stops[0].dep;
    if (span > s.longest) {
      s.longest = span;
      s.longestMiles = trip.stops[trip.stops.length - 1].mi;
      s.from = trip.stops[0].s;
      s.to = trip.stops[trip.stops.length - 1].s;
    }
  }
  return stats;
}

const CATS = [
  ['all', 'All'], ['highspeed', 'Acela'], ['nec', 'Northeast Corridor'],
  ['corridor', 'State corridor'], ['long', 'Long distance'],
  ['autotrain', 'Auto Train'], ['thruway', 'Thruway coach'], ['partner', 'Partner rail'],
];

function paintRoutes() {
  const stats = routeStats();
  const rail = Net.routes.filter((r, i) => stats.has(i));
  qs('#rt-sub').textContent =
    `${Net.routes.filter((r) => r.mode === 'rail').length} rail services and `
    + `${Net.routes.filter((r) => r.mode === 'bus').length} Thruway connecting services, `
    + 'read from the published timetable.';

  let filter = 'all';
  const filters = qs('#rt-filters');
  for (const [key, label] of CATS) {
    const n = key === 'all' ? rail.length : Net.routes.filter((r, i) => stats.has(i) && r.cat === key).length;
    if (!n) continue;
    filters.append(el('button', {
      type: 'button', class: 'search-mode', style: 'border:1px solid var(--rule)',
      'aria-pressed': String(key === filter),
      onclick: (e) => {
        filter = key;
        [...filters.children].forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
        list();
      },
    }, `${label} (${n})`));
  }

  function list() {
    const mount = qs('#rt-list');
    clear(mount);
    const rows = Net.routes
      .map((r, i) => ({ r, i, s: stats.get(i) }))
      .filter((x) => x.s && (filter === 'all' || x.r.cat === filter))
      .sort((a, b) => b.s.longestMiles - a.s.longestMiles);

    if (!rows.length) { mount.append(el('p', { class: 'text-soft' }, 'No services in that group.')); return; }

    const grid = el('div', { class: 'grid grid-2' });
    for (const { r, s } of rows) {
      const from = Net.stations[s.from];
      const to = Net.stations[s.to];
      const products = productsForRoute(r);
      const rpic = photo(`route-${r.n.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`,
        { alt: '', sizes: '(max-width:700px) 100vw, 520px' });
      grid.append(el('article', { class: 'card', style: rpic ? 'padding:0;overflow:hidden' : '' },
        rpic ? el('div', { class: 'media media-wide' }, rpic) : null,
        el('div', { style: rpic ? 'padding:var(--sp-5)' : '' },
        el('div', { class: 'row row-between row-wrap', style: 'gap:var(--sp-2)' },
          el('h2', { style: 'font-size:var(--step-1)' }, r.n),
          el('span', { class: r.mode === 'bus' ? 'badge badge-info' : 'badge badge-brand' },
            r.mode === 'bus' ? 'Coach' : catLabel(r.cat))),
        el('p', { class: 'text-soft mt-2', style: 'font-size:var(--step--1)' },
          from && to ? `${from.n} — ${to.n}` : ''),
        el('div', { class: 'row row-wrap mt-4', style: 'gap:var(--sp-5)' },
          fact('Longest run', duration(s.longest)),
          fact('Distance', `${s.longestMiles.toLocaleString()} mi`),
          fact('Stations', String(s.stations.size)),
          fact('Services', String(s.trips))),
        el('div', { class: 'row row-wrap mt-4', style: 'gap:var(--sp-2)' },
          products.map((p) => el('span', { class: 'badge' }, p.name))),
        r.res ? null : el('p', { class: 'text-mute mt-2', style: 'font-size:var(--step--2)' },
          'Unreserved — no seat is held for you.'))));
    }
    mount.append(grid);
  }
  list();
}

function catLabel(cat) {
  return ({ highspeed: 'Acela', nec: 'Northeast Corridor', corridor: 'State corridor',
    long: 'Long distance', autotrain: 'Auto Train', thruway: 'Coach', partner: 'Partner' })[cat] || cat;
}

function fact(label, value) {
  return el('div', {},
    el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' }, label),
    el('div', { class: 'mono', style: 'font-weight:600;font-size:var(--step--1)' }, value));
}

/* -------------------------------------------------------------------------- */

function paintStations() {
  qs('#st-sub').textContent =
    `${Net.stations.length} stations served by at least one train or Thruway coach.`;

  const input = qs('#st-search');
  const mount = qs('#st-list');

  function list(query) {
    clear(mount);
    const results = query
      ? searchStations(query, 40)
      : Net.stations.slice().sort((a, b) => b.w - a.w).slice(0, 40);

    if (!results.length) {
      mount.append(el('div', { class: 'empty card' },
        el('p', { class: 'empty-title' }, 'No station matches that'),
        el('p', {}, 'Try a city, a state, or a three-letter code.')));
      return;
    }

    mount.append(el('p', { class: 'text-soft mb-4', style: 'font-size:var(--step--1)' },
      query ? `${results.length} matching stations` : 'The 40 busiest stations. Search to find any of the others.'));

    const grid = el('div', { class: 'grid grid-3' });
    for (const s of results) {
      const routes = (s.r || []).map((i) => Net.routes[i]).filter(Boolean);
      const pic = stationPhoto(s.c, { alt: '', sizes: '(max-width:700px) 100vw, 340px' });
      grid.append(el('article', { class: 'card', style: pic ? 'padding:0;overflow:hidden' : '' },
        pic ? el('div', { class: 'media' }, pic) : null,
        el('div', { style: pic ? 'padding:var(--sp-5)' : '' },
        el('div', { class: 'row row-between', style: 'gap:var(--sp-2);align-items:flex-start' },
          el('h2', { style: 'font-size:var(--step-0)' }, s.n),
          el('span', { class: 'combo-option-code' }, s.c)),
        el('p', { class: 'text-soft mt-2', style: 'font-size:var(--step--1)' },
          `${s.y}, ${stateName(s.s)}`),
        s.a ? el('p', { class: 'text-mute', style: 'font-size:var(--step--2)' }, s.a) : null,
        s.f ? el('p', { class: 'text-mute', style: 'font-size:var(--step--2)' }, s.f) : null,
        el('div', { class: 'row row-wrap mt-4', style: 'gap:var(--sp-2)' },
          routes.slice(0, 4).map((r) => el('span', {
            class: r.mode === 'bus' ? 'badge badge-info' : 'badge',
          }, r.n)),
          routes.length > 4 ? el('span', { class: 'badge' }, `+${routes.length - 4}`) : null),
        el('p', { class: 'text-mute mt-4', style: 'font-size:var(--step--2)' },
          `${s.w} calls a week · ${s.tz.split('/')[1].replace('_', ' ')}`))));
    }
    mount.append(grid);
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => list(input.value.trim()), 140);
  });
  list('');
}

/* -------------------------------------------------------------------------- */

function paintFeedPanel() {
  const mount = qs('#feed-panel');
  if (!mount) return;
  const meta = Net.meta || {};
  const fmt = (ymd) => (ymd ? dateFromYmd(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  mount.append(el('h3', { style: 'font-size:var(--step-0)' }, 'The feed in this build'));
  const rows = [
    ['Publisher', meta.source?.publisher || '—'],
    ['Feed version', meta.source?.feed_version || '—'],
    ['Imported', meta.generated || '—'],
    ['Stations', String(meta.counts?.stations ?? '—')],
    ['Rail routes', String(meta.counts?.rail_routes ?? '—')],
    ['Thruway routes', String(meta.counts?.thruway_routes ?? '—')],
    ['Services', (meta.counts?.trips ?? 0).toLocaleString()],
    ['Calling points', (meta.counts?.stop_times ?? 0).toLocaleString()],
    ['Timetable from', fmt(meta.validity?.calendar_start)],
    ['Timetable to', fmt(meta.validity?.calendar_end)],
    ['Sinuosity factor', String(meta.distance_model?.factor ?? '—')],
    ['Timezones corrected', String(meta.timezone_reconciliation?.corrected?.length ?? 0)],
    ['Clocks normalised', String(meta.clock_normalisation?.shifted?.length ?? 0)],
    ['Fares in feed', 'none'],
  ];
  const table = el('table', { class: 'table mt-4' },
    el('caption', { class: 'visually-hidden' }, 'Imported feed statistics'),
    el('tbody', {}, rows.map(([k, v]) => el('tr', {},
      el('th', { scope: 'row' }, k), el('td', { class: 'num' }, v)))));
  mount.append(el('div', { class: 'table-scroll' }, table));

  const corrected = meta.timezone_reconciliation?.corrected || [];
  if (corrected.length) {
    mount.append(el('h3', { class: 'mt-6', style: 'font-size:var(--step--1)' }, 'Stations corrected'));
    mount.append(el('ul', { class: 'mt-2', style: 'padding-left:var(--sp-6);font-size:var(--step--2)' },
      corrected.map((c) => {
        const s = station(c.station);
        return el('li', {}, el('span', { class: 'mono' }, c.station), ' ',
          s ? s.n : '', ' — ', c.from.split('/')[1].replace('_', ' '),
          ' to ', c.to.split('/')[1].replace('_', ' '));
      })));
  }
}

/* Dispatch last: paintRoutes reads CATS, which is a const declared above it and
   therefore in its temporal dead zone until the module body has run. */
await loadPhotos();

const which = document.body.dataset.page;
if (which === 'routes') paintRoutes();
else if (which === 'stations') paintStations();
else if (which === 'architecture') paintFeedPanel();
