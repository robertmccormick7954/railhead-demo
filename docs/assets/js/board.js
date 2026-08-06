/* ==========================================================================
   Railhead — departure board
   --------------------------------------------------------------------------
   The signature element, and it is not decoration: every row is a real train
   from Amtrak's published schedule, resolved for right now, in the station's
   own timezone. It is the fastest possible answer to "is the data real".

   Characters flip in like a split-flap. The effect is skipped entirely when the
   visitor has asked for reduced motion, and the board is marked aria-hidden
   with an equivalent list exposed to assistive technology, because a grid of
   individually animating characters is hostile to a screen reader.
   ========================================================================== */

import { Net, localClock, station } from './data.js';
import { nextDepartures } from './search.js';
import { el, clear, esc } from './ui.js';
import { hour12 } from './theme.js';

const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 :-.';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function flapCell(finalText, { delay = 0, animate = true } = {}) {
  const wrap = document.createDocumentFragment();
  [...finalText].forEach((ch, i) => {
    const span = el('span', { class: ch === ' ' ? 'flap flap-blank' : 'flap' }, ch);
    if (animate) {
      const target = ch.toUpperCase();
      let ticks = 3 + ((i * 7) % 6);
      const timer = setInterval(() => {
        if (ticks-- <= 0) {
          clearInterval(timer);
          span.textContent = ch;
          return;
        }
        span.textContent = FLAP_CHARS[(Math.random() * FLAP_CHARS.length) | 0];
      }, 45);
      setTimeout(() => { clearInterval(timer); span.textContent = ch; }, delay + 420 + i * 18);
    }
    wrap.append(span);
  });
  return wrap;
}

function pad(text, width) {
  const s = String(text).toUpperCase().slice(0, width);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

/**
 * @param {HTMLElement} mount
 * @param {object} opts {stationCode, rows}
 */
export function mountBoard(mount, { stationCode = 'NYP', rows = 6 } = {}) {
  const stn = station(stationCode);
  if (!stn) return null;

  const head = el('div', { class: 'board-head' },
    el('span', {}, `${stn.n} · Departures`),
    el('span', { class: 'board-clock', id: 'board-clock' }, ''));
  const body = el('div', {});
  const live = el('ul', { class: 'visually-hidden' });

  clear(mount);
  mount.append(head, el('div', { 'aria-hidden': 'true' }, body), live);

  const state = { stationCode, rows };

  function paint({ animate = true } = {}) {
    const stationNow = station(state.stationCode);
    const deps = nextDepartures(stationNow.i, Date.now(), state.rows);
    head.firstChild.textContent = `${stationNow.n} · Departures`;

    clear(body);
    clear(live);

    if (!deps.length) {
      body.append(el('div', { class: 'board-row' },
        el('span', { style: 'grid-column:1/-1' }, 'NO FURTHER DEPARTURES TODAY')));
      live.append(el('li', {}, `No further departures from ${stationNow.n} today.`));
      return;
    }

    // A narrow board cannot hold a 20-character destination without the flaps
    // spilling out of the grid cell.
    const destWidth = mount.clientWidth < 470 ? 12 : 20;
    deps.forEach((d, i) => {
      const time = localClock(d.instant, stationNow.tz, hour12()).replace(/\s/g, ' ');
      const last = d.trip.stops[d.trip.stops.length - 1];
      const dest = Net.stations[last.s].n;
      const row = el('div', { class: 'board-row' });
      const delay = i * 90;

      const c1 = el('span', { class: 'board-col-time' });
      c1.append(flapCell(pad(time, 8), { delay, animate }));
      const c2 = el('span', { class: 'board-col-train' });
      c2.append(flapCell(pad(d.trip.num || '--', 4), { delay: delay + 60, animate }));
      const c3 = el('span', { class: 'board-col-dest' });
      c3.append(flapCell(pad(dest, destWidth), { delay: delay + 110, animate }));
      const c4 = el('span', { class: 'board-col-status' });
      c4.append(flapCell(pad('ON TIME', 7), { delay: delay + 170, animate }));

      row.append(c1, c2, c3, c4);
      body.append(row);

      live.append(el('li', {},
        `${time} to ${dest}, ${d.trip.route.n} ${d.trip.num || ''}`.trim()));
    });
  }

  function tickClock() {
    const stationNow = station(state.stationCode);
    const now = Date.now();
    const t = localClock(now, stationNow.tz, hour12());
    const clockEl = head.querySelector('#board-clock');
    if (clockEl) clockEl.textContent = t;
  }

  paint({ animate: !reduced.matches });
  tickClock();
  const clockTimer = setInterval(tickClock, 20000);
  const repaintTimer = setInterval(() => paint({ animate: !reduced.matches }), 120000);

  return {
    setStation(code) {
      if (!station(code)) return;
      state.stationCode = code;
      paint({ animate: !reduced.matches });
      tickClock();
    },
    destroy() { clearInterval(clockTimer); clearInterval(repaintTimer); },
  };
}
