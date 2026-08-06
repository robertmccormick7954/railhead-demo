/* ==========================================================================
   Railhead — photography
   --------------------------------------------------------------------------
   Images are data, not markup. Every photograph is a slot in
   data/photos.json; pages ask for a slot and get a responsive, lazily loaded,
   correctly-described image back.

   Two rules this module enforces so they cannot be forgotten:

   1. ALT TEXT IS NEVER THE FILENAME. A destination card says where it is; a
      hero behind a headline that already says the same thing is decorative and
      gets alt="", because reading the headline twice helps nobody.
   2. NOTHING SHIPS UN-ATTRIBUTED. Several of these licences require the
      photographer to be named, so the manifest is also what builds
      credits.html. An image with no manifest entry cannot be rendered.
   ========================================================================== */

const URL_BASE = new URL('../photos/', import.meta.url);
const MANIFEST_URL = new URL('../../data/photos.json', import.meta.url);

export const Photos = { loaded: false, map: {} };

let loadPromise = null;

export function loadPhotos() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : { photos: {} }))
    .then((j) => {
      Photos.map = j.photos || {};
      Photos.loaded = true;
      return Photos;
    })
    .catch(() => {
      // A missing manifest must degrade to no images, never to broken ones.
      Photos.map = {};
      Photos.loaded = true;
      return Photos;
    });
  return loadPromise;
}

/* Human descriptions. Keyed by slot prefix so a new city needs one line, and by
   full slot where the subject is specific. */
const CITY_NAMES = {
  NYP: 'New York', WAS: 'Washington DC', CHI: 'Chicago', LAX: 'Los Angeles',
  SEA: 'Seattle', BOS: 'Boston', NOL: 'New Orleans', SAN: 'San Diego',
  PDX: 'Portland', PHL: 'Philadelphia', DEN: 'Denver', MKE: 'Milwaukee',
  ALB: 'Albany', SAC: 'Sacramento', STL: 'St. Louis', EMY: 'San Francisco Bay',
};

const NAMED = {
  'route-acela': 'An Acela trainset',
  'route-california-zephyr': 'The California Zephyr in the Rockies',
  'route-coast-starlight': 'The Coast Starlight on the California coast',
  'route-empire-builder': 'The Empire Builder crossing the northern plains',
  'route-southwest-chief': 'The Southwest Chief in the south-west',
  'route-northeast-regional': 'A Northeast Regional train at a platform',
  'route-cascades': 'An Amtrak Cascades train',
  'route-pacific-surfliner': 'A Pacific Surfliner train beside the ocean',
  'onboard-coach': 'Seats in a coach carriage',
  'onboard-sleeper': 'A roomette, made up for the night',
  'onboard-dining': 'A dining car',
  'onboard-lounge': 'A lounge car with panoramic windows',
};

export function describe(slot) {
  if (NAMED[slot]) return NAMED[slot];
  const [kind, code] = slot.split('-');
  const city = CITY_NAMES[code];
  if (kind === 'city' && city) return `${city}`;
  if (kind === 'station' && city) return `The station at ${city}`;
  return '';
}

export function hasPhoto(slot) {
  return Boolean(Photos.map[slot]);
}

/**
 * Build an <img> for a slot.
 * @param {string} slot
 * @param {object} opts
 * @param {string} [opts.alt]        override; pass '' to mark it decorative
 * @param {boolean} [opts.decorative] the surrounding text already says it
 * @param {string} [opts.sizes]      the CSS sizes attribute
 * @param {boolean} [opts.eager]     above the fold; skips lazy loading
 * @returns {HTMLImageElement|null}
 */
export function photo(slot, opts = {}) {
  const entry = Photos.map[slot];
  if (!entry || !entry.files?.length) return null;

  const files = entry.files.slice().sort((a, b) => a.w - b.w);
  const largest = files[files.length - 1];

  const img = document.createElement('img');
  img.src = new URL(largest.file, URL_BASE).href;
  img.srcset = files.map((f) => `${new URL(f.file, URL_BASE).href} ${f.w}w`).join(', ');
  img.sizes = opts.sizes || (entry.kind === 'wide' ? '100vw' : '(max-width: 700px) 100vw, 380px');
  // Intrinsic size prevents the layout jumping as photographs arrive, which on a
  // booking page can move the button someone is already reaching for.
  img.width = largest.w;
  img.height = largest.h;
  img.decoding = 'async';
  img.loading = opts.eager ? 'eager' : 'lazy';
  if (opts.eager) img.fetchPriority = 'high';
  img.alt = opts.decorative ? '' : (opts.alt ?? describe(slot));
  img.className = opts.class || 'photo';
  return img;
}

/** A figure with a visible credit line. Used where the image is large enough to warrant one. */
export function photoFigure(slot, opts = {}) {
  const img = photo(slot, opts);
  if (!img) return null;
  const entry = Photos.map[slot];
  const fig = document.createElement('figure');
  fig.className = opts.figureClass || 'photo-figure';
  fig.append(img);
  if (opts.credit !== false) {
    const cap = document.createElement('figcaption');
    cap.className = 'photo-credit';
    cap.textContent = `${entry.author.replace(/\s+/g, ' ').slice(0, 60)} · ${entry.licence}`;
    fig.append(cap);
  }
  return fig;
}

/**
 * The photograph that best represents a station: its own building if we have
 * one, otherwise its city, otherwise nothing. Callers should not have to know
 * which of those exists.
 */
export function stationPhoto(code, opts = {}) {
  return photo(`station-${code}`, opts) || photo(`city-${code}`, opts) || null;
}

/** The photograph for a named service, falling back to a generic rail image. */
const ROUTE_SLUGS = {
  'Acela': 'route-acela',
  'California Zephyr': 'route-california-zephyr',
  'Coast Starlight': 'route-coast-starlight',
  'Empire Builder': 'route-empire-builder',
  'Southwest Chief': 'route-southwest-chief',
  'Northeast Regional': 'route-northeast-regional',
  'Amtrak Cascades': 'route-cascades',
  'Pacific Surfliner': 'route-pacific-surfliner',
};

export function routePhoto(routeName, opts = {}) {
  const slug = ROUTE_SLUGS[routeName];
  if (slug && hasPhoto(slug)) return photo(slug, opts);
  return photo('hero-2', opts) || photo('hero-1', opts);
}

export function creditFor(slot) {
  const e = Photos.map[slot];
  return e ? `${e.author.replace(/\s+/g, ' ')} · ${e.licence}` : '';
}
