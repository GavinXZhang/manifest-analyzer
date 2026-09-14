# Design: Redesign around the lot lifecycle

## Context

The backend is in good shape: pure, tested calc/valuation/ingest modules, an Express API, and a libSQL store that runs locally (file) and in production (Turso via Vercel). The frontend is one 1,841-line `app.js` of `innerHTML` templates that fully re-renders on every action, with a nine-tab sidebar that grew by accretion. Production data lives in Turso; the local file DB is a dev sandbox.

Reference points that shaped this design: the existing lot detail flow (kept), the design canvas *Manifest Analyzer Redesign* (seven artboards agreed with the owner), and a survey of Pipedrive's Insights/Pipeline patterns (stage board with column totals, "rotting" tint, scorecards with period delta, report builder = filters → chart switcher → chart → table, goal ghost-bar). Patterns are borrowed; brand, fonts and colors are not.

Constraints carried forward unchanged: no connection to bstock.com; no marketplace APIs; one user; Vercel serverless (no long-running process, no cron); Node ≥ 22.5 with native TypeScript on the server.

## Goals / Non-Goals

**Goals:**

- One thread through the app: analyze → bid → won → receive → sell → close, with each screen owning one stage.
- Make the app worth opening daily: Today + time card + aging alerts + phone-installable.
- Keep every existing test green; extend the store additively so the current production bundle keeps working against the migrated schema.
- Frontend as real components so the phone layout, PWA, and later Capacitor are cheap.

**Non-Goals:**

- Per-unit serial tracking (tallies per manifest line are enough for v1).
- Marketplace API integrations (eBay/FB posting, order import). Channels are fee rules and links only.
- Two-way Google Calendar sync (one-way ICS + links stays).
- Native app store distribution (PWA now; Capacitor is a follow-up with no design impact).
- Multi-user / roles.

## Decisions

### 1. Frontend: Vite + React + TypeScript, backend untouched in shape

*Alternatives:* (a) restyle the vanilla `app.js`; (b) Preact + htm with no build step; (c) Vite + React.
**Chosen: (c).** The IA change is structural — routes, a shared layout, a board, a drawer, a chart switcher, a mobile layout — and needs components with local state, not template strings. Vite gives the PWA plugin, code splitting, and a path to Capacitor. (b) was tempting for zero build, but the repo already has an esbuild step for Vercel, so "no build" is no longer a property worth protecting. The API stays Express; `src/calc`, `src/valuation`, `src/ingest`, `src/store` are extended, never rewritten.

Layout: `web/` (Vite app: `web/src/{app,routes,components,charts,api}`), built to `web/dist/`. `src/ui/server.ts` and the Vercel entry serve `web/dist/` instead of `src/ui/public/`. The old SPA is deleted once the new one reaches feature parity (see Migration).

### 2. Lot lifecycle is a stored stage plus an event log

`lots.stage ∈ {analyzing, bid_placed, won, received, selling, closed}` plus `lot_stage_events (lot_id, stage, at)`. Transitions are suggested by the system and confirmed by the user where judgment is involved:

- outcome saved as won → `won` (automatic); lost → `closed` (automatic)
- check-in reaches 100% of manifest units (or the user presses "Finish check-in") → `received`
- first listing created for an inventory item from the lot → `selling` (automatic)
- every unit sold or disposed → suggest `closed`

The event log is what makes cycle-time and funnel reports possible; without it those charts cannot exist. Lots created before this change get a single back-filled event from `created_at` and the stage inferred from outcome/inventory.

### 3. Receiving = tallies per manifest line, not rows per unit

`receipts (lot_id, line_item_id, received, works, incomplete, weak_battery, dead, note, updated_at)`, one row per manifest line. Counts are enough to compute inventory quantities, salvage pools and the check-in progress, and the entry surface on a phone is five number steppers per line. Per-unit rows would double the data entry for no v1 benefit. "Send working units to Inventory" creates (or tops up) one inventory row per manifest line with `qty = works`, `cost = lot landed unit cost`, `kind = 'unit'`, `family` from the parts book match, and `line_item_id` for traceability; it is idempotent (re-running adjusts qty to the current tally rather than duplicating).

### 4. Salvage is family-based and user-owned

