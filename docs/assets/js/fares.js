/* ==========================================================================
   Railhead — fare engine and pricing policy
   --------------------------------------------------------------------------
   READ THIS FIRST.

   The prices this module produces are SIMULATED. They are not Amtrak fares and
   are not retrieved from any carrier system.

   That is a fact about the world, not a shortcut. Amtrak publishes no public
   fare API: api.amtrak.com answers 401, amtrak.com edge-blocks non-residential
   traffic, robots.txt disallows the exact /api/* and /services/* paths its own
   booking front-end calls, and the Terms of Use prohibit automated retrieval and
   republication. The only open Amtrak feed is GTFS, which carries schedules and
   no fares at all. Live inventory reaches a reseller through a signed
   distribution agreement and nowhere else — see docs/INTEGRATION.md.

   So the engine is built as a PROVIDER with a swappable implementation. The
   demo ships DemoFareProvider. A production deployment registers a provider
   that calls the contracted feed. Everything downstream — search results,
   basket, breakdown, ticket — reads the same quote shape either way, so the
   seam is real rather than decorative.

   The MODEL is calibrated against published Amtrak fare ranges so that the
   numbers behave plausibly (distance decay, corridor premium, yield curve,
   sleeper multiples). Plausible is the goal; accurate is not achievable and is
   not claimed anywhere in the interface.
   ========================================================================== */

import { Net, milesBetween } from './data.js';

/* --------------------------------------------------------------------------
   Products
   -------------------------------------------------------------------------- */

