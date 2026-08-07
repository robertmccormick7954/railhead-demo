# Railhead — white-label rail booking platform (client: tourism/travel booking)

**LIVE: https://robertmccormick7954.github.io/railhead-demo/**
Repo `robertmccormick7954/railhead-demo` (public, Pages from `main` `/docs`).
Built 2026-08-06. Status: **delivered, awaiting the client's review and Amtrak's technical team.**

## What this is

A demo of a white-label rail booking platform the client wants to sell to small
travel agencies, on the back of a stated Amtrak distribution contract. One
deployment, several agency storefronts, each fully rebranded.

## REDESIGN 2026-08-06 (round 2) — Bob rejected the first design outright

His words: colour sense "pretty bad"; "no images anywhere, that's the BIGGEST
FLAW"; "the highlight color is black and the text color is also black"; purple
"looks terrible"; schemes "100% CRAP"; kill the agency dropdown; target "THE OLD
AND THE YOUNG BOTH"; cut the extra text pages.

**The black-on-black was a real bug and my QA missed it.** `applyTenant` set
`--surface-invert` to the tenant's dark brand colour while `--text-invert` kept
the value the DARK SCHEME had set for a *light* invert surface → footer at
**1.29:1**. The gate only ever ran the light scheme. Fixed structurally: the text
colour on an inverted surface is now COMPUTED from that surface and cannot be
authored; `qa_site.py` gained `--scheme`.

**Dark scheme deleted.** One design, half the colour pairs, and light-on-dark is
worse for older readers with astigmatism.

**New palette:** deep harbour blue `#0A5670` at **195°** — deliberately between
Amtrak's navy (207°) and the rejected spruce (171°) so it reads as neither.
Accent = warm ochre `#A15C00`, money and live status only. Body 7:1 AAA, brand
link 7:1, footer 16:1. No purple anywhere.

**38 real photographs** from Wikimedia Commons (`tools/fetch_images.py`), all
commercially licensed, **none from amtrak.com** (copyrighted, ToU forbids it, and
the site 403s this box anyway). Attribution auto-generated onto `credits.html`.
⚠ Free-text Commons search is *dangerous*: it returned **Hamburg for "San Diego"**,
**Hillary Clinton for "Washington DC"**, a **shooting memorial for "Sacramento"**
and a **cartoon for "Boston"**. Fixed by requiring the subject in the file title +
banning illustrations/panoramas/person-and-event subjects + rejecting a pre-2005
year. ⚠ Two pixel-based sepia detectors (mean saturation, hue concentration) BOTH
failed — most city photos are sky-dominated — and are left in the file documented
as failures so nobody repeats them.

**Built to the older-adult evidence** (NN/g, W3C WAI-AGE, WCAG 2.2): 18px body
(14pt — measurably faster past 60), **44×44 targets** (SC 2.5.5, the one with no
spacing exception; 2.5.8's 24px floor is what ruins calendars), 7:1 contrast, no
hover-only, no icon-only, input normalised not rejected, card block encapsulated
with a plain-language security line (Baymard: 19% abandon on card distrust).

⚠ **Design research contradicted my first instinct and I changed course:**
measured across 16 rail/airline/OTA sites, **14 of 16 put the search form on flat
colour, not a photo**, and **imagery stops dead at the results page** (Google
Flights results = 0 images). So the hero is flat brand colour with the form on it,
photography starts in the band below, and the result row carries no picture — it
reappears in the expanded itinerary.

**Removed:** storefront switcher, the disclosure strip above every header (now one
footer line), and `about.html`, `architecture.html`, `platform.html`.

## The one place I deliberately diverged from the brief

Bob asked for a site "almost similar to Amtrak… same fonts, color themes" that
would "look and feel like the official website". **I did not build a visual clone
and did not use Amtrak's logo, wordmark or trade dress.** Reasons, in order:

1. A reseller that presents itself as the carrier is the single thing that kills
   a distribution agreement.
2. Amtrak's own ticket conditions void tickets bought from an unauthorised third
   party, with no travel and no refund — so "looks official" is the exact
   impression that harms the end customer.
3. What the client is actually selling agencies is *their own* brand on the
   product. A clone of Amtrak would be the wrong demo.

Instead: its own identity, plus a live tenant switcher proving three storefronts
run off one deployment. Amtrak is named in body text only (nominative use).
**If Bob pushes back, this is the decision to re-open — the theming engine can
carry any palette he wants in one JSON edit; what should not come back is the
logo and the implied affiliation.**

## What is real vs simulated

- **Real:** the whole schedule layer, from Amtrak's published GTFS
  (`content.amtrak.com/content/gtfs/GTFS.zip`). 646 stations, 61 routes, 2,992
  services, 38,716 calling points, calendar to 2027-08-02.
- **Simulated and labelled everywhere:** fares, availability, booking, payment,
  tickets.

## ⚠ Live Amtrak pricing is IMPOSSIBLE without a contract — verified first-hand

- No public fare/booking API. `api.amtrak.com` answers **401**;
  developer./partner.amtrak.com are NXDOMAIN.
- `amtrak.com` **403s / resets the connection** from this box (Akamai, datacenter
  IP). Confirmed by me directly and by two research agents.
- `robots.txt` disallows `/api/*`, `/services/*`, `/reference-data/*` — the exact
  paths its own booking front end calls.
- ToU bans robots/spiders/data-mining, framing/mirroring, and deep-linking to
  anything but the bare homepage.
- GTFS contains **zero** fare data. No GTFS-RT either. Track-a-Train is
  **AES-encrypted on purpose**.
- ⭐ **Amtrak's agent portal is now run by Distribusion Technologies**
  (`portal.railagent.com`, proven from its script tag). That plus a direct Amtrak
  B2B agreement or an aggregator (SilverRail) are the only three real routes in.
- 🛑 Decisive clause to show the client: Amtrak may refuse to carry anyone who
  "present[s] an Amtrak ticket purchased from an unauthorized third party… Any
  ticket purchased from an unauthorized third party will be voided. The ticket
  holder will not be eligible for travel or for a refund."

So fares sit behind a `FareProvider` interface: `DemoFareProvider` ships, a real
feed drops in. The seam is shown, not faked.

## ⚠ Two real defects in Amtrak's own GTFS, found and corrected

Cross-checked against Amtrak's live train feed (which states a real UTC offset
per call):

