/* ==========================================================================
   Agency console
   --------------------------------------------------------------------------
   The back office an agency gets when it licenses the platform. Six screens,
   all editing the same tenant record, all taking effect immediately across the
   whole storefront — because that is the claim being made, and a preview that
   only previews would not demonstrate it.

   Edits are held as an override layer over data/tenants.json. In production
   that layer is a row in a tenant table; here it is the agency's own browser,
   which is why "Revert" exists and works.
   ========================================================================== */

import { page, el, clear, qs, qsa, duration, clockAt, toast } from '../ui.js';
import { Net } from '../data.js';
import {
  Theme, money, applyTenant, resolveTenant, baseTenant, loadOverride, saveOverride,
  clearOverride, contrastRatio, onColor, ensureContrast, PAYMENT_METHODS, glyphSvg,
} from '../theme.js';
import { loadBookings, isPast } from '../booking.js';

await page({ depth: Number(document.body.dataset.depth || 0), needsNetwork: true });

const SCREENS = [
  ['index', 'Dashboard'], ['branding', 'Branding'], ['pricing', 'Pricing'],
  ['bookings', 'Bookings'], ['payments', 'Payments'], ['settings', 'Settings'],
];

const screen = qs('#console').dataset.screen;
const tenantParam = new URLSearchParams(location.search).get('tenant');
const link = (file) => `${file}.html${tenantParam ? `?tenant=${tenantParam}` : ''}`;

/* working copy — edits mutate this, then are committed to the override */
let draft = structuredClone(Theme.tenant);

paintNav();
paintScreen();

function paintNav() {
  const nav = qs('#console-nav');
  clear(nav);
  for (const [file, label] of SCREENS) {
    const current = (screen === 'dashboard' && file === 'index') || screen === file;
    nav.append(el('a', {
      class: 'tab', href: link(file), role: null,
      'aria-current': current ? 'page' : null,
      'aria-selected': String(current),
      style: current ? 'color:var(--brand);border-bottom-color:var(--brand)' : '',
    }, label));
  }
}

function commit(patch, { repaint = true } = {}) {
  const existing = loadOverride(Theme.tenant.id) || {};
  const merged = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    merged[k] = typeof v === 'object' && !Array.isArray(v) ? { ...(existing[k] || {}), ...v } : v;
  }
  saveOverride(Theme.tenant.id, merged);
  const next = resolveTenant(Theme.tenant.id);
  applyTenant(next);
  Theme.tenant = next;
  draft = structuredClone(next);
  if (repaint) paintScreen();
}

function revert() {
  clearOverride(Theme.tenant.id);
  const next = resolveTenant(Theme.tenant.id);
  applyTenant(next);
  Theme.tenant = next;
  draft = structuredClone(next);
  toast('Storefront reset to its saved configuration.');
  paintScreen();
}

function isOverridden() { return Boolean(loadOverride(Theme.tenant.id)); }

/* -------------------------------------------------------------------------- */

function paintScreen() {
  const mount = qs('#console');
  clear(mount);
  ({
    dashboard: paintDashboard, branding: paintBranding, pricing: paintPricing,
    bookings: paintBookings, payments: paintPayments, settings: paintSettings,
  }[screen] || paintDashboard)(mount);
}

/* ---- dashboard ----------------------------------------------------------- */