`parts_book (id, family, match_json, parts_json)`: `match_json` is a list of `{brand, keywords[]}` matched against manifest description/brand/vendor; `parts_json` is `[{name, low, high}]`. The salvage plan groups `dead + weak_battery` tallies by family across a lot and emits (a) a cannibalisation suggestion when a family has both dead and weak units (`min(dead, weak)` recoverable), (b) the parts list, (c) a salvage floor = Σ dead × family floor. The book ships seeded with the families in the first real lot (Dyson V7/V8/V10/V11/Outsize, Dyson uprights, Tineco Floor One, LG CordZero, Ecovacs, Samsung Jet, Shark, Bissell/Hoover) with wide ranges; every number is editable in Settings and the UI labels them as the owner's own estimates. "Create parts items" writes inventory rows with `kind = 'parts'`, `cost = 0`, one per part name per dead unit group.

### 5. Channels and listings replace inventory status

`channels (id, name, fee_percent, fee_fixed, fee_rule_json, categories_json, draft_style, enabled)` and `listings (id, inventory_id, channel_id, ask, url, status ∈ {draft, active, ended, sold}, listed_at, ended_at)`. Net after fees = `ask − (ask × fee_percent + fee_fixed)`, with `fee_rule_json` allowing a local/shipped split (Facebook, OfferUp). Inventory status is **derived**: `sold` when `qty_sold ≥ qty`, else `listed` when any listing is active, else `unlisted`. `inventory.status` is kept as a column but written by the server from the derivation so the old bundle keeps reading it. A sale records `inventory_id`, `channel_id`, `fees` (computed from the channel at sale time) so net revenue is exact. Listing drafts: a template per `draft_style` (`ebay`, `casual`, `furniture`, `short`), with the existing `POST /listings/:itemId/ai` endpoint wired in when an Anthropic key is configured.

*Alternative:* keep the status dropdown and add a free-text "where listed" field. Rejected — net-after-fees, per-channel drafts and the funnel all need listings as records.

### 6. Time card = punches; timer and work_hours fold in

`punches (id, started_at, ended_at NULL while running, category ∈ {receiving, testing, listing, photos, shipping, driving, admin, other}, lot_id, note, source ∈ {clock, manual})`. A running punch is a row with `ended_at IS NULL` — the same "survives page close" property the singleton `timer` row had, without the singleton. Existing `work_hours` rows migrate to `source = 'manual'` punches spanning `date 09:00 → 09:00 + hours`; the `timer` row, if running, becomes an open punch. Profit per hour = net profit ÷ hours in the same period; labor cost per lot = hours on that lot × the owner's configured hourly value (Settings, default = trailing profit/hour).

### 7. Recurring expenses post on request, not on a schedule

Vercel functions have no scheduler in this project, so `recurring_expenses (id, name, amount, category, due_day, active, last_period)` are posted by an idempotent routine `postDueRecurring(today)` that runs at the start of any `/api/ledger`, `/api/reports/*`, `/api/today` request: for each active row whose `due_day ≤ today.day` and `last_period < currentPeriod`, insert an `expenses` row tagged `auto = 1, recurring_id` and advance `last_period`. Existing `storage_units` rows migrate 1:1 (`category = 'storage'`). Carrying cost per item-day = (Σ active storage-category recurring ÷ days in month) ÷ units on hand; the item's accrued carrying cost is computed at read time from `received_at`/`acquired_at`, never stored.

### 8. Reports are server aggregates; charts are hand-rolled SVG components

`GET /api/reports/:kind?period=90d|30d|ytd|all&by=month|week&lot=` returns `{series, meta}` for `kind ∈ {revenue-goal, net, funnel, cycle, hours, storage}`. Aggregation stays on the server (it already owns ledger/history queries and can be unit-tested with fixtures); the client has five small chart components (column with ghost target, stacked column, funnel with stage-to-stage %, horizontal bar for cycle time, day columns for hours) built on one shared frame/axis/tooltip. *Alternative:* Recharts. Rejected for now — six known chart shapes, one user, and full control over the hover/tooltip spec beats a 100 KB dependency; revisit if the chart list grows.

Chart color: one accent hue for a single series; the goal ghost is neutral; status colors are never used for series. Any categorical palette introduced later runs through the dataviz validator before shipping.

### 9. Today is a server-composed view

`GET /api/today` returns everything the home screen needs in one call: open punch + week hours + profit/hour, the lot(s) in `won` with check-in progress and days since won, month-to-date scorecards, aging items above threshold, upcoming events, recent sales. One endpoint keeps the phone view fast on a cold serverless start.

