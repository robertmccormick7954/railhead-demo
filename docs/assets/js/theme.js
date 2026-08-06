/* ==========================================================================
   Railhead — tenant + theme runtime
   --------------------------------------------------------------------------
   One deployment, many storefronts. A tenant is a configuration object
   (data/tenants.json), and applying it means writing custom properties onto
   :root. No tenant-specific CSS or markup exists anywhere in the codebase.

   The part that makes this safe rather than merely possible: an agency picks
   its own brand colour, and agencies pick badly. So the two colours that carry
   text — the label on a primary button, and brand-coloured text on a white
   card — are NOT taken from the config. They are computed from it, against the
   surface they will actually sit on, to a WCAG contrast target. A tenant that
   chooses pale yellow gets dark button text automatically and a darkened link
   colour, instead of an unreadable storefront.
   ========================================================================== */

const TENANTS_URL = new URL('../../data/tenants.json', import.meta.url);
const STORE_TENANT = 'railhead.tenant';
const STORE_SCHEME = 'railhead.scheme';

export const Theme = {
  tenant: null,
  tenants: [],
  scheme: 'auto',
};

/* --------------------------------------------------------------------------
   Colour maths
   -------------------------------------------------------------------------- */

function parseHex(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channelLum(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever is legible on this background. */
export function onColor(bg) {
  return contrastRatio(bg, '#FFFFFF') >= contrastRatio(bg, '#0B0B0B') ? '#FFFFFF' : '#0B0B0B';
}

/**
 * A muted version of the legible text colour for the same background, still
 * clearing AA. Secondary text on an inverted surface is where "muted" tokens
 * tuned for light backgrounds go wrong.
 */
export function softOn(bg, target = 4.5) {
  const ink = onColor(bg);
  const away = ink === '#FFFFFF' ? bg : '#FFFFFF';
  let best = ink;
  for (let step = 1; step <= 12; step++) {
    const candidate = mix(ink, away, step / 24);
    if (contrastRatio(candidate, bg) < target) break;
    best = candidate;
  }
  return best;
}

function mix(hex, target, amount) {
  const a = parseHex(hex);
  const b = parseHex(target);
  return toHex(a.map((v, i) => v + (b[i] - v) * amount));
}

/**
 * Nudge a colour toward black (or white, on a dark surface) until it clears a
 * contrast target against the surface it will be read on. Used for brand text
 * and links, never for large filled areas.
 */
export function ensureContrast(color, against, target = 4.5) {
  if (contrastRatio(color, against) >= target) return color;
  const towardBlack = relativeLuminance(against) > 0.4;
  const dest = towardBlack ? '#000000' : '#FFFFFF';
  let best = color;
  for (let step = 1; step <= 20; step++) {
    best = mix(color, dest, step / 20);
    if (contrastRatio(best, against) >= target) return best;
  }
  return best;
}

/* --------------------------------------------------------------------------
   Logo glyphs
   Simple, flat marks that inherit currentColor so they invert cleanly.
   -------------------------------------------------------------------------- */

const GLYPHS = {
  rail: '<path fill="currentColor" d="M6 2h12a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V4a2 2 0 0 1 2-2Zm0 3v4h5V5H6Zm7 0v4h5V5h-5Zm-1 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7.6 18.4 5 22h2.6l2-3.6H7.6Zm6.8 0L16.4 22H19l-2.6-3.6h-2Z"/>',
  bird: '<path fill="currentColor" d="M21 6.2a6.6 6.6 0 0 1-1.9.5 3.3 3.3 0 0 0 1.5-1.8 6.7 6.7 0 0 1-2.1.8 3.3 3.3 0 0 0-5.6 3A9.3 9.3 0 0 1 6.1 5.3a3.3 3.3 0 0 0 1 4.4 3.3 3.3 0 0 1-1.5-.4 3.3 3.3 0 0 0 2.6 3.2 3.3 3.3 0 0 1-1.5.1 3.3 3.3 0 0 0 3 2.3A6.6 6.6 0 0 1 3 16.3 9.3 9.3 0 0 0 18.3 8.6c0-.14 0-.28-.01-.42A6.6 6.6 0 0 0 21 6.2Z"/>',
  compass: '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2Zm3.9 3.7-5.5 2.2-2.2 5.5 5.5-2.2 2.2-5.5ZM12 10.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"/>',
};

export function glyphSvg(name) {
  const body = GLYPHS[name] || GLYPHS.rail;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* --------------------------------------------------------------------------
   Payment methods
   -------------------------------------------------------------------------- */

export const PAYMENT_METHODS = {
  visa: { name: 'Visa', kind: 'card' },
  mastercard: { name: 'Mastercard', kind: 'card' },
  amex: { name: 'American Express', kind: 'card' },
  discover: { name: 'Discover', kind: 'card' },
  applepay: { name: 'Apple Pay', kind: 'wallet' },
  googlepay: { name: 'Google Pay', kind: 'wallet' },
  paypal: { name: 'PayPal', kind: 'wallet' },
  affirm: { name: 'Affirm', kind: 'instalment', note: 'Pay over time' },
  klarna: { name: 'Klarna', kind: 'instalment', note: 'Pay in 3' },
  ideal: { name: 'iDEAL', kind: 'bank', note: 'Dutch bank transfer' },
  sepa: { name: 'SEPA Direct Debit', kind: 'bank', note: 'Euro bank debit' },
  bancontact: { name: 'Bancontact', kind: 'bank', note: 'Belgian bank transfer' },
};

/* --------------------------------------------------------------------------
   Load and apply
   -------------------------------------------------------------------------- */

let loadPromise = null;

export function loadTenants() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(TENANTS_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`tenants.json ${r.status}`);
      return r.json();
    })
    .then((cfg) => {
      Theme.tenants = cfg.tenants;
      Theme.defaultTenant = cfg.default;
      return cfg;
    });
  return loadPromise;
}