function paintDashboard(mount) {
  const bookings = loadBookings().filter((b) => b.tenantId === Theme.tenant.id);
  const live = bookings.filter((b) => b.status !== 'cancelled');
  const gross = live.reduce((n, b) => n + b.money.total, 0);
  const margin = live.reduce((n, b) => n + b.money.markup, 0);
  const pax = live.reduce((n, b) => n + b.passengers.length, 0);

  mount.append(el('div', { class: 'grid grid-4 mt-6' },
    stat('Bookings', String(live.length), `${bookings.length - live.length} cancelled`),
    stat('Travellers', String(pax), 'across all bookings'),
    stat('Gross sales', money(gross), 'total charged'),
    stat('Agency margin', money(margin), gross ? `${((margin / gross) * 100).toFixed(1)}% of gross` : 'no sales yet')));

  mount.append(el('div', { class: 'grid grid-2 mt-8' },
    el('section', { class: 'card', 'aria-labelledby': 'store-title' },
      el('h2', { id: 'store-title', style: 'font-size:var(--step-0)' }, 'This storefront'),
      el('div', { class: 'row mt-4', style: 'gap:var(--sp-3)' },
        el('span', { class: 'brandmark-glyph', html: glyphSvg(Theme.tenant.brand.glyph) }),
        el('div', {},
          el('strong', {}, Theme.tenant.name),
          el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' }, Theme.tenant.legalName))),
      el('div', { class: 'table-scroll mt-4' }, el('table', { class: 'table' },
        el('caption', { class: 'visually-hidden' }, 'Storefront configuration summary'),
        el('tbody', {},
          row('Markup', `${Theme.tenant.policy.markupPct}%`
            + (Theme.tenant.policy.markupFixed ? ` + ${Theme.tenant.policy.markupFixed} per passenger` : '')),
          row('Currency', Theme.tenant.money.currency),
          row('Clock', Theme.tenant.locale.hour12 ? '12 hour' : '24 hour'),
          row('Payment methods', String(Theme.tenant.payments.length)),
          row('Configuration', isOverridden() ? 'Edited in this console' : 'As supplied')))),
      isOverridden()
        ? el('button', { class: 'btn btn-secondary btn-sm mt-4', type: 'button', onclick: revert }, 'Revert all changes')
        : null),

    el('section', { class: 'card', 'aria-labelledby': 'recent-title' },
      el('h2', { id: 'recent-title', style: 'font-size:var(--step-0)' }, 'Recent bookings'),
      live.length
        ? el('div', { class: 'mt-4' }, live.slice(0, 5).map((b) => el('div', {
            class: 'row row-between', style: 'padding:var(--sp-2) 0;border-bottom:1px solid var(--rule-soft)',
          },
          el('span', { class: 'pnr', style: 'font-size:var(--step--1)' }, b.pnr),
          el('span', { class: 'text-soft', style: 'font-size:var(--step--2)' },
            b.legs[0]?.summary ? `${b.legs[0].summary.from} → ${b.legs[0].summary.to}` : ''),
          el('span', { class: 'money', style: 'font-size:var(--step--1)' }, money(b.money.total)))))
        : el('p', { class: 'text-soft mt-4', style: 'font-size:var(--step--1)' },
            'No bookings on this storefront yet. Make one on the shop front and it appears here.'),
      el('p', { class: 'mt-4' }, el('a', { class: 'link-quiet', href: link('bookings') }, 'Open the bookings ledger')))));

  mount.append(el('p', { class: 'note note-info mt-8' },
    'The ledger shows bookings made in this browser. A production deployment reads them from the '
    + 'platform database, scoped to this agency.'));
}

function stat(label, value, note) {
  return el('div', { class: 'card' },
    el('span', { class: 'eyebrow', style: 'margin:0' }, label),
    el('div', { class: 'mono', style: 'font-size:var(--step-4);font-weight:600;letter-spacing:-.03em' }, value),
    el('div', { class: 'text-mute', style: 'font-size:var(--step--2)' }, note));
}

function row(k, v) {
  return el('tr', {}, el('th', { scope: 'row' }, k), el('td', { class: 'num' }, v));
}

/* ---- branding ------------------------------------------------------------ */

function paintBranding(mount) {
  mount.append(el('p', { class: 'text-soft mt-4', style: 'max-width:62ch' },
    'Changes apply to the whole storefront as you make them. Open the shop front in another tab and '
    + 'watch it follow.'));

  const grid = el('div', { class: 'grid grid-sidebar mt-6' });
  const form = el('div', {});
  const preview = el('aside', { class: 'card', 'aria-label': 'Contrast check' });

  const colours = [
    ['primary', 'Primary', 'Buttons, links and the brand mark'],
    ['primaryHover', 'Primary hover', 'The hover and focus state'],
    ['accent', 'Accent', 'Prices and live status only'],
    ['canvas', 'Page background', ''],
    ['surface', 'Card background', ''],
    ['ink', 'Text', ''],
  ];

  const section = el('fieldset', { class: 'fieldset card' }, el('legend', { class: 'legend' }, 'Colours'));
  for (const [key, label, note] of colours) {
    const id = `brand-${key}`;
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { class: 'label', for: id }, label,
      note ? el('span', { class: 'label-hint' }, ` — ${note}`) : null));
    wrap.append(el('div', { class: 'row', style: 'gap:var(--sp-3)' },
      el('input', {
        type: 'color', id, value: draft.brand[key], style: 'width:52px;height:44px;padding:2px;border:1px solid var(--rule-strong);border-radius:var(--radius);background:var(--surface);cursor:pointer',
        oninput: (e) => { draft.brand[key] = e.target.value; live(); },
      }),
      el('input', {
        class: 'input mono', value: draft.brand[key], style: 'max-width:140px',
        'aria-label': `${label} hex value`,
        oninput: (e) => {
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { draft.brand[key] = e.target.value; live(); }
        },
      })));
    section.append(wrap);
  }
  form.append(section);

  const shape = el('fieldset', { class: 'fieldset card mt-6' }, el('legend', { class: 'legend' }, 'Shape and type'));
  shape.append(selectField('brand-radius', 'Corner radius', draft.brand.radius,
    [['2px', 'Square'], ['5px', 'Slight'], ['12px', 'Rounded'], ['20px', 'Very rounded']],
    (v) => { draft.brand.radius = v; draft.brand.radiusLarge = `${Number(v.replace('px', '')) * 2}px`; live(); }));
  shape.append(selectField('brand-display', 'Display typeface', draft.brand.fontDisplay,
    [['Archivo', 'Archivo — grotesque, signage'], ['Public Sans', 'Public Sans — neutral, institutional'], ['IBM Plex Mono', 'IBM Plex Mono — technical']],
    (v) => { draft.brand.fontDisplay = v; live(); }));
  shape.append(selectField('brand-body', 'Interface typeface', draft.brand.fontBody,
    [['Public Sans', 'Public Sans'], ['Archivo', 'Archivo']],
    (v) => { draft.brand.fontBody = v; live(); }));
  shape.append(selectField('brand-glyph', 'Logo mark', draft.brand.glyph,
    [['rail', 'Rail carriage'], ['bird', 'Bird'], ['compass', 'Compass']],
    (v) => { draft.brand.glyph = v; live(); }));
  form.append(shape);

  const words = el('fieldset', { class: 'fieldset card mt-6' }, el('legend', { class: 'legend' }, 'Name'));
  words.append(textField('brand-wordmark', 'Wordmark', draft.brand.wordmark, (v) => { draft.brand.wordmark = v; live(); }));
  words.append(textField('brand-suffix', 'Wordmark suffix', draft.brand.wordmarkSuffix, (v) => { draft.brand.wordmarkSuffix = v; live(); }));
  words.append(textField('brand-name', 'Trading name', draft.name, (v) => { draft.name = v; live(); }));
  words.append(textField('brand-tagline', 'Tagline', draft.tagline, (v) => { draft.tagline = v; live(); }));
  form.append(words);

  form.append(el('div', { class: 'row row-wrap mt-6', style: 'gap:var(--sp-3)' },
    el('button', {
      class: 'btn', type: 'button',
      onclick: () => { commit({ brand: draft.brand, name: draft.name, tagline: draft.tagline }); toast('Branding saved.'); },
    }, 'Save branding'),
    el('button', {
      class: 'btn btn-secondary', type: 'button',
      onclick: () => {
        const cfg = { brand: draft.brand, name: draft.name, tagline: draft.tagline };
        navigator.clipboard?.writeText(JSON.stringify(cfg, null, 2));
        toast('Theme JSON copied to the clipboard.');
      },
    }, 'Copy theme JSON'),
    isOverridden() ? el('button', { class: 'btn btn-danger', type: 'button', onclick: revert }, 'Revert') : null));

  grid.append(form, preview);
  mount.append(grid);

  function live() {
    applyTenant({ ...Theme.tenant, ...draft, brand: draft.brand });
    paintPreview();
  }

  function paintPreview() {
    clear(preview);
    preview.append(el('h2', { style: 'font-size:var(--step-0)' }, 'Legibility'));
    preview.append(el('p', { class: 'text-soft', style: 'font-size:var(--step--2)' },
      'Button and link colours are computed from your primary, against the surface they sit on. '
      + 'A brand colour that would be unreadable is corrected rather than accepted.'));

    const checks = [
      ['Button label on primary', onColor(draft.brand.primary), draft.brand.primary, 4.5],
      ['Brand text on card', ensureContrast(draft.brand.primary, draft.brand.surface, 4.5), draft.brand.surface, 4.5],
      ['Body text on card', draft.brand.ink, draft.brand.surface, 4.5],
      ['Body text on page', draft.brand.ink, draft.brand.canvas, 4.5],
      ['Accent label on card', ensureContrast(draft.brand.accent, draft.brand.surface, 4.5), draft.brand.surface, 4.5],
    ];

    const table = el('table', { class: 'table mt-4' },
      el('caption', { class: 'visually-hidden' }, 'Computed contrast ratios'),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Pair'), el('th', { scope: 'col', class: 'num' }, 'Ratio'), el('th', { scope: 'col' }, ''))),
      el('tbody', {}, checks.map(([label, fg, bg, target]) => {
        const ratio = contrastRatio(fg, bg);
        const ok = ratio >= target;
        return el('tr', {},
          el('th', { scope: 'row' }, label),
          el('td', { class: 'num' }, `${ratio.toFixed(2)}:1`),
          el('td', {}, el('span', { class: ok ? 'badge badge-ok' : 'badge badge-err' }, ok ? 'AA' : 'Below AA')));
      })));
    preview.append(el('div', { class: 'table-scroll' }, table));

    const raw = contrastRatio(draft.brand.primary, draft.brand.surface);
    if (raw < 4.5) {
      preview.append(el('p', { class: 'note note-info mt-4', style: 'font-size:var(--step--2)' },
        `Your primary is ${raw.toFixed(2)}:1 against the card background, which is below AA for text. `
        + 'It is still used for filled buttons, where the label colour is flipped to compensate; for '
        + 'links and brand text a darkened version is substituted automatically.'));
    }

    preview.append(el('div', { class: 'mt-6', style: 'padding-top:var(--sp-4);border-top:1px solid var(--rule)' },
      el('p', { class: 'eyebrow', style: 'margin:0' }, 'Preview'),
      el('button', { class: 'btn mt-2', type: 'button' }, 'Find trains'),
      el('p', { class: 'mt-4' }, el('a', { class: 'link-quiet', href: '#preview' }, 'A link in brand colour')),
      el('p', { class: 'money mt-2', style: 'font-size:var(--step-2);color:var(--accent-text)' }, money(129))));
  }

  paintPreview();
}

