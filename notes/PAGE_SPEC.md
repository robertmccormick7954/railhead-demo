# Page authoring spec — Railhead

Read this in full before writing a page fragment. Every rule here exists because
breaking it produces something a carrier's technical reviewer would reject.

## What Railhead is

A white-label rail booking platform. One deployment serves several travel
agencies, each under its own brand. The demo storefront sells **Amtrak** rail
travel as an independent retailer. It is **not** Amtrak, does not look like
Amtrak, and never implies affiliation.

Three demo tenants exist: `railhead` (Railhead Travel), `bluebird` (Bluebird
Travel Co.), `voyager` (Voyager Reizen B.V., sells in EUR). Never hard-code a
tenant's name, phone, email, currency or colour into page copy — the chrome
injects those. Write copy that is true for any tenant.

## File format

Fragments live in `pages/`. `pages/foo.html` builds to `site/foo.html`.
Start with front matter, then the page body. No `<html>`, `<head>`, `<body>`,
no header, no footer — the layout supplies all of that.

```html
<!--railhead
{"title":"Accessibility — Railhead","description":"One sentence, under 155 characters.","script":"generic","nav":"help"}
-->
<section class="band">
  <div class="wrap">
    ...
  </div>
</section>
```

Front matter keys: `title` (required), `description` (required), `script`
(default `generic`), `nav` (one of `book`, `manage`, `routes`, `stations`,
`help`, or omit), `robots` (default `noindex, nofollow` — leave it).

`script` must be `generic` unless you have been told otherwise. `generic` boots
the chrome and loads no timetable data.

## Layout classes you may use

Structure — `band`, `band-tight`, `band-surface`, `band-sunk`, `band-rule`,
`wrap`, `wrap-narrow`, `wrap-wide`, `grid grid-2|grid-3|grid-4`,
`grid-sidebar`, `row`, `row-wrap`, `row-between`, `row-top`, `spacer`,
`stack`, `stack-2`, `stack-6`, `stack-8`.

Type — `sign` (station-signage display face, hero headings only), `eyebrow`
(small mono label above a heading), `lede`, `prose` (wrap long-form text in
this; it sets a readable measure and styles headings, lists, links),
`text-soft`, `text-mute`, `mono`, `code`, `time`, `money`, `nowrap`,
`visually-hidden`, `text-center`, `text-right`.

Components — `card`, `card-flush`, `card-head`, `card-body`, `card-foot`,
`card-raise`, `note` + `note-info|note-warn|note-err|note-ok`, `badge` +
`badge-brand|badge-ok|badge-warn|badge-err|badge-info|badge-accent`,
`btn` + `btn-secondary|btn-ghost|btn-accent|btn-lg|btn-sm|btn-block`,
`table` (wrap in `table-scroll`), `table th.num`/`td.num` for figures,
`tabs`/`tab`, `empty`/`empty-title`/`empty-actions`, `link-quiet`.

Do not invent class names — if a layout needs something that does not exist,
build it from the primitives above. Do not write inline `style` attributes
except for a one-off `max-width` or `grid-column`.

## Hard content rules

1. **No placeholders.** No "lorem ipsum", no "coming soon", no "TODO", no
   "[insert x]", no empty sections, no fake logos. Every sentence ships.
2. **No invented facts about Amtrak.** You may state only what is listed under
   "Verified facts" below, or things that are obviously true of the demo itself.
   If you want to say something else about Amtrak, leave it out.
3. **No invented facts about the agency.** No customer counts, no "trusted by
   50,000 travellers", no awards, no testimonials, no founding date, no staff
   names, no ARC/IATA accreditation claims, no press mentions.
4. **No prices in copy.** Fares are generated at runtime and vary by tenant
   currency. Never write a dollar amount into a content page.
5. **No phone numbers or email addresses in copy.** The chrome renders the
   tenant's own. If a page needs to point at support, link to `contact.html`.