1. **12 stations wrongly zoned** — 7 Arizona stations as `America/Denver`
   (Arizona has no DST); 5 Gulf Coast stations (MS/AL) as `America/New_York`.
2. **Two clocks inside one trip** — the feed is Eastern throughout *except* the
   Mardi Gras Service, where 5 Gulf Coast stops carry local Central while the New
   Orleans stop on the same train carries Eastern.

Both corrected on import, recorded in `docs/data/meta.json`, and the build
**refuses to run** if a correction would reorder a trip.
✅ `tools/qa_search.mjs`: **2,705/2,705** converted times match the live feed.

## ⚠ Fare structure — got this wrong first, then fixed

I first modelled **Saver / Value / Flexible / Business / First**. **Amtrak retired
Saver.** The live structure is **three buckets: Flex / Value / Sale**, applied
across Coach, Acela Business and Acela First.
- Flex: full refund to original payment, changes free (fare difference may apply)
- Value: **30% forfeited** (was 25% until 13 Apr 2026), **changes not permitted**
- Sale: 50% forfeited, no changes, only during an active sale
- **Non-Acela Business is NOT a bucket** — always fully refundable/changeable
- **Acela First has no rules of its own** — follows the bucket bought
- **Private rooms**: 121d+ full · 120–15d 75% to payment · **inside 14d 75% as a
  NON-refundable eVoucher**
- Risk-free: 24h from purchase (1h unreserved). No-show forfeits everything.
- Flex is only **~11%** over Value (Amtrak's own worked example), not 42%.

## The product argument — documented carrier limits we remove

All from Amtrak's own published booking-widget config and a federal audit:
- max **8** fare-paying passengers online (9–14 → phone, 15+ → form)
- max **5** segments, max **4** passenger types, 335-day horizon, 15-min cutoff
- ⭐ *"To make reservations for more than one traveler with a disability, call
  1-800-USA-RAIL. A new experience for multiple traveler bookings is in progress."*
- ⭐ **OIG-A-2025-009** (11 Jul 2025): its own testers **could not request station
  assistance online at all**.

We do all of these in-flow. That is the pitch, and it is evidenced, not asserted.

## Build

```
tools/fetch_gtfs.sh && python3 tools/build_data.py && python3 tools/build_pages.py
cd docs && python3 -m http.server 8811
```
Tests (all green): `qa_search.mjs` 33 · `qa_qr.mjs`+`qa_qr.py` 27+27 ·
`qa_pdf.mjs` 17 · `qa_site.py` 25 pages × 3 viewports × 3 tenants CLEAN.

## Notable engineering

- **Zero runtime dependencies.** QR encoder and PDF writer written out by hand so
  a ticket works offline. Fonts self-hosted (EU tenants + agency domains).
- **QR verified twice**: module-for-module vs a reference encoder, and by decoding
  the rendered image. ⚠ Amtrak's real eTicket barcode **is a QR** (decoded sample:
  reservation number + purchase date) — not Aztec.
- **Ticket carries NO price**; a separate sales receipt page does. That is how
  real rail eTickets work.
- **Specimen flag is in the barcode payload**, not just printed — rail standards
  (ERA TAP TSI B.12) define exactly such a bit for test documents.
- **Contrast is computed, not configured**: button-label and brand-text colours
  are derived from each tenant's brand colour against its surface, to WCAG AA.
- ⚠ `--text-mute` had to be darkened to `#5C6E68`; the first QA run found **111**
  contrast failures, all systematic.

## Traps hit (don't repeat)

- ⚠ `mv site docs` merged INTO an existing `docs/` and **destroyed
  `data/tenants.json`** (hand-written, not generated). Caught by a 404. Check for
  an existing target before `mv`.
- ⚠ GitHub Pages on `timothywade8452` inherited a **user-level custom domain**
  (`tryretafit.com`) from that account's `<user>.github.io` CNAME — project pages
  silently published under an affiliate domain. Moved to `robertmccormick7954`.
  **Check for a `<user>.github.io` repo before choosing a Pages account.**
- ⚠ My QR generator polynomial was **built reversed** (`[2,3,1]` not `[1,3,2]`) —
  looked plausible, corrupted every EC codeword. And I "fixed" correct format-bit
  placement by misreading the spec's `(x,y)` as `(row,col)`.
- ⚠ Packed font-width string in the PDF writer mis-parsed → every measurement
  wrong → silently truncated ticket text. Replaced with an explicit table + test.
- ⚠ An inline `grid-template-columns` beat the responsive media query and left the
  departure board **143px wide** on mobile.

## Open / next

- Bob to confirm the no-clone decision (see above) before any client demo.
- Client must answer: which of the three distribution routes they actually hold.
  The whole product is gated on the agreement, not the code.
- Not built: real payment provider, account registration (Bob deferred it),
  language packs (locale differs per tenant; UI text is English only).
- ⚠ Research read amtrak.com **via Wayback** (403 from here). Re-verify any fare
  figure from a residential IP before it goes in front of the carrier.