export const PRODUCTS = {
  saver: {
    key: 'saver', name: 'Saver', kind: 'seat', order: 1,
    blurb: 'Lowest fare, limited seats',
    rules: ['Non-refundable', 'Changes not permitted', 'Limited availability'],
    refundable: false, changeable: false, changeFeePct: 0,
  },
  value: {
    key: 'value', name: 'Value', kind: 'seat', order: 2,
    blurb: 'The everyday coach fare',
    rules: ['Refundable to travel credit', 'Free changes before departure', 'Seats released as the train fills'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
  flexible: {
    key: 'flexible', name: 'Flexible', kind: 'seat', order: 3,
    blurb: 'Refund to your original payment',
    rules: ['Fully refundable to the original payment method', 'Free changes any time', 'Always available'],
    refundable: true, changeable: true, changeFeePct: 0,
  },
  business: {
    key: 'business', name: 'Business', kind: 'seat', order: 4,
    blurb: 'More room, quieter carriage',
    rules: ['Refundable to travel credit', 'Free changes before departure', 'Extra legroom and a wider seat'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
  first: {
    key: 'first', name: 'First', kind: 'seat', order: 5,
    blurb: 'Reserved seat, at-seat service',
    rules: ['Fully refundable', 'Free changes any time', 'At-seat service and lounge access'],
    refundable: true, changeable: true, changeFeePct: 0,
  },
  roomette: {
    key: 'roomette', name: 'Roomette', kind: 'room', order: 6, sleeps: 2,
    blurb: 'Private room for one or two',
    rules: ['Priced per room, not per person', 'Meals included on board', 'Beds made up for the night'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
  bedroom: {
    key: 'bedroom', name: 'Bedroom', kind: 'room', order: 7, sleeps: 2,
    blurb: 'Larger room with a private washroom',
    rules: ['Priced per room, not per person', 'Meals included on board', 'Private toilet and shower'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
  family: {
    key: 'family', name: 'Family Room', kind: 'room', order: 8, sleeps: 4,
    blurb: 'Sleeps two adults and two children',
    rules: ['Priced per room, not per person', 'Meals included on board', 'Spans the full width of the carriage'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
  access: {
    key: 'access', name: 'Accessible Bedroom', kind: 'room', order: 9, sleeps: 2,
    blurb: 'Step-free room on the lower level',
    rules: ['Priced per room, not per person', 'Meals included on board', 'Reserved for travellers who need it'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
  vehicle: {
    key: 'vehicle', name: 'Vehicle', kind: 'vehicle', order: 10,
    blurb: 'Carry your car on the Auto Train',
    rules: ['One vehicle per booking', 'Priority offloading available', 'Arrive at least two hours before departure'],
    refundable: 'credit', changeable: true, changeFeePct: 0,
  },
};

/** Which products a route's declared classes actually unlock. */
export function productsForRoute(route) {
  const out = [];
  const cls = route.cls || ['coach'];
  if (cls.includes('coach')) out.push('saver', 'value', 'flexible');
  if (cls.includes('business')) out.push('business');
  if (cls.includes('first')) out.push('first');
  for (const k of ['roomette', 'bedroom', 'family', 'access', 'vehicle']) {
    if (cls.includes(k)) out.push(k);
  }
  return out.map((k) => PRODUCTS[k]).filter(Boolean).sort((a, b) => a.order - b.order);
}

/* --------------------------------------------------------------------------
   Deterministic noise
   The same search must always return the same prices and the same seat counts,
   or a reviewer refreshing the page sees the product contradict itself.
   -------------------------------------------------------------------------- */

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return (h ^= h >>> 16) >>> 0;
}

/** Stable value in [0,1) for a seed string. */
function rand01(seed) { return hash32(seed) / 4294967296; }

/* --------------------------------------------------------------------------
   The model
   -------------------------------------------------------------------------- */

/**
 * Base carrier fare before bucket, yield and party adjustments.
 *
 * Rail pricing is strongly concave in distance: a 2,000-mile coach ticket is
 * nowhere near ten times a 200-mile one. The exponent and coefficient below are
 * fitted to published Amtrak fares — a 128-mile Pacific Surfliner around $38, a
 * 226-mile Northeast Regional around $90, a 996-mile Lake Shore Limited coach
 * around $134, a 1,996-mile Sunset Limited coach around $205.
 */
const MODEL = {
  coefficient: 1.95,
  exponent: 0.62,
  routeFactor: {
    highspeed: 3.20,  // Acela
    nec: 1.65,        // Northeast Regional, Keystone
    corridor: 1.00,   // state-supported
    long: 0.95,       // long distance
    autotrain: 1.10,
    thruway: 0.75,    // connecting motorcoach
    partner: 0.80,
  },
  bucket: { saver: 0.72, value: 1.00, flexible: 1.42, business: 1.55, first: 1.85 },
  room: {
    roomette: { mult: 2.60, add: 90 },
    bedroom: { mult: 4.40, add: 160 },
    family: { mult: 4.00, add: 140 },
    access: { mult: 4.40, add: 160 },
    vehicle: { mult: 0.00, add: 145 },
  },
  floor: 9,
};

/** Fares climb as the train fills and the date approaches. */
function yieldFactor(daysAhead) {
  if (daysAhead >= 90) return 0.88;
  if (daysAhead >= 60) return 0.92;
  if (daysAhead >= 30) return 1.00;
  if (daysAhead >= 14) return 1.12;
  if (daysAhead >= 7) return 1.28;
  if (daysAhead >= 3) return 1.48;
  if (daysAhead >= 1) return 1.70;
  return 1.85;
}

/** Friday and Sunday carry a premium; midweek is soft. */
function dayFactor(dow) {
  return [0.97, 0.94, 0.94, 0.98, 1.08, 1.00, 1.07][dow] ?? 1;
}

function baseFareFor(miles, route) {
  const f = MODEL.routeFactor[route.cat] ?? 1;
  return MODEL.coefficient * Math.pow(Math.max(miles, 1), MODEL.exponent) * f;
}

/* --------------------------------------------------------------------------
   Provider interface
   -------------------------------------------------------------------------- */

/**
 * A fare provider answers one question: what can be sold on this journey, at
 * what NET price, with how much left. Net means the carrier's price before any
 * agency markup — the markup is applied afterwards by the pricing policy, so
 * that the two are never conflated in the code or on the screen.
 *
 * @typedef {object} Quote
 * @property {string} product          key into PRODUCTS
 * @property {number} netPerUnit       carrier fare, per passenger or per room
 * @property {'person'|'room'|'vehicle'} unit
 * @property {number} remaining        units left at this price
 * @property {boolean} available
 */
export class FareProvider {
  // eslint-disable-next-line no-unused-vars
  async quote(journey, ctx) { throw new Error('not implemented'); }
  get isLive() { return false; }
  get label() { return 'unnamed provider'; }
}

/**
 * The demo provider. Generates a stable, plausible fare set from the journey
 * itself. No network calls, no carrier system, no real availability.
 */
export class DemoFareProvider extends FareProvider {
  get isLive() { return false; }
  get label() { return 'Simulated fares (demonstration data)'; }

  async quote(journey, ctx = {}) {
    return this.quoteSync(journey, ctx);
  }

  quoteSync(journey, ctx = {}) {
    const ymd = ctx.ymd ?? 0;
    const daysAhead = ctx.daysAhead ?? 30;
    const dow = ctx.dow ?? 3;

    // A connecting itinerary is priced as the sum of its legs, which is how a
    // through fare is actually assembled when the legs are separately ticketed.
    const legQuotes = journey.legs.map((leg) => {
      const miles = leg.miles || milesBetween(leg.trip, leg.fromPos, leg.toPos);
      return { leg, miles, base: baseFareFor(miles, leg.trip.route) };
    });

    // Only products every leg can carry are sellable end to end.
    let allowed = null;
    for (const lq of legQuotes) {
      const set = new Set(productsForRoute(lq.leg.trip.route).map((p) => p.key));
      allowed = allowed === null ? set : new Set([...allowed].filter((k) => set.has(k)));
    }
    if (!allowed || !allowed.size) allowed = new Set(['value']);

    const seedBase = `${journey.key}|${ymd}`;
    const yf = yieldFactor(daysAhead) * dayFactor(dow);
    const quotes = [];

    for (const key of allowed) {
      const product = PRODUCTS[key];
      if (!product) continue;
      let net = 0;

      for (const lq of legQuotes) {
        if (product.kind === 'seat') {
          const mult = MODEL.bucket[key] ?? 1;
          // Acela's entry product IS business class, so it must not be marked up twice.
          const isAcela = lq.leg.trip.route.cat === 'highspeed';
          const effective = isAcela && key === 'business' ? 1.0 : mult;
          net += lq.base * effective;
        } else if (product.kind === 'room') {
          const r = MODEL.room[key];
          net += lq.base * r.mult + r.add;
        } else {
          const r = MODEL.room.vehicle;
          net += r.add;
        }
      }

      const jitter = 0.94 + rand01(`${seedBase}|${key}|j`) * 0.12;
      net = net * yf * jitter;
      net = Math.max(MODEL.floor, net);
      // Carriers quote in whole and half dollars, not to the cent.
      net = Math.round(net * 2) / 2;

      const avail = availabilityFor(key, seedBase, daysAhead);
      quotes.push({
        product: key,
        netPerUnit: net,
        unit: product.kind === 'room' ? 'room' : product.kind === 'vehicle' ? 'vehicle' : 'person',
        remaining: avail.remaining,
        available: avail.remaining > 0,
      });
    }

    quotes.sort((a, b) => PRODUCTS[a.product].order - PRODUCTS[b.product].order);
    return quotes;
  }
}

/**
 * Availability. Saver is genuinely scarce and vanishes close to departure,
 * which is the behaviour that makes a fare ladder legible to a traveller.
 */
function availabilityFor(key, seed, daysAhead) {
  const r = rand01(`${seed}|${key}|avail`);
  if (key === 'saver') {
    if (daysAhead < 10) return { remaining: 0 };
    return { remaining: r < 0.42 ? 0 : Math.floor(r * 8) + 1 };
  }
  if (key === 'flexible' || key === 'value') {
    return { remaining: Math.floor(r * 40) + 12 };
  }
  if (key === 'business' || key === 'first') {
    return { remaining: Math.floor(r * 18) + 2 };
  }
  if (key === 'vehicle') return { remaining: Math.floor(r * 30) + 5 };
  // Rooms are few, and on a busy long-distance train they do sell out.
  const n = Math.floor(r * 6);
  return { remaining: daysAhead < 4 && r < 0.35 ? 0 : n };
}

/* --------------------------------------------------------------------------
   Passenger types
   These are the AGENCY's configured discounts, not a restatement of the
   carrier's. A white-label tenant edits them in the agency console, which is
   exactly how a real reseller sets its own retail proposition.
   -------------------------------------------------------------------------- */

export const PASSENGER_TYPES = [
  { key: 'adult', name: 'Adult', ageNote: '16 and over', minAge: 16, discountPct: 0 },
  { key: 'senior', name: 'Senior', ageNote: '65 and over', minAge: 65, discountPct: 10 },
  { key: 'youth', name: 'Youth', ageNote: '13 to 15', minAge: 13, maxAge: 15, discountPct: 50 },
  { key: 'child', name: 'Child', ageNote: '2 to 12', minAge: 2, maxAge: 12, discountPct: 50 },
  { key: 'infant', name: 'Infant', ageNote: 'Under 2, on an adult lap', maxAge: 1, discountPct: 100, free: true },
  { key: 'military', name: 'Military', ageNote: 'Serving or veteran, ID required at boarding', discountPct: 10 },
];

export function passengerType(key) {
  return PASSENGER_TYPES.find((p) => p.key === key) || PASSENGER_TYPES[0];
}

/* --------------------------------------------------------------------------
   Pricing policy — where the agency's margin is applied and disclosed
   -------------------------------------------------------------------------- */

/**
 * @typedef {object} PricingPolicy
 * @property {number} markupPct        percentage added to the carrier fare
 * @property {number} markupFixed      flat amount added per passenger
 * @property {number} [markupMin]      floor on the markup, in currency units
 * @property {number} [markupMax]      cap on the markup, in currency units
 * @property {object} [routeMarkupPct] per route-category override
 * @property {string} serviceChargeLabel  how the markup appears on the breakdown
 */
export const DEFAULT_POLICY = {
  markupPct: 10,
  markupFixed: 0,
  markupMin: 0,
  markupMax: null,
  routeMarkupPct: {},
  serviceChargeLabel: 'Agency service charge',
};

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Turn a quote plus a party into a priced basket line with a full, auditable
 * breakdown. Every number the passenger is shown comes from here, and the
 * markup is a named line rather than something folded into the fare.
 */
export function priceLine({ quote, journey, party, policy = DEFAULT_POLICY, promo = null }) {
  const product = PRODUCTS[quote.product];
  const cat = journey.legs[0].trip.route.cat;
  const pct = policy.routeMarkupPct?.[cat] ?? policy.markupPct ?? 0;

  const items = [];

  if (quote.unit === 'person') {
    for (const p of party.passengers) {
      const type = passengerType(p.type);
      const gross = type.free ? 0 : quote.netPerUnit;
      const discount = type.free ? 0 : round2(gross * (type.discountPct / 100));
      items.push({
        label: type.name,
        who: p.name || type.name,
        net: round2(gross - discount),
        listNet: gross,
        discount,
        discountPct: type.discountPct,
        free: !!type.free,
      });
    }
  } else {
    const units = party.units || 1;
    for (let i = 0; i < units; i++) {
      items.push({
        label: product.name,
        who: quote.unit === 'room' ? `Room ${i + 1}` : 'Vehicle',
        net: quote.netPerUnit,
        listNet: quote.netPerUnit,
        discount: 0,
        discountPct: 0,
        free: false,
      });
    }
  }

  const carrierNet = round2(items.reduce((n, i) => n + i.net, 0));

  let markup = round2(carrierNet * (pct / 100) + (policy.markupFixed || 0) * items.length);
  if (policy.markupMin != null) markup = Math.max(markup, policy.markupMin);
  if (policy.markupMax != null) markup = Math.min(markup, policy.markupMax);
  markup = round2(markup);

  const subtotal = round2(carrierNet + markup);

  let promoAmount = 0;
  let promoLabel = null;
  if (promo && promo.valid) {
    promoAmount = promo.kind === 'pct'
      ? round2(subtotal * (promo.value / 100))
      : round2(Math.min(promo.value, subtotal));
    promoLabel = promo.label;
  }

  const total = round2(Math.max(0, subtotal - promoAmount));

  return {
    product: quote.product,
    productName: product.name,
    unit: quote.unit,
    items,
    carrierNet,
    markup,
    markupPct: pct,
    markupLabel: policy.serviceChargeLabel,
    promoAmount,
    promoLabel,
    subtotal,
    total,
  };
}

/** Sum several priced lines (outbound + return, or several legs of a multi-city). */
export function priceBasket(lines) {
  const sum = (k) => round2(lines.reduce((n, l) => n + (l[k] || 0), 0));
  return {
    lines,
    carrierNet: sum('carrierNet'),
    markup: sum('markup'),
    promoAmount: sum('promoAmount'),
    total: sum('total'),
  };
}

/* --------------------------------------------------------------------------
   Money
   -------------------------------------------------------------------------- */

/**
 * Tenants sell in their own currency. Rates are DECLARED in the tenant config
 * and shown with the date they were set — a reseller quoting a converted price
 * must not imply it is a live rate it does not have.
 */
export function formatMoney(amount, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function convert(amountUsd, rate) {
  return Math.round(amountUsd * rate * 100) / 100;
}

/* --------------------------------------------------------------------------
   Cheapest visible price, for a result row and for the fare calendar
   -------------------------------------------------------------------------- */

const provider = new DemoFareProvider();
export function getProvider() { return provider; }

export function leadPrice(journey, ctx, policy = DEFAULT_POLICY) {
  const quotes = provider.quoteSync(journey, ctx).filter((q) => q.available);
  if (!quotes.length) return null;
  const cheapest = quotes.reduce((m, q) => (q.netPerUnit < m.netPerUnit ? q : m));
  const line = priceLine({
    quote: cheapest,
    journey,
    party: { passengers: [{ type: 'adult' }], units: 1 },
    policy,
  });
  return line.total;
}