6. **Never imply the demo can issue a real ticket.** Where relevant, say plainly
   that this is a demonstration, schedules are real, and everything
   transactional is simulated.
7. **Never use an Amtrak logo, wordmark, or Amtrak's colours.** The word
   "Amtrak" in body text, in our own typeface, is correct and sufficient.
8. **Do not link to amtrak.com**, at any depth.
9. British or American spelling: use **British** spelling in prose
   ("organise", "recognise", "travelled"), except in proper nouns and in
   quoted material. Keep it consistent.
10. Sentence case for headings and buttons. Active voice. A button says what
    happens: "Find trains", not "Submit".

## Accessibility rules

- One `<h1>` per page, then `<h2>`/`<h3>` in order with no level skipped.
- Every `<section>` that is a landmark gets an `aria-labelledby` pointing at its
  heading, or an `aria-label`.
- Tables get a `<caption>` and `<th scope="col">` / `<th scope="row">`.
- Never use a `<div>` for something clickable — use `<button>` or `<a>`.
- Do not use colour alone to carry meaning.
- Icons are decorative: `aria-hidden="true"` and `focusable="false"`.

## Verified facts you may use

These were verified from primary sources. Quote them accurately or not at all.

**Schedule data**
- Amtrak publishes an official GTFS feed at
  `content.amtrak.com/content/gtfs/GTFS.zip`. Our schedules come from it.
- It contains 646 stops, 61 routes and 2,992 trips, with a service calendar
  running to 2 August 2027. It contains **no fare data of any kind**.
- Amtrak does not publish a GTFS-Realtime feed.
- We found and corrected 12 timezone defects in that feed: seven Arizona
  stations were labelled `America/Denver` (Arizona does not observe daylight
  saving), and five Gulf Coast stations were labelled `America/New_York` when
  Mississippi and Alabama are Central. Five of those also had their stop times
  written in local time rather than the feed's Eastern convention.

**Distribution**
- Amtrak publishes no public fare or booking API.
- Amtrak's Terms of Use prohibit using "any robot, spider, site search/retrieval
  application or other manual or automatic device or process to retrieve, index,
  'data mine' or in any way reproduce or circumvent the navigational structure
  or presentation of the Site or its contents".
- Amtrak's ticket Terms and Conditions state that Amtrak may refuse to carry
  passengers "Who present an Amtrak ticket purchased from an unauthorized third
  party. Amtrak tickets may only be sold or issued by Amtrak or an authorized
  travel agent/tour operator. Any ticket purchased from an unauthorized third
  party will be voided. The ticket holder will not be eligible for travel or for
  a refund."
- Live inventory reaches a reseller only through a distribution agreement:
  directly with Amtrak, through the agent portal now operated by Distribusion
  Technologies, or through an aggregator such as SilverRail.

**Amtrak booking limits** (from Amtrak's own published booking-widget
configuration and help pages)
- Booking horizon 335 days; multi-ride 90 days.
- Online booking closes 15 minutes before departure.
- Maximum 5 segments in one online multi-city itinerary.
- Maximum 8 fare-paying passengers per online transaction; 9 to 14 by phone;
  15 or more by group request form.
- Maximum 4 different passenger types in one reservation.
- Passengers aged 13, 14 and 15 travelling alone cannot be booked online.
- Amtrak's own booking configuration states: "To make reservations for more than
  one traveler with a disability, call 1-800-USA-RAIL. A new experience for
  multiple traveler bookings is in progress."
- Amtrak Office of Inspector General audit **OIG-A-2025-009**, *Train
  Operations: The Company Can Improve the Quality of Customer Service to
  Passengers with Disabilities*, 11 July 2025, tested booking on Amtrak's
  website and app and found: "When we booked trips online between a station that
  offered assistance and one that did not, we could not request assistance at
  either station."

