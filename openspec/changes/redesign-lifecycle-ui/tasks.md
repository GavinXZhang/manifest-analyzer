## 1. Deploy wiring and frontend scaffold

- [x] 1.1 Link the Vercel project to the GitHub repo; set build command `npm run build`; remove `api/app.mjs` from git and add it to `.gitignore`; confirm a push deploys
- [x] 1.2 Scaffold `web/` with Vite + React + TypeScript; `npm run build` produces `web/dist/` and the esbuild API bundle; `src/ui/server.ts` and the Vercel entry serve `web/dist/` with the old SPA still reachable at `/legacy`
- [x] 1.3 Add `vite-plugin-pwa` with manifest, icons, shell precache, `/api/*` network-only, and the "new version — reload" prompt
- [x] 1.4 App shell: rail navigation (Today, Lots, Receive, Inventory, Money, Settings), bottom tab bar at phone widths, design tokens from design.md §12, IBM Plex Sans, base components (button, pill, chip, card, table, segmented control, drawer)
- [x] 1.5 Typed API client in `web/src/api/` covering existing routes; password gate screen

## 2. Schema migration and lifecycle

- [x] 2.1 Additive migrations in `src/store/db.ts`: `lots.stage`, `lot_stage_events`, `receipts`, `parts_book`, `channels`, `listings`, `punches`, `recurring_expenses`; new columns on `inventory` (`kind`, `family`, `line_item_id`, `received_at`, `qty_sold`) and `sales` (`inventory_id`, `channel_id`, `fees`)
- [x] 2.2 Back-fill `lots.stage` and one inferred stage event per existing lot; migrate `storage_units → recurring_expenses`, `work_hours`/`timer → punches`; seed `channels` and `parts_book`; run against a copy of the production database and check row counts
- [x] 2.3 `src/store/stages.ts`: set stage + append event; hook outcome save (won → won, lost → closed); unit tests
- [x] 2.4 `postDueRecurring(today)` in `src/store/recurring.ts`, idempotent per period with back-fill; unit tests for due day, double run, missed month

## 3. Lots board (replaces Lots + Compare)

- [x] 3.1 `GET /api/lots/board` returning lots grouped by stage with per-column totals and days-in-stage
- [x] 3.2 Board view with stage columns, cards (verdict / max bid / landed unit cost / seller / units), overdue check-in tint, "Check in →" on won lots
- [x] 3.3 Table view with the Compare columns sorted by landed unit price; Board/Table toggle; seller filter and sort
- [x] 3.4 Port the lot detail page (mapping, context, comps, analysis, outcome) to React components without behavior changes; remove Lots and Compare from the legacy nav

## 4. Receive and salvage

- [x] 4.1 `src/store/receipts.ts` + routes `GET/PUT /api/lots/:id/receipts` with the tally validation (parts ≤ received); progress summary in the lot response
- [x] 4.2 `src/valuation/families.ts`: parts-book matching of manifest lines; `src/calc/salvage.ts`: per-family pools, cannibalisation count, floors, lot floor; unit tests against the vacuum manifest fixture
- [x] 4.3 Transfer routine "send working units to inventory" (idempotent per manifest line, cost = landed unit cost, kind `unit`, family) and "create parts items" (kind `parts`, cost 0); routes and tests
- [x] 4.4 `GET /api/lots/:id/salvage-plan`; "Finish check-in" → stage `received`
- [x] 4.5 Receive screen: KPI strip, manifest-line table with count steppers and notes, unchecked filter, salvage plan panel, transfer buttons; phone layout one line at a time with ≥44px controls
- [x] 4.6 Parts book store + `GET/PUT /api/parts-book`; seed from the exploration salvage table with the "estimate" label

## 5. Inventory, channels, listings

- [x] 5.1 `src/store/channels.ts` and `src/store/listings.ts` with routes: `GET/PUT /api/channels`, `POST/PUT/DELETE /api/inventory/:id/listings`
- [x] 5.2 `src/calc/fees.ts`: net after fees (percent + fixed, local/shipped rule), best net; derived inventory status written on every change; unit tests
- [x] 5.3 Sales gain `inventory_id`, `channel_id`, `fees`; "mark sold" endpoint decrements `qty_sold`, marks the listing sold, records fees; first listing on a lot's item → stage `selling`; all sold → close suggestion
- [x] 5.4 `src/calc/aging.ts`: days on shelf, carrying cost per item-day, accrued cost, threshold flags; "cut price" endpoint updating active asks; unit tests
- [x] 5.5 Listing drafts: templates per draft style; wire the existing Claude drafting endpoint when a key is configured
- [x] 5.6 Inventory screen: filters (On hand / Listed / Sold / Parts, channel, lot, search), KPIs, table with condition, cost, days, channel chips, best net, derived status, aging tints; row drawer with per-channel nets, add/end listing, draft, pricing (floor/target/ceiling), comps, mark sold, cut price; remove Inventory and Listings from the legacy nav

## 6. Time card

- [x] 6.1 `src/store/punches.ts`: clock in (refuse if one running), clock out, switch task, manual add/edit/delete; routes under `/api/punches`; unit tests
- [x] 6.2 Aggregations: hours per day/week, by category, profit per hour for a period, labor cost per lot; tests
- [x] 6.3 Time card UI: running state with elapsed time, clock in/out/switch, week grid with previous-week stepping, hours-by-category table, punch log with edit; phone variant

## 7. Money

- [x] 7.1 `GET /api/reports/:kind` for revenue-goal, net, funnel, cycle, hours, storage with period (30d/90d/ytd/all), by, lot; previous-period comparison for scorecards; fixture-based tests
- [x] 7.2 Chart components on one shared frame/axis/tooltip: column with ghost target, stacked column, funnel with stage-to-stage %, horizontal bar (cycle), day columns (hours); table view for each
- [x] 7.3 Money screen: period + lot controls, scorecards with delta, chart switcher, time card (from 6.3), storage & recurring card (add/edit, next due, burn), predicted-vs-actual with labor and cycle, calibration link, tax set-aside; remove History, Storage and Taxes from the legacy nav

## 8. Today

- [x] 8.1 `GET /api/today` composing punch state, check-in lots, month-to-date scorecards, aging items, upcoming events, recent sales; runs recurring posting first
- [x] 8.2 Today screen (desktop and phone): time card, needs check-in, month money, aging list with cut-price, coming up with Google Calendar subscribe + add links, sold this week, quick sell; app opens on Today; remove Calendar from the legacy nav

## 9. Settings

- [x] 9.1 Settings screen with sections: Buyer rules (existing fields + revenue goal, aging days, cut %, check-in overdue days, hourly value), Fees & recovery rates (existing), Selling channels (table with fee rules, categories, draft style, enable), Salvage parts book (families, match rules, parts, ranges), Integrations (ICS URL copy, Claude status, password), Data & backup (CSV exports)
- [x] 9.2 CSV export endpoints for lots, inventory, listings, sales, expenses, punches
- [x] 9.3 Remove Profile from the legacy nav

## 10. Cleanup and hardening

- [x] 10.1 Delete `src/ui/public/`, the `/legacy` route, and the `storage_units`, `work_hours`, `timer`, `listing_library` tables and their stores/routes; update tests
- [x] 10.2 README: new architecture, `web/` build, PWA install steps, GitHub → Vercel deploy, `vercel env pull` for local-against-Turso; update `lot-analysis-view.png`
- [x] 10.3 Full run: `npm test`, `npm run typecheck`, `npm run build`; walk the first real lot end to end on the deployed app (check-in → inventory → listing → sale) and on a phone
