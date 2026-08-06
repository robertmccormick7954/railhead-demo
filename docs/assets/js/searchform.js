/* ==========================================================================
   Railhead — the search widget
   Used on the home page and again, in compact form, above the results. One
   implementation, so the two can never disagree about what is bookable.

   Modes: one way, return, and multi-city. Multi-city is here because the
   carrier's own website caps a multi-city itinerary at five segments and this
   one does not — see LIMITS in booking.js.
   ========================================================================== */

import { el, clear, qs, StationCombobox, ymdInput, inputYmd, toast } from './ui.js';
import { station, ymdOf, addDays, dateFromYmd } from './data.js';
import { LIMITS, validateSearchDate, loadBasket, saveBasket } from './booking.js';
import { PASSENGER_TYPES } from './fares.js';

const MODES = [
  { key: 'oneway', label: 'One way' },
  { key: 'return', label: 'Return' },
  { key: 'multi', label: 'Multi-city' },
];

export function mountSearchForm(mount, opts = {}) {
  const basket = loadBasket();
  const state = {
    mode: opts.mode || basket.mode || 'return',
    legs: opts.legs?.length ? opts.legs : (basket.legs?.length ? basket.legs : [defaultLeg()]),
    passengers: opts.passengers || basket.passengers || [{ type: 'adult' }],
  };

  clear(mount);
  const form = el('form', { class: 'search-panel', novalidate: true, 'aria-label': 'Find trains' });
  const modeBar = el('div', { class: 'search-modes', role: 'group', 'aria-label': 'Trip type' });
  const fields = el('div', {});
  const errorBox = el('div', { class: 'field-error mt-4', role: 'alert', style: 'display:none' });

  form.append(modeBar, fields, errorBox);
  mount.append(form);

  const combos = [];

  function defaultLeg() {
    return { from: '', to: '', date: ymdOf(addDays(new Date(), 14)), returnDate: ymdOf(addDays(new Date(), 21)) };
  }

  function paintModes() {
    clear(modeBar);
    for (const m of MODES) {
      modeBar.append(el('button', {
        type: 'button',
        class: 'search-mode',
        'aria-pressed': String(state.mode === m.key),
        onclick: () => {
          state.mode = m.key;
          if (m.key === 'multi' && state.legs.length < 2) {
            state.legs = [state.legs[0], { ...defaultLeg(), from: state.legs[0].to || '', to: '' }];
          }
          if (m.key !== 'multi') state.legs = [state.legs[0]];
          paint();
        },
      }, m.label));
    }
  }

  function passengerControl() {
    const wrap = el('div', { class: 'field' });
    const id = 'pax-summary';
    const total = state.passengers.length;
    const detail = countByType(state.passengers);

    wrap.append(el('label', { class: 'label', for: id }, 'Travellers'));
    const btn = el('button', {
      type: 'button', id, class: 'input', style: 'text-align:left;cursor:pointer',
      'aria-expanded': 'false', 'aria-controls': 'pax-panel',
    }, `${total} ${total === 1 ? 'traveller' : 'travellers'}${detail ? ` · ${detail}` : ''}`);

    const panel = el('div', {
      id: 'pax-panel', class: 'card mt-4', hidden: true,
      style: 'position:absolute;z-index:60;min-width:290px;box-shadow:var(--shadow-3)',
    });

    function paintPanel() {
      clear(panel);
      for (const type of PASSENGER_TYPES) {
        const n = state.passengers.filter((p) => p.type === type.key).length;
        const row = el('div', { class: 'row row-between', style: 'gap:var(--sp-4)' },
          el('div', {},
            el('div', { style: 'font-weight:600;font-size:var(--step--1)' }, type.name),
            el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' }, type.ageNote)),
          el('div', { class: 'row', style: 'gap:var(--sp-2)' },
            el('button', {
              type: 'button', class: 'btn btn-secondary btn-sm',
              'aria-label': `One fewer ${type.name}`,
              disabled: n === 0,
              onclick: () => { removeType(type.key); paintPanel(); refreshSummary(); },
            }, '−'),
            el('span', { class: 'mono', style: 'min-width:2ch;text-align:center' }, String(n)),
            el('button', {
              type: 'button', class: 'btn btn-secondary btn-sm',
              'aria-label': `One more ${type.name}`,
              onclick: () => { addType(type.key); paintPanel(); refreshSummary(); },
            }, '+')));
        panel.append(row);
        if (type !== PASSENGER_TYPES[PASSENGER_TYPES.length - 1]) {
          panel.append(el('hr', { style: 'margin:var(--sp-3) 0' }));
        }
      }
      const note = capNote();
      if (note) panel.append(el('p', { class: `note note-${note.level} mt-4` }, note.text));
      panel.append(el('button', {
        type: 'button', class: 'btn btn-block mt-4',
        onclick: () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); },
      }, 'Done'));
    }

    function refreshSummary() {
      const t = state.passengers.length;
      btn.textContent = `${t} ${t === 1 ? 'traveller' : 'travellers'} · ${countByType(state.passengers)}`;
    }

    btn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) paintPanel();
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    wrap.append(el('div', { style: 'position:relative' }, btn, panel));
    return wrap;
  }

  function addType(key) {
    if (state.passengers.length >= LIMITS.maxPassengers + 4) return;
    state.passengers.push({ type: key });
  }
  function removeType(key) {
    const at = state.passengers.map((p) => p.type).lastIndexOf(key);
    if (at >= 0) state.passengers.splice(at, 1);
    if (!state.passengers.length) state.passengers.push({ type: 'adult' });
  }
  function capNote() {
    const paying = state.passengers.filter((p) => p.type !== 'infant').length;
    if (paying > LIMITS.maxPassengers) {
      return { level: 'warn', text: `Parties over ${LIMITS.maxPassengers} travel on a group booking. We will pick that up as an enquiry.` };
    }
    if (paying > LIMITS.carrierMaxPassengers) {
      return { level: 'info', text: `The carrier's own site stops at ${LIMITS.carrierMaxPassengers} per booking. Yours stays on one reservation.` };
    }
    return null;
  }

  function dateField(label, value, onChange, { min, id } = {}) {
    const wrap = el('div', { class: 'field' });
    const inputId = id || `date-${Math.random().toString(36).slice(2, 7)}`;
    wrap.append(el('label', { class: 'label', for: inputId }, label));
    const input = el('input', {
      class: 'input', type: 'date', id: inputId,
      value: ymdInput(value),
      min: min || ymdInput(ymdOf(new Date())),
      max: ymdInput(ymdOf(addDays(new Date(), LIMITS.bookingHorizonDays))),
      onchange: (e) => onChange(inputYmd(e.target.value)),
    });
    wrap.append(input);
    return wrap;
  }

  function paint() {
    paintModes();
    clear(fields);
    combos.length = 0;

    if (state.mode === 'multi') {
      const list = el('div', {});
      state.legs.forEach((leg, i) => {
        const row = el('div', { class: 'leg-row' });
        const fromCell = el('div', { class: 'field' });
        const toCell = el('div', { class: 'field' });
        combos.push(new StationCombobox(fromCell, {
          id: `m-from-${i}`, name: `from${i}`, label: i === 0 ? 'From' : `Leg ${i + 1} from`, value: leg.from,
          onChange: (s) => { leg.from = s.c; },
        }));
        combos.push(new StationCombobox(toCell, {
          id: `m-to-${i}`, name: `to${i}`, label: i === 0 ? 'To' : `Leg ${i + 1} to`, value: leg.to,
          onChange: (s) => { leg.to = s.c; },
        }));
        row.append(fromCell, toCell,
          dateField('Depart', leg.date, (v) => { leg.date = v; }, { id: `m-date-${i}` }));
        row.append(state.legs.length > 2 || i > 0
          ? el('button', {
              type: 'button', class: 'btn btn-secondary', style: 'min-height:48px',
              'aria-label': `Remove leg ${i + 1}`,
              onclick: () => { state.legs.splice(i, 1); paint(); },
            }, '×')
          : el('span'));
        list.append(row);
      });
      fields.append(list);
      fields.append(el('div', { class: 'row mt-4' },
        el('button', {
          type: 'button', class: 'btn btn-secondary btn-sm',
          disabled: state.legs.length >= LIMITS.maxSegments,
          onclick: () => {
            const last = state.legs[state.legs.length - 1];
            state.legs.push({ ...defaultLeg(), from: last.to || '', date: last.date });
            paint();
          },
        }, '+ Add another leg'),
        el('span', { class: 'text-mute', style: 'font-size:var(--step--2)' },
          `Up to ${LIMITS.maxSegments} legs. The carrier's own site stops at ${LIMITS.carrierMaxSegments}.`)));
      fields.append(el('div', { class: 'grid grid-2 mt-4' }, passengerControl(), submitCell()));
    } else {
      const leg = state.legs[0];
      const grid = el('div', { class: 'search-grid' });
      const fromCell = el('div', { class: 'field' });
      const toCell = el('div', { class: 'field' });

      const fromCombo = new StationCombobox(fromCell, {
        id: 'q-from', name: 'from', label: 'From', value: leg.from,
        onChange: (s) => { leg.from = s.c; },
      });
      const toCombo = new StationCombobox(toCell, {
        id: 'q-to', name: 'to', label: 'To', value: leg.to,
        onChange: (s) => { leg.to = s.c; },
      });
      combos.push(fromCombo, toCombo);

      const swap = el('button', {
        type: 'button', class: 'search-swap', 'aria-label': 'Swap origin and destination',
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 4 4 7l3 3"/><path d="M4 7h13a3 3 0 0 1 3 3v1"/><path d="m17 20 3-3-3-3"/><path d="M20 17H7a3 3 0 0 1-3-3v-1"/></svg>',
        onclick: (e) => {
          const a = fromCombo.resolve();
          const b = toCombo.resolve();
          leg.from = b ? b.c : '';
          leg.to = a ? a.c : '';
          if (b) fromCombo.setStation(b, { silent: true }); else { fromCombo.input.value = ''; fromCombo.hidden.value = ''; }
          if (a) toCombo.setStation(a, { silent: true }); else { toCombo.input.value = ''; toCombo.hidden.value = ''; }
          e.currentTarget.classList.toggle('is-spun');
        },
      });

      grid.append(fromCell, swap, toCell,
        dateField('Depart', leg.date, (v) => { leg.date = v; }, { id: 'q-date' }));

      if (state.mode === 'return') {
        grid.append(dateField('Return', leg.returnDate || leg.date, (v) => { leg.returnDate = v; }, {
          id: 'q-return', min: ymdInput(leg.date),
        }));
      } else {
        grid.append(el('div'));
      }
      grid.append(submitCell());
      fields.append(grid);
      fields.append(el('div', { class: 'grid grid-2 mt-4' }, passengerControl(), el('div')));
    }
  }

  function submitCell() {
    return el('div', { class: 'field search-submit-cell' },
      el('span', { class: 'label', 'aria-hidden': 'true', style: 'visibility:hidden' }, '.'),
      el('button', { type: 'submit', class: 'btn btn-block', style: 'min-height:48px' }, 'Find trains'));
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = message ? 'flex' : 'none';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showError('');

    for (const c of combos) c.resolve();

    const problems = [];
    state.legs.forEach((leg, i) => {
      const label = state.mode === 'multi' ? `Leg ${i + 1}: ` : '';
      if (!leg.from) problems.push(`${label}choose where you are travelling from.`);
      if (!leg.to) problems.push(`${label}choose where you are travelling to.`);
      if (leg.from && leg.to && leg.from === leg.to) problems.push(`${label}origin and destination are the same station.`);
      const dateProblem = validateSearchDate(leg.date);
      if (dateProblem) problems.push(`${label}${dateProblem}`);
    });
    if (state.mode === 'return') {
      const leg = state.legs[0];
      if ((leg.returnDate || 0) < leg.date) problems.push('The return date is before the outbound date.');
    }

    if (problems.length) {
      showError(problems[0]);
      const firstEmpty = combos.find((c) => !c.hidden.value);
      if (firstEmpty) firstEmpty.focus();
      return;
    }

    const basketNow = loadBasket();
    basketNow.mode = state.mode;
    basketNow.legs = state.legs.map((l) => ({ ...l }));
    basketNow.passengers = state.passengers.map((p) => ({ ...p }));
    basketNow.selections = [];
    saveBasket(basketNow);

    const params = new URLSearchParams();
    params.set('from', state.legs[0].from);
    params.set('to', state.legs[0].to);
    params.set('date', String(state.legs[0].date));
    params.set('mode', state.mode);
    if (state.mode === 'return') params.set('return', String(state.legs[0].returnDate));
    const tenant = new URLSearchParams(location.search).get('tenant');
    if (tenant) params.set('tenant', tenant);
    location.href = `${opts.action || 'search.html'}?${params}`;
  });

  paint();
  return { state, form };
}

function countByType(passengers) {
  const counts = new Map();
  for (const p of passengers) counts.set(p.type, (counts.get(p.type) || 0) + 1);
  return [...counts.entries()]
    .map(([k, n]) => {
      const t = PASSENGER_TYPES.find((x) => x.key === k);
      return `${n} ${t ? t.name.toLowerCase() : k}${n > 1 ? 's' : ''}`;
    })
    .join(', ');
}

export { station, dateFromYmd };