### 10. PWA: app shell only

`vite-plugin-pwa` with a manifest (name, icons, standalone display, theme color) and a service worker that precaches the built shell and **never** caches `/api/*` (network-only). The password gate is a cookie, unaffected. Offline shows the shell with a "reconnect" state; no offline writes in v1.

### 11. Deploy from GitHub

Vercel project linked to the repo: build command `npm run build` (= `vite build` + `esbuild` API bundle), output served by the catch-all function with `includeFiles: web/dist/**`. `api/app.mjs` is removed from git and `.gitignore`d. Preview deployments get the same Turso database unless `TURSO_DATABASE_URL` is overridden per environment — acceptable for one user, documented in README.

### 12. Visual system

Tokens from the agreed canvas: plane `#f5f6f8`, surface `#fff`, border `#e3e6ea`, ink `#172033` / `#5f6b7a` / `#8b95a5`, accent `#1b6a99` (+ tint `#e6f1f8`), status green/amber/red with tints, radius 6px, 1px borders, no card shadows, IBM Plex Sans with tabular numerals, dark navy rail `#14213a`. Buttons: one solid primary per screen, outlined secondary; no tinted "small" pills for row actions — row actions live in a drawer.

## Risks / Trade-offs

- **[Rewrite scope]** A full frontend rewrite can stall before parity → ship in vertical slices behind the new shell (Today+Lots board, then Receive, then Inventory, then Money, then Settings), each replacing the old view it covers; the old SPA remains reachable at `/legacy` until the last slice lands.
- **[Tallies not units]** Counting per line loses which physical unit is which → notes per line and photos (deferred) cover the v1 need; per-unit rows can be added later without changing the receipts table.
- **[Fee rules go stale]** Marketplace fees change → they are plain editable settings, shown next to every net figure, and the sale stores the fee actually applied.
- **[Parts values are guesses]** Seeded ranges are the owner's estimates, not comps → labeled as such everywhere; the parts book is the single place to correct them.
- **[Serverless recurring posting]** If the app is not opened for a month, expenses post late (but not twice) → `last_period` makes posting idempotent and back-fills the missed period on next open.
- **[Stage back-fill for old lots]** Inferred stages/dates for the two existing lots will be approximate → clearly a one-time migration; cycle-time charts exclude lots with `back_filled = 1`.
- **[PWA cache staleness]** A stale shell after deploy → versioned service worker with `skipWaiting` + a "new version, reload" toast.
- **[Local vs production data]** Developing against the file DB while real data is in Turso → README documents `vercel env pull` to run locally against Turso, and the migration is exercised on a copy first.

## Migration Plan

1. **Schema** (additive, in `db.ts`): new tables; `ALTER TABLE lots ADD stage`, `ALTER TABLE inventory ADD kind/family/line_item_id/received_at/qty_sold`, `ALTER TABLE sales ADD inventory_id/channel_id/fees`; back-fill `lots.stage` + one `lot_stage_events` row per lot; migrate `storage_units → recurring_expenses`, `work_hours`/`timer → punches`; seed `channels` and `parts_book`. Old tables are left in place until the old SPA is removed.
2. **API**: new routes added; existing routes unchanged so the current bundle still works during the transition.
3. **Frontend slices**, each a deploy: shell + Today + Lots board → Receive + salvage → Inventory + channels → Money + time card → Settings + PWA. Each slice removes the corresponding old view from the legacy bundle's nav.
4. **Deploy wiring**: link Vercel to GitHub, set build command, `.gitignore` the bundle. Do this at slice 1 so every later slice auto-deploys.
5. **Cleanup**: delete `src/ui/public/`, `storage_units`, `work_hours`, `timer`, `listing_library`; archive this change.

Rollback: every step is additive until cleanup; reverting the frontend commit restores the old SPA against the same database.

## Open Questions

1. Seed the parts book from the salvage table drafted during exploration (wide ranges), or ship it empty and let the owner fill it from real parts sales? Default: seed with ranges and a visible "estimate" label.
2. Hourly value for labor cost per lot: fixed setting vs trailing profit/hour. Default: setting, pre-filled from trailing profit/hour.
3. Should "Cut price 10%" write to the listings (change asks) or just suggest? Default: change the ask on every active listing and remind the owner to update the marketplaces (no API).
4. Capacitor packaging after PWA — wanted for App Store presence or not needed?