export function pickTenantId() {
  const q = new URLSearchParams(location.search).get('tenant');
  if (q) return q;
  try {
    const stored = localStorage.getItem(STORE_TENANT);
    if (stored) return stored;
  } catch { /* storage blocked; fall through to the default */ }
  return Theme.defaultTenant || 'railhead';
}

export function setTenant(id, { reload = true } = {}) {
  try { localStorage.setItem(STORE_TENANT, id); } catch { /* ignore */ }
  if (reload) {
    const url = new URL(location.href);
    url.searchParams.delete('tenant');
    location.href = url.toString();
  }
}

/** Write a tenant's configuration onto :root as custom properties. */
export function applyTenant(tenant) {
  Theme.tenant = tenant;
  const b = tenant.brand;
  const root = document.documentElement;
  const set = (k, v) => { if (v != null) root.style.setProperty(k, v); };

  set('--brand', b.primary);
  set('--brand-hover', b.primaryHover);
  set('--brand-active', b.primaryActive);
  set('--brand-soft', b.primarySoft);
  set('--brand-soft-line', b.primarySoftLine);
  set('--accent', b.accent);
  set('--accent-strong', b.accentStrong);
  set('--accent-soft', b.accentSoft);
  set('--bg', b.canvas);
  set('--surface', b.surface);
  set('--text', b.ink);
  set('--radius', b.radius);
  set('--radius-lg', b.radiusLarge);
  const invert = b.footerBg || b.primaryActive || b.ink;
  set('--surface-invert', invert);
  /* THE BUG THIS PREVENTS: --surface-invert was being overridden with the
     tenant's dark brand colour while --text-invert kept the value the dark
     scheme had set for a LIGHT invert surface. The footer became dark green
     with near-black text at 1.29:1. Never author the pair — derive the text
     colour from the surface it will actually sit on. */
  set('--text-invert', onColor(invert));
  set('--text-invert-soft', softOn(invert));

  if (b.fontDisplay) set('--font-display', `"${b.fontDisplay}", "Helvetica Neue", Arial, sans-serif`);
  if (b.fontBody) set('--font-body', `"${b.fontBody}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`);

  // Computed, never configured: the label on a filled control.
  set('--brand-ink', onColor(b.primary));
  set('--accent-ink', onColor(b.accent));

  // Brand-coloured TEXT has to clear 4.5:1 on the surface it sits on, which a
  // mid-tone brand colour often will not. Darken only the text token.
  const surface = b.surface || '#FFFFFF';
  set('--brand-text', ensureContrast(b.primary, surface, 4.5));
  set('--accent-text', ensureContrast(b.accentStrong || b.accent, surface, 4.5));

  root.dataset.tenant = tenant.id;
  document.documentElement.lang = tenant.locale?.lang || 'en';
}

/* --------------------------------------------------------------------------
   Colour scheme
   There is one. A dark scheme was removed deliberately — see tokens.css.
   -------------------------------------------------------------------------- */

