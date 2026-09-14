# Redesign around the lot lifecycle

## Why

The app answers "should I bid, and how much?" well, but it stops at *won*. Everything after — arrival, checking units, deciding what to sell whole and what to part out, listing on several marketplaces, tracking shelf time, logging hours — was bolted on as unconnected tabs (Inventory, Listings, Storage, Calendar, Taxes, Profile). The result is nine tabs with no thread through them, and the owner does not open the app day to day. The first real lot (103 vacuums, landed $52.30/unit) has arrived and there is nowhere to check it in.

## What Changes

- **New information architecture (BREAKING for the UI, not the data):** six destinations — Today, Lots, Receive, Inventory, Money, Settings — replacing the current nine. The lot detail page (mapping → context → comps → analysis → outcome) is kept as-is underneath Lots.
- **Today:** a daily home screen — time card, the lot that needs check-in, this month's money, aging inventory, upcoming events, recent sales.
- **Lots absorbs Compare:** a stage board (Analyzing → Bid placed → Won → Received → Selling → Closed) with column totals and a "rotting" tint for won lots not checked in; a Table toggle is the old Compare view.
- **Receive (new):** per-manifest-line check-in tallies (received / works / incomplete / weak battery / dead) that push working units into Inventory with cost basis = landed unit cost, plus a salvage plan that pools dead and weak units by compatible family, suggests cannibalisation, and lists parts with the owner's own value ranges.
- **Inventory rebuilt around channels:** an item can be listed on several selling channels (eBay, Facebook Marketplace, OfferUp, Mercari, AptDeco, Craigslist…), each with its own ask and fee rule; the row shows net-after-fees per channel; status is derived from listings and sales instead of a dropdown; days-on-shelf and a per-item-day carrying cost drive aging alerts. Replaces the Listings tab; per-channel listing drafts (template or Claude) live in the item drawer.
- **Money absorbs History, Storage, Taxes:** scorecards with delta vs. previous period; one chart area with a switcher (Revenue vs goal, Net profit, Funnel, Cycle time, Hours, Storage); a punch-clock time card (clock in/out, task category, lot); storage units as auto-posting recurring expenses with a burn rate; predicted-vs-actual and calibration; tax set-aside.
- **Settings replaces Profile:** buyer rules, fees & recovery rates, selling channels, salvage parts book, integrations (Google Calendar subscribe URL, Claude drafts, password), data & backup.
- **Calendar tab removed:** events stay attached to inventory items, surface in Today, and reach Google Calendar through the existing ICS feed and "add to Google Calendar" links.
- **Installable as a PWA** (web manifest + service worker for the app shell) so the phone is a first-class surface for clock in/out, check-in, and mark-sold.
- **Frontend rewritten** as a component app (see design.md); server, calc, valuation, ingest, and store modules keep their tests and are extended, not replaced.
- **Deployment from GitHub:** Vercel builds on push; the bundled `api/app.mjs` leaves the repo.

## Capabilities

### New Capabilities
- `lot-receiving`: check-in of a won lot against its manifest — per-line unit tallies by condition, progress, transfer of working units into inventory with landed cost basis, and lot stage transitions (Won → Received → Selling → Closed).
- `salvage-planning`: grouping of dead/weak units by compatible product family, cannibalisation suggestions, a user-maintained parts book (family → parts → value range), salvage floor, and creation of parts inventory items.
- `selling-channels`: configurable marketplaces with fee rules and draft styles; per-item listings (channel, ask, url, status, listed_at); net-after-fees computation; derived inventory status; per-channel listing drafts.
- `inventory-aging`: days on shelf, per-item-day carrying cost derived from recurring storage expenses, aging thresholds and price-cut suggestions.
- `time-card`: punch-clock entries (clock in/out timestamps, task category, optional lot), weekly view, hours by category, profit per hour, labor cost per lot.
- `recurring-expenses`: storage units and other recurring costs that post to the ledger automatically on their due day.
- `money-reports`: scorecards with period comparison and a single switchable chart area (revenue vs goal, net profit, stage funnel, cycle time, hours, storage) with period / group-by / table controls.
- `today-dashboard`: the daily home screen composed from the capabilities above.
- `pwa-shell`: installable app manifest, service-worker cached shell, mobile layout for Today / Receive / Inventory quick-sell.

### Modified Capabilities
- `lot-history`: lot gains a lifecycle stage; scoreboard adds labor cost and cycle time; Compare view becomes the Lots table.
- `user-profile`: becomes Settings — adds monthly revenue goal, aging thresholds, selling channels, parts book, integrations.

## Impact

- **UI:** `src/ui/public/` (`index.html`, `app.js`, `style.css`) replaced by a component app; `src/ui/api.ts` gains routes for receiving, listings, channels, parts book, punches, recurring expenses, reports; `src/ui/server.ts` serves the built app and PWA assets.
- **Store:** new tables — `receipts` (per line tallies), `parts_book`, `parts_items` (or inventory rows flagged `kind = 'parts'`), `channels`, `listings`, `punches`, `recurring_expenses`; `lots` gains `stage`; `inventory` gains `kind`, `family`, `received_at`; `work_hours` and `timer` migrate into `punches`; `listing_library` is dropped (0 rows in production).
- **Calc:** new pure modules for net-after-fees, carrying cost, salvage floor, funnel/cycle aggregation — all unit-tested like `src/calc/`.
- **Removed:** Listings, Storage, Calendar (tab only — events and ICS feed remain), Taxes as a tab (folds into Money), Profile (renamed Settings).
- **Build/deploy:** a build step for the frontend; Vercel Git integration with `npm run build` producing both the SPA and the serverless bundle; `api/app.mjs` gitignored.
- **Data:** Turso (production) is the source of truth; migrations are additive `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` per the existing `db.ts` pattern.
- **Compliance boundary unchanged:** still no connection to bstock.com; marketplace channels are described by fee rules only — no marketplace APIs are called in this change.