function textField(id, label, value, oninput) {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { class: 'label', for: id }, label));
  wrap.append(el('input', { class: 'input', id, value: value || '', oninput: (e) => oninput(e.target.value) }));
  return wrap;
}

function numberField(id, label, value, oninput, opts = {}) {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { class: 'label', for: id }, label,
    opts.hint ? el('span', { class: 'label-hint' }, ` — ${opts.hint}`) : null));
  wrap.append(el('input', Object.assign({
    class: 'input', id, type: 'number', value: value ?? '', inputmode: 'decimal',
    oninput: (e) => oninput(e.target.value === '' ? null : Number(e.target.value)),
  }, opts.attrs || {})));
  return wrap;
}

function selectField(id, label, value, options, onchange) {
  const wrap = el('div', { class: 'field' });
  wrap.append(el('label', { class: 'label', for: id }, label));
  wrap.append(el('select', { class: 'select', id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => el('option', { value: v, selected: v === value }, t))));
  return wrap;
}

/* ---- pricing ------------------------------------------------------------- */

function paintPricing(mount) {
  mount.append(el('p', { class: 'text-soft mt-4', style: 'max-width:62ch' },
    'The markup is added to the carrier fare and shown to the customer as its own line. It is never '
    + 'folded into the fare.'));

  const form = el('div', { class: 'grid grid-sidebar mt-6' });
  const left = el('div', {});

  const base = el('fieldset', { class: 'fieldset card' }, el('legend', { class: 'legend' }, 'Markup'));
  base.append(numberField('mk-pct', 'Percentage of the carrier fare', draft.policy.markupPct,
    (v) => { draft.policy.markupPct = v ?? 0; paintCalc(); }, { hint: '%', attrs: { min: '0', max: '60', step: '0.5' } }));
  base.append(numberField('mk-fixed', 'Fixed amount per passenger', draft.policy.markupFixed,
    (v) => { draft.policy.markupFixed = v ?? 0; paintCalc(); }, { attrs: { min: '0', step: '0.5' } }));
  base.append(numberField('mk-min', 'Minimum markup per booking', draft.policy.markupMin,
    (v) => { draft.policy.markupMin = v ?? 0; paintCalc(); }, { attrs: { min: '0', step: '0.5' } }));
  base.append(numberField('mk-max', 'Maximum markup per booking', draft.policy.markupMax,
    (v) => { draft.policy.markupMax = v; paintCalc(); }, { hint: 'blank for no cap', attrs: { min: '0', step: '1' } }));
  base.append(textField('mk-label', 'How it appears on the breakdown', draft.policy.serviceChargeLabel,
    (v) => { draft.policy.serviceChargeLabel = v; paintCalc(); }));
  left.append(base);

  const perRoute = el('fieldset', { class: 'fieldset card mt-6' },
    el('legend', { class: 'legend' }, 'Overrides by service type'),
    el('p', { class: 'field-help' },
      'A long-distance sleeper carries a much higher fare than a corridor ticket, so a flat percentage '
      + 'may be more than the traffic will bear. Leave blank to use the standard markup.'));
  const CATS = [['nec', 'Northeast Corridor'], ['highspeed', 'Acela'], ['corridor', 'State corridor'],
    ['long', 'Long distance'], ['autotrain', 'Auto Train'], ['thruway', 'Thruway coach']];
  for (const [key, label] of CATS) {
    perRoute.append(numberField(`mk-${key}`, label, draft.policy.routeMarkupPct?.[key] ?? null, (v) => {
      draft.policy.routeMarkupPct = draft.policy.routeMarkupPct || {};
      if (v == null) delete draft.policy.routeMarkupPct[key];
      else draft.policy.routeMarkupPct[key] = v;
      paintCalc();
    }, { hint: '%', attrs: { min: '0', max: '60', step: '0.5', placeholder: String(draft.policy.markupPct) } }));
  }
  left.append(perRoute);

  left.append(el('div', { class: 'row row-wrap mt-6', style: 'gap:var(--sp-3)' },
    el('button', {
      class: 'btn', type: 'button',
      onclick: () => { commit({ policy: draft.policy }); toast('Pricing saved. Every fare on the storefront now uses it.'); },
    }, 'Save pricing'),
    isOverridden() ? el('button', { class: 'btn btn-danger', type: 'button', onclick: revert }, 'Revert') : null));

  const calc = el('aside', { class: 'card', 'aria-label': 'Margin calculator' });
  form.append(left, calc);
  mount.append(form);

  function paintCalc() {
    clear(calc);
    calc.append(el('h2', { style: 'font-size:var(--step-0)' }, 'What that earns'));
    calc.append(el('p', { class: 'text-soft', style: 'font-size:var(--step--2)' },
      'Worked against representative carrier fares.'));
    const samples = [['Corridor day trip', 60, 'corridor'], ['Acela business', 190, 'highspeed'],
      ['Long-distance coach', 210, 'long'], ['Roomette, two nights', 720, 'long']];
    const table = el('table', { class: 'table mt-4' },
      el('caption', { class: 'visually-hidden' }, 'Markup applied to representative fares'),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Example'), el('th', { scope: 'col', class: 'num' }, 'Fare'),
        el('th', { scope: 'col', class: 'num' }, 'Charge'), el('th', { scope: 'col', class: 'num' }, 'Customer pays'))),
      el('tbody', {}, samples.map(([label, net, cat]) => {
        const pct = draft.policy.routeMarkupPct?.[cat] ?? draft.policy.markupPct ?? 0;
        let mk = net * (pct / 100) + (draft.policy.markupFixed || 0);
        if (draft.policy.markupMin != null) mk = Math.max(mk, draft.policy.markupMin);
        if (draft.policy.markupMax != null) mk = Math.min(mk, draft.policy.markupMax);
        return el('tr', {},
          el('th', { scope: 'row' }, label),
          el('td', { class: 'num' }, money(net)),
          el('td', { class: 'num' }, money(Math.round(mk * 100) / 100)),
          el('td', { class: 'num' }, money(Math.round((net + mk) * 100) / 100)));
      })));
    calc.append(el('div', { class: 'table-scroll' }, table));
    calc.append(el('p', { class: 'note note-info mt-4', style: 'font-size:var(--step--2)' },
      'Carrier fares shown here are illustrative. Your real net fares come from the distribution feed.'));
  }
  paintCalc();
}

