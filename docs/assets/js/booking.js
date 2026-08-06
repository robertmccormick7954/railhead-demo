/* ==========================================================================
   Railhead — basket, booking record and the rules that govern both
   --------------------------------------------------------------------------
   State lives in the visitor's own browser and goes nowhere else. The basket is
   sessionStorage (it belongs to this attempt at booking); completed bookings are
   localStorage (they must survive a closed tab, because the visitor is going to
   come back for the ticket).

   The operating limits below are the carrier's published online limits. We
   implement them because a reseller that quietly exceeds them produces bookings
   the carrier cannot honour. Where we deliberately go FURTHER than the carrier's
   own website, it is marked, because those are the product's reasons to exist
   and a reviewer should be able to find them in the code.
   ========================================================================== */

import { Net, station, ymdOf, dateFromYmd, addDays, localYmd } from './data.js';

const BASKET_KEY = 'railhead.basket';
const BOOKINGS_KEY = 'railhead.bookings';

/* --------------------------------------------------------------------------
   Operating limits
   -------------------------------------------------------------------------- */

export const LIMITS = {
  /** Carrier's published online booking horizon, in days. */
  bookingHorizonDays: 335,
  /** Online booking closes this many minutes before departure. */
  cutoffMinutes: 15,
  /** Carrier's online cap on segments in one multi-city itinerary. */
  carrierMaxSegments: 5,
  /** Carrier's online cap on fare-paying passengers in one transaction. */
  carrierMaxPassengers: 8,
  /** Carrier's online cap on distinct passenger types in one reservation. */
  carrierMaxPassengerTypes: 4,

  /* --- Where this platform goes further than the carrier's own website ---
     Each of these corresponds to a documented limitation of amtrak.com. They
     are not arbitrary: exceeding the carrier's ONLINE cap is fine because the
     booking is completed through a distribution channel, not through the
     carrier's retail website. */
  maxSegments: 8,
  maxPassengers: 14,
  maxPassengerTypes: 6,
  /** amtrak.com refuses more than one traveller with a disability online. */
  maxAssistanceTravellers: 14,
};

/** How many passengers can still be added before the carrier's cap applies. */
export function passengerCapNote(count) {
  if (count > LIMITS.maxPassengers) {
    return { level: 'err', text: `Groups of more than ${LIMITS.maxPassengers} are handled as a group enquiry.` };
  }
  if (count > LIMITS.carrierMaxPassengers) {
    return {
      level: 'info',
      text: `The carrier's own website stops at ${LIMITS.carrierMaxPassengers} passengers per booking. `
          + 'We keep your party on one reservation.',
    };
  }
  return null;
}

/* --------------------------------------------------------------------------
   Identifiers
   -------------------------------------------------------------------------- */

/* I, O, 0 and 1 are excluded: a reservation number gets read aloud down a phone
   line and copied off a printed page, and those four are where it goes wrong. */
const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeReservationNumber() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join('');
}

/** 13 digits, matching the shape of a rail ticket number. */
export function makeTicketNumber() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => b % 10).join('');
  return body + luhnCheckDigit(body);
}

