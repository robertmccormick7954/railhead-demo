/* ==========================================================================
   Railhead — shared interface behaviour
   Chrome, form controls, formatting, and the small number of widgets used on
   more than one page. No page-specific logic lives here.
   ========================================================================== */

import { Theme, glyphSvg, money, hour12, formatDate, PAYMENT_METHODS, boot as bootTheme } from './theme.js';
import * as Data from './data.js';

/* --------------------------------------------------------------------------
   DOM helpers
   -------------------------------------------------------------------------- */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Escape for the few places that build HTML strings (combobox highlighting). */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* --------------------------------------------------------------------------
   Formatting
   -------------------------------------------------------------------------- */

export function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m ? m + 'm' : ''}`.trim();
  }
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function clockAt(instant, stationOrTz) {
  const tz = typeof stationOrTz === 'string' ? stationOrTz : stationOrTz.tz;
  return Data.localClock(instant, tz, hour12());
}

export function ymdInput(ymd) {
  const s = String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function inputYmd(value) {
  return Number(String(value).replace(/-/g, '')) || 0;
}

export { money, formatDate };

/* --------------------------------------------------------------------------
   Chrome
   -------------------------------------------------------------------------- */

const NAV = [
  { key: 'book', href: 'index.html', label: 'Book' },
  { key: 'manage', href: 'manage.html', label: 'My trips' },
  { key: 'routes', href: 'routes.html', label: 'Routes' },
  { key: 'stations', href: 'stations.html', label: 'Stations' },
  { key: 'help', href: 'help.html', label: 'Help' },
];

function relative(href, depth) {
  return depth > 0 ? '../'.repeat(depth) + href : href;
}

export function mountChrome({ active = '', depth = 0 } = {}) {
  const t = Theme.tenant;
  if (!t) return;

  const header = qs('#site-header');
  if (header) {
    clear(header);
    const inner = el('div', { class: 'wrap site-header-inner' });

    inner.append(el('a', { class: 'brandmark', href: relative('index.html', depth) },
      el('span', { class: 'brandmark-glyph', html: glyphSvg(t.brand.glyph) }),
      el('span', {},
        el('span', {}, t.brand.wordmark),
        el('span', { class: 'brandmark-sub' }, t.brand.wordmarkSuffix))));

    const toggle = el('button', {
      class: 'btn btn-secondary btn-sm nav-toggle hide-lg',
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'primary-nav',
    }, 'Menu');

    const nav = el('nav', { class: 'nav', id: 'primary-nav', 'aria-label': 'Primary' },
      NAV.map((n) => el('a', {
        href: relative(n.href, depth),
        'aria-current': n.key === active ? 'page' : null,
      }, n.label)));

    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.hidden = open;
    });
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => { nav.hidden = mq.matches && toggle.getAttribute('aria-expanded') !== 'true'; };
    mq.addEventListener('change', sync);
    sync();

    inner.append(el('span', { class: 'spacer' }), toggle, nav, tenantSwitcher());
    header.append(inner);
  }

  const strip = qs('#disclosure-strip');
  if (strip) {
    clear(strip);
    strip.append(el('div', { class: 'wrap' },
      el('span', {},
        el('strong', {}, t.name), ' is an independent travel agency selling rail travel. ',
        'Not affiliated with, endorsed by, or an agent of Amtrak.'),
      el('span', { class: 'spacer' }),
      el('a', { class: 'link-quiet', href: relative('about.html', depth) }, 'Who we are')));
  }

  const footer = qs('#site-footer');
  if (footer) {
    clear(footer);
    footer.append(el('div', { class: 'wrap' },
      el('div', { class: 'footer-grid' },
        el('div', { class: 'footer-col' },
          el('div', { class: 'brandmark', style: 'color:inherit' },
            el('span', { class: 'brandmark-glyph', html: glyphSvg(t.brand.glyph) }),
            el('span', {}, el('span', {}, t.brand.wordmark),
              el('span', { class: 'brandmark-sub' }, t.brand.wordmarkSuffix))),
          el('p', { class: 'mt-4', style: 'font-size:var(--step--1);opacity:.82;max-width:34ch' }, t.tagline),
          el('p', { class: 'mt-4', style: 'font-size:var(--step--1);opacity:.82' },
            el('a', { href: `tel:${t.support.phone.replace(/[^+\d]/g, '')}` }, t.support.phoneLabel),
            el('br'),
            el('a', { href: `mailto:${t.support.email}` }, t.support.email),
            el('br'), t.support.hours)),
        el('div', { class: 'footer-col' },
          el('h2', {}, 'Book'),
          el('ul', {},
            [['index.html', 'Search trains'], ['routes.html', 'Routes'], ['stations.html', 'Stations'],
             ['manage.html', 'My trips'], ['groups.html', 'Group travel']]
              .map(([h, l]) => el('li', {}, el('a', { href: relative(h, depth) }, l))))),
        el('div', { class: 'footer-col' },
          el('h2', {}, 'Support'),
          el('ul', {},
            [['help.html', 'Help centre'], ['accessibility.html', 'Accessibility'],
             ['fares.html', 'Fares and refunds'], ['contact.html', 'Contact us']]
              .map(([h, l]) => el('li', {}, el('a', { href: relative(h, depth) }, l))))),
        el('div', { class: 'footer-col' },
          el('h2', {}, 'Platform'),
          el('ul', {},
            [['platform.html', 'For agencies'], ['architecture.html', 'How it connects'],
             ['agency/index.html', 'Agency console'], ['terms.html', 'Terms'], ['privacy.html', 'Privacy']]
              .map(([h, l]) => el('li', {}, el('a', { href: relative(h, depth) }, l)))))),
      el('div', { class: 'footer-legal' },
        el('p', {}, `${t.legalName}. ${t.legal.note}`),
        el('p', { class: 'mt-4' },
          'Amtrak, Acela and the names of individual trains are trademarks of the National Railroad ',
          'Passenger Corporation, used here only to identify the services being sold.'),
        el('p', { class: 'mt-4' },
          el('strong', {}, 'Demonstration build.'),
          ' Schedules are real, from Amtrak\'s published GTFS feed. Fares, availability, payments and ',
          'tickets are simulated. Nothing booked here is a real reservation and no ticket issued here ',
          'is valid for travel.'))));
  }
}

function tenantSwitcher() {
  const wrap = el('div', { class: 'row', style: 'gap:var(--sp-2)' });
  const select = el('select', {
    class: 'select btn-sm',
    'aria-label': 'Switch storefront',
    style: 'min-height:36px;width:auto;padding-block:4px;font-size:var(--step--2)',
    onchange: (e) => {
      const url = new URL(location.href);
      url.searchParams.set('tenant', e.target.value);
      location.href = url.toString();
    },
  }, Theme.tenants.map((t) => el('option', { value: t.id, selected: t.id === Theme.tenant.id }, t.name)));
  wrap.append(select);
  return wrap;
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

let toastStack = null;
export function toast(message, { timeout = 4200 } = {}) {
  if (!toastStack) {
    toastStack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastStack);
  }
  const node = el('div', { class: 'toast' }, message);
  toastStack.append(node);
  setTimeout(() => node.remove(), timeout);
}

/* --------------------------------------------------------------------------
   Station combobox
   Full ARIA combobox: type to filter, arrows to move, Enter to take, Escape to
   close. Matches on station name, city, state and code, so "penn", "new york"
   and "NYP" all reach the same place.
   -------------------------------------------------------------------------- */

export class StationCombobox {
  /**
   * @param {HTMLElement} mount container
   * @param {object} opts {id, label, name, value, placeholder, onChange}
   */
  constructor(mount, opts = {}) {
    this.opts = opts;
    this.value = opts.value || '';
    this.activeIndex = -1;
    this.results = [];
    this.mount = mount;
    this.render();
    if (this.value) this.setStation(Data.station(this.value), { silent: true });
  }

  render() {
    const id = this.opts.id || `combo-${Math.random().toString(36).slice(2, 8)}`;
    this.listId = `${id}-list`;

    this.input = el('input', {
      class: 'input combo-input',
      id,
      type: 'text',
      name: this.opts.name || id,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-controls': this.listId,
      'aria-autocomplete': 'list',
      placeholder: this.opts.placeholder || 'City, station or code',
    });

    this.list = el('ul', { class: 'combo-list', id: this.listId, role: 'listbox', hidden: true });
    this.hidden = el('input', { type: 'hidden', name: `${this.opts.name || id}_code`, value: this.value });

    const label = el('label', { class: 'label', for: id },
      this.opts.label,
      this.opts.hint ? el('span', { class: 'label-hint' }, ` ${this.opts.hint}`) : null);

    const box = el('div', { class: 'combo' },
      el('span', { class: 'combo-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>' }),
      this.input, this.list, this.hidden);

    this.mount.append(label, box);
    this.error = el('p', { class: 'field-error', id: `${id}-error` });
    this.mount.append(this.error);

    this.input.addEventListener('input', () => this.onInput());
    this.input.addEventListener('focus', () => this.open(this.input.value));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 140));
  }

  onInput() {
    this.hidden.value = '';
    this.open(this.input.value);
  }

  open(query) {
    this.results = Data.searchStations(query, 8);
    this.activeIndex = -1;
    clear(this.list);

    if (!this.results.length) {
      this.list.append(el('li', { class: 'combo-empty' },
        query ? `No station matches “${query}”.` : 'Start typing a city or station.'));
    } else {
      this.results.forEach((s, i) => {
        const opt = el('li', {
          class: 'combo-option',
          id: `${this.listId}-opt-${i}`,
          role: 'option',
          'aria-selected': 'false',
        });
        const q = Data.norm(query);
        opt.innerHTML =
          `<span class="combo-option-name">${highlight(s.n, q)}</span>` +
          `<span class="combo-option-meta">${esc(s.y !== s.n ? s.y + ', ' : '')}${esc(Data.stateName(s.s))}</span>` +
          `<span class="combo-option-code">${esc(s.c)}</span>`;
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); this.setStation(s); this.close(); });
        this.list.append(opt);
      });
    }
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.list.hidden) this.open(this.input.value);
      const n = this.results.length;
      if (!n) return;
      this.activeIndex = e.key === 'ArrowDown'
        ? (this.activeIndex + 1) % n
        : (this.activeIndex - 1 + n) % n;
      this.paintActive();
    } else if (e.key === 'Enter') {
      if (!this.list.hidden && this.activeIndex >= 0) {
        e.preventDefault();
        this.setStation(this.results[this.activeIndex]);
        this.close();
      }
    } else if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Tab') {
      if (!this.list.hidden && this.activeIndex >= 0) this.setStation(this.results[this.activeIndex]);
      this.close();
    }
  }

  paintActive() {
    qsa('.combo-option', this.list).forEach((node, i) => {
      const on = i === this.activeIndex;
      node.setAttribute('aria-selected', String(on));
      if (on) {
        this.input.setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  setStation(station, { silent = false } = {}) {
    if (!station) return;
    this.value = station.c;
    this.hidden.value = station.c;
    this.input.value = `${station.n} (${station.c})`;
    this.setError('');
    if (!silent && this.opts.onChange) this.opts.onChange(station);
  }

  /** Accept a typed value that was never picked from the list, if it is unambiguous. */
  resolve() {
    if (this.hidden.value) return Data.station(this.hidden.value);
    const typed = this.input.value.trim();
    if (!typed) return null;
    const direct = Data.station(typed.replace(/.*\(([A-Z]{3})\)\s*$/, '$1'));
    if (direct) { this.setStation(direct, { silent: true }); return direct; }
    const matches = Data.searchStations(typed, 2);
    if (matches.length === 1 || (matches.length > 1 && Data.norm(matches[0].n) === Data.norm(typed))) {
      this.setStation(matches[0], { silent: true });
      return matches[0];
    }
    return null;
  }

  setError(message) {
    this.error.textContent = message || '';
    this.input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) this.input.setAttribute('aria-describedby', this.error.id);
    else this.input.removeAttribute('aria-describedby');
  }

  focus() { this.input.focus(); }
}

function highlight(text, normQuery) {
  if (!normQuery) return esc(text);
  const normText = Data.norm(text);
  const at = normText.indexOf(normQuery);
  if (at === -1) return esc(text);
  // Index positions survive because norm() preserves length for ASCII names.
  return esc(text.slice(0, at)) + '<mark>' + esc(text.slice(at, at + normQuery.length)) + '</mark>'
    + esc(text.slice(at + normQuery.length));
}

/* --------------------------------------------------------------------------
   Payment method chips
   -------------------------------------------------------------------------- */

export function paymentList(ids = Theme.tenant?.payments || []) {
  return ids.map((id) => PAYMENT_METHODS[id]).filter(Boolean);
}

/* --------------------------------------------------------------------------
   Page boot
   -------------------------------------------------------------------------- */

/**
 * Every page calls this. Loads the tenant, paints the chrome, then loads the
 * network data only if the page asked for it — the content pages do not need
 * 62 KB of timetable.
 */
export async function page({ active = '', depth = 0, needsNetwork = false } = {}) {
  await bootTheme();
  if (needsNetwork) await Data.load();
  mountChrome({ active, depth });
  document.body.dataset.ready = 'true';
  return Theme.tenant;
}