/* ---- bookings ------------------------------------------------------------ */

function paintBookings(mount) {
  const all = loadBookings().filter((b) => b.tenantId === Theme.tenant.id);
  if (!all.length) {
    mount.append(el('div', { class: 'empty card mt-6' },
      el('p', { class: 'empty-title' }, 'No bookings on this storefront'),
      el('p', {}, 'Bookings made on the shop front appear here with their margin.'),
      el('div', { class: 'empty-actions' },
        el('a', { class: 'btn', href: `../index.html${tenantParam ? `?tenant=${tenantParam}` : ''}` }, 'Open the shop front'))));
    return;
  }

  const table = el('table', { class: 'table mt-6' },
    el('caption', {}, `${all.length} booking${all.length > 1 ? 's' : ''} issued by this storefront`),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Reservation'), el('th', { scope: 'col' }, 'Lead traveller'),
      el('th', { scope: 'col' }, 'Journey'), el('th', { scope: 'col' }, 'Departs'),
      el('th', { scope: 'col', class: 'num' }, 'Pax'), el('th', { scope: 'col', class: 'num' }, 'Carrier'),
      el('th', { scope: 'col', class: 'num' }, 'Margin'), el('th', { scope: 'col', class: 'num' }, 'Total'),
      el('th', { scope: 'col' }, 'Status'))),
    el('tbody', {}, all.map((b) => {
      const s = b.legs[0]?.summary;
      const from = s ? Net.stations.find((x) => x.c === s.from) : null;
      return el('tr', {},
        el('td', {}, el('span', { class: 'pnr', style: 'font-size:var(--step--1)' }, b.pnr)),
        el('td', {}, `${b.contact.firstName} ${b.contact.lastName}`.trim()),
        el('td', {}, s ? `${s.from} → ${s.to}` : '—'),
        el('td', { class: 'mono' }, s && from ? clockAt(s.depInstant, from) : '—'),
        el('td', { class: 'num' }, String(b.passengers.length)),
        el('td', { class: 'num' }, money(b.money.carrierNet)),
        el('td', { class: 'num' }, money(b.money.markup)),
        el('td', { class: 'num' }, money(b.money.total)),
        el('td', {}, el('span', { class: b.status === 'cancelled' ? 'badge badge-err' : 'badge badge-ok' },
          b.status === 'cancelled' ? 'Cancelled' : isPast(b) ? 'Travelled' : 'Confirmed')));
    })));

  mount.append(el('div', { class: 'table-scroll' }, table));

  const live = all.filter((b) => b.status !== 'cancelled');
  mount.append(el('div', { class: 'grid grid-3 mt-6' },
    stat('Gross', money(live.reduce((n, b) => n + b.money.total, 0)), 'charged to customers'),
    stat('Owed to carrier', money(live.reduce((n, b) => n + b.money.carrierNet, 0)), 'net fares'),
    stat('Your margin', money(live.reduce((n, b) => n + b.money.markup, 0)), 'service charges')));
}