export function applyScheme() {
  document.documentElement.removeAttribute('data-scheme');
}

export function storedScheme() { return 'light'; }

/* --------------------------------------------------------------------------
   Locale-aware formatting, driven entirely by the tenant
   -------------------------------------------------------------------------- */

export function money(amountUsd, { showBase = false } = {}) {
  const t = Theme.tenant;
  const m = t?.money || { currency: 'USD', rateFromUsd: 1 };
  const value = Math.round(amountUsd * (m.rateFromUsd ?? 1) * 100) / 100;
  const text = new Intl.NumberFormat(t?.locale?.bcp47 || 'en-US', {
    style: 'currency',
    currency: m.currency || 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
  if (showBase && m.showBaseCurrency && (m.rateFromUsd ?? 1) !== 1) {
    const base = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountUsd);
    return `${text} (${base})`;
  }
  return text;
}

export function hour12() {
  return Theme.tenant?.locale?.hour12 !== false;
}

export function formatDate(ymdOrDate, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const d = typeof ymdOrDate === 'number'
    ? new Date(Math.floor(ymdOrDate / 10000), (Math.floor(ymdOrDate / 100) % 100) - 1, ymdOrDate % 100)
    : ymdOrDate;
  return new Intl.DateTimeFormat(Theme.tenant?.locale?.bcp47 || 'en-US', opts).format(d);
}

/** Distance in the tenant's unit. Miles in, formatted string out. */
export function distance(miles) {
  const unit = Theme.tenant?.locale?.distanceUnit || 'mi';
  if (unit === 'km') return `${Math.round(miles * 1.60934).toLocaleString()} km`;
  return `${Math.round(miles).toLocaleString()} mi`;
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

/**
 * Resolve and apply the tenant before first paint. Call this at the top of
 * every page; it is safe to call more than once.
 */
/* --------------------------------------------------------------------------
   Tenant overrides
   The agency console edits a tenant's own configuration. Those edits are held
   as an override layer rather than by rewriting tenants.json, so a change made
   in the console applies immediately to every page of that storefront and can
   be reverted in one action. In a production deployment this is a row in the
   tenant table; here it is a key in the agency's own browser.
   -------------------------------------------------------------------------- */

const OVERRIDE_KEY = 'railhead.override.';

export function loadOverride(id) {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY + id);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveOverride(id, patch) {
  try { localStorage.setItem(OVERRIDE_KEY + id, JSON.stringify(patch)); } catch { /* ignore */ }
}

export function clearOverride(id) {
  try { localStorage.removeItem(OVERRIDE_KEY + id); } catch { /* ignore */ }
}

/** Deep merge, one level into each known section — enough for a tenant record. */
function mergeTenant(base, patch) {
  if (!patch) return base;
  const out = { ...base };
  for (const key of ['brand', 'locale', 'money', 'policy', 'support', 'legal']) {
    if (patch[key]) out[key] = { ...base[key], ...patch[key] };
  }
  for (const key of ['name', 'legalName', 'tagline', 'payments']) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out;
}

export function resolveTenant(id) {
  const base = Theme.tenants.find((t) => t.id === id) || Theme.tenants[0];
  return mergeTenant(base, loadOverride(base.id));
}

/** The unmodified configuration, for the console's "revert" action. */
export function baseTenant(id) {
  return Theme.tenants.find((t) => t.id === id) || Theme.tenants[0];
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

/**
 * Resolve and apply the tenant before first paint. Call this at the top of
 * every page; it is safe to call more than once.
 */
export async function boot() {
  applyScheme();
  await loadTenants();
  const id = pickTenantId();
  const tenant = resolveTenant(id);
  applyTenant(tenant);
  cacheBrand(tenant);
  return tenant;
}

/* The inline script in the page head reads this to paint the tenant's colours
   before the stylesheet-driven default can flash. */
function cacheBrand(tenant) {
  try {
    const root = document.documentElement.style;
    const vars = {};
    for (const k of ['--brand', '--brand-hover', '--brand-ink', '--accent', '--accent-ink',
      '--bg', '--surface', '--text', '--radius', '--radius-lg', '--surface-invert',
      '--font-display', '--font-body', '--brand-soft', '--brand-soft-line', '--brand-text']) {
      const v = root.getPropertyValue(k);
      if (v) vars[k] = v;
    }
    localStorage.setItem('railhead.brandcache', JSON.stringify({ id: tenant.id, vars }));
  } catch { /* ignore */ }
}