**Products**
- Rail fare buckets: **Flex, Value and Sale** — three, not five. There is no
  "Saver" fare and no "Flexible" fare; those names are out of date and must never
  appear. The buckets apply across Coach, Acela Business and Acela First.
  Flex: full refund to the original payment before departure, no fee; changes
  free but a fare difference may apply. Value: 30% forfeited on cancellation,
  70% refunded, changes not permitted. Sale: 50% forfeited, 50% refunded,
  changes not permitted, available only during an active sale.
- Non-Acela Business Class is NOT one of those buckets — it is "fully refundable
  and changeable without any fees".
- Acela First Class has no rules of its own: refund and change follow whichever
  bucket was purchased.
- Private rooms use a time-based refund scale: 121 days or more, full refund;
  120 to 15 days, 75% to the original payment; within 14 days, 75% as a
  NON-REFUNDABLE eVoucher.
- Risk-free cancellation: full refund if cancelled within 24 hours of purchase
  and before departure (1 hour for unreserved services).
- No-show: all fares are non-refundable and non-changeable after departure.
- Sleeping accommodations: Roomette, Bedroom, Family Room, Accessible Bedroom.
  Family Rooms exist on Superliner equipment only. Accommodations are priced per
  room and include meals on board.
- Business Class is not sold on every long-distance train.
- Senior discount: Amtrak states travellers 65 and over are eligible for 10% off
  most rail fares on most trains; on services operated jointly with VIA Rail
  Canada the age is 60. Proof of age is required.
- Pets: dogs and cats only, in a carrier, 20-pound combined limit, trips up to
  7 hours on most routes, one pet per customer, fee per segment, carrier counts
  as one piece of carry-on. Not available on the Auto Train, and not into Canada
  on the Adirondack, Maple Leaf or Cascades.
- Amtrak Thruway Connecting Services are scheduled motorcoach legs that appear
  inside a rail itinerary.

**Tickets**
- An Amtrak eTicket carries a QR code (ISO/IEC 18004). A decoded example
  contained the reservation number and purchase date, nothing more.
- The reservation number is 6 alphanumeric characters. The 13-digit ticket
  number appears on the sales receipt, not on the eTicket.
- An Amtrak eTicket shows **no price**. Fare and payment details are on a
  separate sales receipt document.
- European rail ticketing standards (ERA TAP TSI Technical Document B.12) define
  a "specimen" flag carried inside the barcode data, described as "The bit must
  be set if the barcode is issued for test purpose", plus a test-key regime under
  which "tickets signed using a test key can never be considered as valid".
- IATA Resolution 792 standardises boarding-pass barcode *data* but explicitly
  does not define a boarding-pass *layout*.
- QR Code requires a four-module quiet zone on all four sides.

**Legal**
- Nominative fair use test, *New Kids on the Block v. News America Publishing,
  Inc.*, 971 F.2d 302 (9th Cir. 1992): "First, the product or service in question
  must be one not readily identifiable without use of the trademark; second, only
  so much of the mark or marks may be used as is reasonably necessary to identify
  the product or service; and third, the user must do nothing that would, in
  conjunction with the mark, suggest sponsorship or endorsement by the trademark
  holder."
- There is **no** US statute giving Amtrak special protection over its name.
  49 U.S.C. § 24304 is about employee stock ownership plans and is irrelevant —
  do not cite it. Ordinary trademark law applies.
- WCAG 2.1 Level AA is the working accessibility standard for this build.

## Tone

Plain, specific, unhurried. This is transport infrastructure, not a startup
landing page. No exclamation marks. No "seamless", "effortless", "revolutionary",
"game-changing", "powerful", "robust", "cutting-edge", "unlock", "elevate",
"delve", "in today's fast-paced world". No em-dash-heavy rhythm. No rhetorical
questions as headings. Do not open a page by restating its own title.

Short paragraphs. Concrete nouns. If a sentence could appear on any travel site,
rewrite it so it could only appear on this one.