/* ---- payments ------------------------------------------------------------ */

function paintPayments(mount) {
  mount.append(el('p', { class: 'text-soft mt-4', style: 'max-width:62ch' },
    'Which methods this storefront offers at checkout. The order here is the order customers see.'));

  const box = el('fieldset', { class: 'fieldset card mt-6' }, el('legend', { class: 'legend' }, 'Methods'));
  const groups = { card: 'Cards', wallet: 'Wallets', bank: 'Bank transfer', instalment: 'Pay later' };
  for (const [groupKey, groupLabel] of Object.entries(groups)) {
    const ids = Object.entries(PAYMENT_METHODS).filter(([, m]) => m.kind === groupKey);
    if (!ids.length) continue;
    box.append(el('h2', { class: 'eyebrow mt-6', style: 'margin-bottom:var(--sp-2)' }, groupLabel));
    for (const [id, m] of ids) {
      box.append(el('label', { class: 'check' },
        el('input', {
          type: 'checkbox', checked: draft.payments.includes(id),
          onchange: (e) => {
            const set = new Set(draft.payments);
            if (e.target.checked) set.add(id); else set.delete(id);
            draft.payments = [...set];
          },
        }),
        el('span', { class: 'check-text' },
          el('span', { class: 'check-title' }, m.name),
          m.note ? el('span', { class: 'check-note' }, m.note) : null)));
    }
  }
  mount.append(box);

  mount.append(el('button', {
    class: 'btn mt-6', type: 'button',
    onclick: () => {
      if (!draft.payments.length) { toast('Keep at least one payment method.'); return; }
      commit({ payments: draft.payments });
      toast('Payment methods saved.');
    },
  }, 'Save payment methods'));

  mount.append(el('section', { class: 'card mt-8', 'aria-labelledby': 'mor-title' },
    el('h2', { id: 'mor-title', style: 'font-size:var(--step-0)' }, 'Merchant of record'),
    el('p', { class: 'mt-4' },
      'The agency is the merchant of record: the charge appears under the agency\'s name, the agency '
      + 'holds the acquiring relationship, and chargebacks come to the agency.'),
    el('p', { class: 'mt-4' },
      'Card details are never handled by this application. A production deployment mounts the payment '
      + 'provider\'s own hosted fields, so card data goes from the browser straight to the provider and '
      + 'the agency stays within the reduced PCI-DSS scope that applies when it never touches card data.'),
    el('p', { class: 'note note-warn mt-4' },
      el('strong', {}, 'Nothing on this demonstration takes a payment. '),
      'The checkout fields are inert and no provider is connected.')));
}