function luhnCheckDigit(digits) {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

/* --------------------------------------------------------------------------
   Basket
   -------------------------------------------------------------------------- */

/**
 * A basket is a search plus the selections made against it. Journeys are stored
 * by the identifiers needed to rebuild them, never as decoded objects — the
 * timetable is reloaded on every page and the object graph would go stale.
 */
export function emptyBasket() {
  return {
    v: 1,
    mode: 'return',
    legs: [],
    passengers: [{ type: 'adult' }],
    selections: [],
    assistance: { required: false, travellers: [], notes: '', stations: [] },
    extras: { bikes: 0, pets: 0, checkedBags: 0 },
    contact: { firstName: '', lastName: '', email: '', phone: '' },
    promo: null,
    createdAt: Date.now(),
  };
}

export function loadBasket() {
  try {
    const raw = sessionStorage.getItem(BASKET_KEY);
    if (!raw) return emptyBasket();
    const b = JSON.parse(raw);
    return b && b.v === 1 ? b : emptyBasket();
  } catch {
    return emptyBasket();
  }
}

export function saveBasket(basket) {
  try { sessionStorage.setItem(BASKET_KEY, JSON.stringify(basket)); } catch { /* private mode */ }
  return basket;
}

export function clearBasket() {
  try { sessionStorage.removeItem(BASKET_KEY); } catch { /* ignore */ }
}

/** Store just enough to find the journey again after a page load. */
export function journeyRef(journey) {
  return {
    legs: journey.legs.map((l) => ({
      trip: l.trip.i, from: l.fromPos, to: l.toPos, svc: l.svcYmd, dep: l.depInstant,
    })),
    key: journey.key,
  };
}

/** Rebuild a journey object from a stored reference. Returns null if it no longer exists. */
export function resolveJourney(ref) {
  if (!ref?.legs?.length) return null;
  const legs = [];
  for (const r of ref.legs) {
    const trip = Net.trips[r.trip];
    if (!trip || !trip.stops[r.from] || !trip.stops[r.to]) return null;
    const arrStop = trip.stops[r.to];
    legs.push({
      trip,
      fromPos: r.from,
      toPos: r.to,
      svcYmd: r.svc,
      depInstant: r.dep,
      arrInstant: r.dep + (arrStop.arr - trip.stops[r.from].dep) * 60000,
      fromStn: trip.stops[r.from].s,
      toStn: arrStop.s,
      miles: arrStop.mi - trip.stops[r.from].mi,
    });
  }
  const changes = [];
  for (let i = 1; i < legs.length; i++) {
    const wait = Math.round((legs[i].depInstant - legs[i - 1].arrInstant) / 60000);
    changes.push({
      stn: legs[i - 1].toStn,
      arriveInstant: legs[i - 1].arrInstant,
      departInstant: legs[i].depInstant,
      waitMin: wait,
      tight: wait < 50,
    });
  }
  const depInstant = legs[0].depInstant;
  const arrInstant = legs[legs.length - 1].arrInstant;
  return {
    key: ref.key,
    legs,
    changes,
    depInstant,
    arrInstant,
    durationMin: Math.round((arrInstant - depInstant) / 60000),
    transfers: legs.length - 1,
    miles: legs.reduce((n, l) => n + l.miles, 0),
    modes: [...new Set(legs.map((l) => l.trip.route.mode))],
  };
}

/* --------------------------------------------------------------------------
   Validation
   -------------------------------------------------------------------------- */

export function validateSearchDate(ymd) {
  const today = ymdOf(new Date());
  if (ymd < today) return 'Choose a date from today onwards.';
  const horizon = ymdOf(addDays(new Date(), LIMITS.bookingHorizonDays));
  if (ymd > horizon) {
    return `Trains can be booked up to ${LIMITS.bookingHorizonDays} days ahead, to `
         + `${dateFromYmd(horizon).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
  }
  const calEnd = Net.meta?.validity?.calendar_end;
  if (calEnd && ymd > calEnd) {
    return 'The published timetable does not reach that date yet.';
  }
  return null;
}

export function tooCloseToDeparture(depInstant) {
  return depInstant - Date.now() < LIMITS.cutoffMinutes * 60000;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Accept what people actually type and normalise it, rather than rejecting it.
 * "Inflexible input forms requiring specific formatting" is one of the few
 * failures that shows up in all three of NN/g's rounds of older-adult testing,
 * across nearly twenty years. A phone number with brackets, a card number with
 * spaces and a reference typed in lower case are all valid input.
 */
export function normalisePhone(value) {
  const s = String(value || '').trim();
  const plus = s.startsWith('+') ? '+' : '';
  return plus + s.replace(/[^\d]/g, '');
}

export function normaliseReference(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function normaliseEmail(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

export function validateContact(contact) {
  const errors = {};
  if (!contact.firstName?.trim()) errors.firstName = 'Enter the lead traveller’s first name.';
  if (!contact.lastName?.trim()) errors.lastName = 'Enter the lead traveller’s last name.';
  if (!contact.email?.trim()) errors.email = 'Enter an email address so we can send the ticket.';
  else if (!EMAIL.test(normaliseEmail(contact.email))) errors.email = 'That email address is not complete.';
  return errors;
}

export function validatePassengers(passengers) {
  const errors = {};
  passengers.forEach((p, i) => {
    if (!p.firstName?.trim()) errors[`p${i}.firstName`] = 'Enter a first name.';
    if (!p.lastName?.trim()) errors[`p${i}.lastName`] = 'Enter a last name.';
  });
  const types = new Set(passengers.map((p) => p.type));
  if (types.size > LIMITS.maxPassengerTypes) {
    errors.types = `A single booking can mix up to ${LIMITS.maxPassengerTypes} passenger types.`;
  }
  const paying = passengers.filter((p) => p.type !== 'infant').length;
  if (paying === 0) errors.party = 'A booking needs at least one fare-paying passenger.';
  if (paying > LIMITS.maxPassengers) {
    errors.party = `Parties over ${LIMITS.maxPassengers} are booked as a group enquiry.`;
  }
  const infants = passengers.filter((p) => p.type === 'infant').length;
  const adults = passengers.filter((p) => p.type === 'adult' || p.type === 'senior' || p.type === 'military').length;
  if (infants > adults) errors.infants = 'Each infant travels on the lap of an accompanying adult.';
  return errors;
}

/* --------------------------------------------------------------------------
   Bookings
   -------------------------------------------------------------------------- */

export function loadBookings() {
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveBooking(record) {
  const list = loadBookings();
  const at = list.findIndex((b) => b.pnr === record.pnr);
  if (at >= 0) list[at] = record; else list.unshift(record);
  try { localStorage.setItem(BOOKINGS_KEY, JSON.stringify(list.slice(0, 60))); } catch { /* ignore */ }
  return record;
}

export function findBooking(pnr, lastName) {
  const wanted = String(pnr || '').trim().toUpperCase();
  const list = loadBookings();
  const hit = list.find((b) => b.pnr === wanted);
  if (!hit) return null;
  if (lastName && hit.contact.lastName.trim().toLowerCase() !== String(lastName).trim().toLowerCase()) return null;
  return hit;
}

/**
 * Freeze a basket into a booking record. Everything the ticket, the receipt and
 * the manage screen need is captured here, because the timetable underneath can
 * be rebuilt from a newer feed and the record must not change retrospectively.
 */
export function createBooking({ basket, priced, tenantId, currency, rate }) {
  const pnr = makeReservationNumber();
  const now = Date.now();

  const legs = basket.selections.map((sel, i) => {
    const journey = resolveJourney(sel.journeyRef);
    return {
      index: i,
      label: sel.label,
      product: sel.product,
      productName: sel.productName,
      journeyRef: sel.journeyRef,
      ticketNumbers: basket.passengers.map(() => makeTicketNumber()),
      summary: journey ? {
        from: Net.stations[journey.legs[0].fromStn].c,
        to: Net.stations[journey.legs[journey.legs.length - 1].toStn].c,
        depInstant: journey.depInstant,
        arrInstant: journey.arrInstant,
        transfers: journey.transfers,
        durationMin: journey.durationMin,
        miles: journey.miles,
        services: journey.legs.map((l) => ({
          route: l.trip.route.n,
          num: l.trip.num,
          mode: l.trip.route.mode,
          from: Net.stations[l.fromStn].c,
          to: Net.stations[l.toStn].c,
          dep: l.depInstant,
          arr: l.arrInstant,
        })),
      } : null,
    };
  });

  return saveBooking({
    v: 1,
    pnr,
    status: 'confirmed',
    createdAt: now,
    tenantId,
    currency,
    rate,
    contact: { ...basket.contact },
    passengers: basket.passengers.map((p) => ({ ...p })),
    assistance: { ...basket.assistance },
    extras: { ...basket.extras },
    legs,
    money: {
      carrierNet: priced.carrierNet,
      markup: priced.markup,
      promoAmount: priced.promoAmount,
      total: priced.total,
      lines: priced.lines.map((l) => ({
        productName: l.productName,
        carrierNet: l.carrierNet,
        markup: l.markup,
        markupPct: l.markupPct,
        markupLabel: l.markupLabel,
        promoAmount: l.promoAmount,
        promoLabel: l.promoLabel,
        total: l.total,
        items: l.items,
      })),
    },
    /* Every document this build issues is a specimen. The rail ticketing
       standards carry an explicit flag for exactly this, and honouring it is
       more honest than a watermark alone. See ticket.js. */
    specimen: true,
  });
}

export function cancelBooking(pnr) {
  const booking = findBooking(pnr);
  if (!booking) return null;
  booking.status = 'cancelled';
  booking.cancelledAt = Date.now();
  return saveBooking(booking);
}

/** A journey is in the past if its last arrival has gone. */
export function isPast(booking) {
  const last = booking.legs
    .map((l) => l.summary?.arrInstant || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return last > 0 && last < Date.now();
}

export { station, localYmd };
