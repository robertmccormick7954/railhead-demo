# Railhead

A white-label rail booking platform. One deployment serves several travel
agencies, each under its own brand, selling Amtrak rail travel as an independent
retailer.

**This is a demonstration.** Schedules are real. Fares, availability, payments and
tickets are simulated. Nothing booked here is a reservation and no document it
issues is valid for travel.

---

## What is real and what is not

| Layer | Here | In production |
|---|---|---|
| Stations, routes, timetable | Amtrak's published GTFS feed — **real** | The same feed, re-imported weekly |
| Fares | **Simulated**, behind a provider interface | A contracted distribution feed |
| Availability | **Simulated**, deterministic | Live carrier inventory |
| Booking, ticketing | **Simulated**, browser-local | A booking call to the distribution channel |
| Payment | **Inert** — nothing transmits | The agency's own provider, hosted fields |

The schedule layer is not a mock. It is 646 stations, 61 routes, 2,992 services
and 38,716 calling points, with a service calendar running a full year, read from
`content.amtrak.com/content/gtfs/GTFS.zip`.

## Why fares are simulated

Amtrak publishes no public fare or booking API. The GTFS feed contains no fare
data at all. Its Terms of Use prohibit automated retrieval and republication, its
robots file disallows the exact paths its own booking front end calls, and its
edge blocks non-residential traffic outright.

There is also a reason that matters more than any of those. Amtrak's ticket
conditions state that it may refuse to carry passengers *"Who present an Amtrak
ticket purchased from an unauthorized third party… Any ticket purchased from an
unauthorized third party will be voided. The ticket holder will not be eligible
for travel or for a refund."*

So this build shows the seam rather than faking the connection. See
[`docs/architecture.html`](https://robertmccormick7954.github.io/railhead-demo/architecture.html).

## Defects we correct in the upstream feed

Found by cross-checking the GTFS against Amtrak's own live train feed, which
states a real UTC offset for every scheduled call.

- **Twelve stations carry the wrong timezone.** Seven Arizona stations are
  labelled `America/Denver`; Arizona does not observe daylight saving. Five Gulf
  Coast stations in Mississippi and Alabama are labelled `America/New_York` when
  they are Central.
- **Two clocks inside one trip.** Stop times are Eastern throughout the feed —
  except on the Mardi Gras Service, where five Gulf Coast stops carry local
  Central times while the New Orleans stop on the same train carries Eastern.

Both are corrected on import, recorded in `docs/data/meta.json` rather than
applied silently, and the import refuses to build if a correction would reorder a
trip. `tools/qa_search.mjs` re-checks every converted time against the live feed:
**2,705 of 2,705 match exactly.**

## Running it

```sh
tools/fetch_gtfs.sh          # download the feed (18 MB, not in the repo)
python3 tools/build_data.py  # compile it to docs/data/*.json
python3 tools/build_pages.py # assemble docs/*.html from pages/*.html
cd docs && python3 -m http.server 8811
```

## Tests

```sh
node   tools/qa_search.mjs   # search, connections, and the timezone chain vs the live feed
node   tools/qa_qr.mjs && python3 tools/qa_qr.py   # QR: structural + decode round trip
node   tools/qa_pdf.mjs      # PDF font metrics and file structure
python3 tools/qa_site.py     # every page x 3 viewports x 3 tenants
```

All four are green: 33, 27+27, 17, and 25 pages clean.

## Layout

```
docs/            the published site (GitHub Pages serves from here)
  assets/js/     data, search, fares, booking, theme, qr, pdf, ticket
  assets/css/    tokens.css (the theming layer) + app.css
  data/          compiled network, station directory, tenant configuration
pages/           page fragments; tools/build_pages.py wraps them in the layout
tools/           build and test scripts
notes/           the page authoring spec
research/        the raw feeds the build reads
```

## White-labelling

A tenant is an entry in `docs/data/tenants.json`: brand colours, typeface
pairing, corner radius, logo mark, wordmark, currency, exchange rate, clock
format, date order, distance unit, payment methods, markup policy, support
details and legal identity. No tenant-specific CSS or markup exists anywhere.

Three storefronts ship, switchable from the header: **Railhead Travel**
(USD, 10%), **Bluebird Travel Co.** (USD, 12%, 9% on long distance),
**Voyager Reizen** (EUR at a declared rate, 24-hour clock, iDEAL/SEPA/Bancontact,
8% + €4).

The two colours that carry text — the label on a filled button and brand-coloured
text on a card — are **computed** from the agency's own brand colour against the
surface it sits on, to a WCAG contrast target. An agency that picks pale yellow
gets dark button text automatically instead of an unreadable storefront.

## What it does that amtrak.com does not

Each is a published limit of the carrier's own retail website, not a guess.

- More than **8 fare-paying passengers** on one reservation (its site sends 9–14
  to a telephone line).
- More than **one traveller with a disability** in a single booking. Amtrak's own
  booking configuration reads: *"To make reservations for more than one traveler
  with a disability, call 1-800-USA-RAIL. A new experience for multiple traveler
  bookings is in progress."*
- **Station assistance requested inside the booking flow.** Amtrak OIG audit
  **OIG-A-2025-009** (11 July 2025) tested its own site and app and found:
  *"When we booked trips online between a station that offered assistance and one
  that did not, we could not request assistance at either station."*
- **Eight-leg multi-city** itineraries (its site caps at five segments).
- More than **4 passenger types** on one reservation.
- A **cheapest-nearby-dates** view, which its site has no equivalent of.

## Dependencies

None at runtime. No framework, no bundler, no package manager, no third-party
script, no CDN. The QR encoder and the PDF writer are written out rather than
imported, because a ticket has to work on a phone with no signal. Fonts are
self-hosted — a white-label product runs on the agency's own domain, and a
third-party font request would put an external call inside someone else's brand.

Build and test tooling needs Python 3 with Playwright, and Node for the JS
suites.

## Trademarks

Amtrak, Acela and the names of individual trains are trademarks of the National
Railroad Passenger Corporation. They are used here only to identify the services
being sold — nominative use, under the test in *New Kids on the Block v. News
America Publishing, Inc.*, 971 F.2d 302 (9th Cir. 1992). No Amtrak logo, wordmark
or trade dress is used, and every page carries a disclosure that the storefront is
independent and not affiliated with, endorsed by, or an agent of Amtrak.