/* ---- settings ------------------------------------------------------------ */

function paintSettings(mount) {
  const grid = el('div', { class: 'grid grid-2 mt-6' });

  const locale = el('fieldset', { class: 'fieldset card' }, el('legend', { class: 'legend' }, 'Locale'));
  locale.append(selectField('set-clock', 'Clock', String(draft.locale.hour12),
    [['true', '12 hour — 5:35 PM'], ['false', '24 hour — 17:35']],
    (v) => { draft.locale.hour12 = v === 'true'; }));
  locale.append(selectField('set-dates', 'Date order', draft.locale.dateOrder,
    [['mdy', 'Month first — August 6, 2026'], ['dmy', 'Day first — 6 August 2026']],
    (v) => { draft.locale.dateOrder = v; }));
  locale.append(selectField('set-dist', 'Distance', draft.locale.distanceUnit,
    [['mi', 'Miles'], ['km', 'Kilometres']], (v) => { draft.locale.distanceUnit = v; }));
  locale.append(selectField('set-bcp', 'Number and date formatting', draft.locale.bcp47,
    [['en-US', 'United States'], ['en-GB', 'United Kingdom'], ['en-NL', 'Netherlands'], ['en-CA', 'Canada']],
    (v) => { draft.locale.bcp47 = v; }));
  grid.append(locale);

  const currency = el('fieldset', { class: 'fieldset card' }, el('legend', { class: 'legend' }, 'Currency'));
  currency.append(selectField('set-cur', 'Sell in', draft.money.currency,
    [['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'Pound sterling'], ['CAD', 'Canadian dollar']],
    (v) => { draft.money.currency = v; }));
  currency.append(numberField('set-rate', 'Rate from US dollars', draft.money.rateFromUsd,
    (v) => { draft.money.rateFromUsd = v ?? 1; }, { attrs: { min: '0.01', step: '0.01' } }));
  currency.append(textField('set-rate-date', 'Rate set on', draft.money.rateAsOf || '',
    (v) => { draft.money.rateAsOf = v || null; }));
  currency.append(el('p', { class: 'field-help' },
    'Carrier fares are in US dollars. A declared rate must be shown to customers with the date it was '
    + 'set — it is not a live market rate and must not be presented as one.'));
  grid.append(currency);

  const support = el('fieldset', { class: 'fieldset card' }, el('legend', { class: 'legend' }, 'Support'));
  support.append(textField('set-phone', 'Telephone', draft.support.phoneLabel, (v) => { draft.support.phoneLabel = v; draft.support.phone = v; }));
  support.append(textField('set-email', 'Email', draft.support.email, (v) => { draft.support.email = v; }));
  support.append(textField('set-hours', 'Hours', draft.support.hours, (v) => { draft.support.hours = v; }));
  support.append(textField('set-address', 'Address', draft.support.address, (v) => { draft.support.address = v; }));
  grid.append(support);

  const legal = el('fieldset', { class: 'fieldset card' }, el('legend', { class: 'legend' }, 'Legal identity'));
  legal.append(textField('set-legal', 'Registered name', draft.legalName, (v) => { draft.legalName = v; }));
  legal.append(el('div', { class: 'field' },
    el('label', { class: 'label', for: 'set-reg' }, 'Registration details'),
    el('textarea', {
      class: 'textarea', id: 'set-reg', rows: '3',
      oninput: (e) => { draft.legal.registration = e.target.value; },
    }, draft.legal.registration || '')));
  legal.append(el('p', { class: 'field-help' },
    'Shown in the footer. A live storefront must state the trading entity and any seller-of-travel or '
    + 'travel-guarantee registration it holds.'));
  grid.append(legal);

  mount.append(grid);
  mount.append(el('div', { class: 'row row-wrap mt-6', style: 'gap:var(--sp-3)' },
    el('button', {
      class: 'btn', type: 'button',
      onclick: () => {
        commit({
          locale: draft.locale, money: draft.money, support: draft.support,
          legal: draft.legal, legalName: draft.legalName,
        });
        toast('Settings saved.');
      },
    }, 'Save settings'),
    isOverridden() ? el('button', { class: 'btn btn-danger', type: 'button', onclick: revert }, 'Revert all changes') : null));
}
