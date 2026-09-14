# Design: Manifest Analyzer

## Context

B-Stock is a network of liquidation marketplaces where lots are sold by auction with downloadable manifests (.xlsx/.csv). Buyers today evaluate lots by hand in spreadsheets; the extended-retail number shown on listings is a poor proxy for realizable value, and skipped or rushed math is the leading cause of bad buys.

This is a greenfield local-first application. There is no existing codebase or spec set. The hard external constraint is B-Stock's Terms of Use: automated scraping, crawling, or content extraction from bstock.com is prohibited and risks the buyer's account. Manifest downloads via B-Stock's own download button are sanctioned; that download plus a short manual entry form is the only ingress for B-Stock data.

## Goals / Non-Goals

**Goals:**

- Turn a downloaded manifest + ~6 manually entered listing fields into: a valuation, a walk-away max bid, a landed unit price, and a plain-language deal rationale.
- Be conservative by default: unknown items get floor valuations, concentrated-value ("grail") items are excluded from the recommended bid, and estimated freight taints downstream numbers until a real quote is entered.
- Self-calibrate over time: logged outcomes refine recovery rates per seller/category and enable market closing-range predictions.
- Keep all data local and private.

**Non-Goals:**

- No automated crawling, scraping, or headless-browser access to bstock.com or any B-Stock-powered marketplace.
- No credential storage or login automation for B-Stock accounts.
- No automated bid placement — the tool outputs a number; the human places the bid.
- No screen-reading browser extension in this change (see Decisions).

## Decisions

### 1. Local-first, no B-Stock automation (compliance invariant)

All B-Stock data enters via user-downloaded manifest files and a manual listing-context form. This is the compliance boundary of the entire project and is treated as an invariant, not a preference. No code path may fetch from bstock.com or affiliated marketplaces.

*Alternative considered:* a page-reading browser extension would cut manual entry to near zero, but conflicts with B-Stock ToS content-extraction language. **Deferred**; revisit only with written consent from B-Stock.

### 2. Two different "max" numbers, never conflated

*Your* max bid (walk-away) is a budget fact derived from your economics. The *market's* likely ceiling is a prediction from logged auction history. The UI labels and separates them ("your walk-away number" vs "market estimate") and never blends them into one figure. The walk-away framing also deliberately omits any "bid a little more to win" affordance — B-Stock proxy bidding plus popcorn-bidding extensions make sniping ineffective, so the correct strategy is one proxy bid at max.

### 3. Conservative by default

- Line items with no comps default to `unit_msrp × conservative_floor_rate` (default 10%) and are tagged low confidence.
- When >40% of estimated value sits in ≤3 line items, those are flagged "grail risk" and the recommended max bid uses the grails-excluded valuation.
- A freight *estimate* (vs a real quote) marks every downstream number "estimate — get a real quote before bidding," and that flag propagates all the way to the verdict.

### 4. Bid math as pure functions

The entire calculator is pure and deterministic:

```
expected_revenue   = Σ item resale estimates
selling_costs      = expected_revenue × selling_fee_rate        (default 0.15)
total_budget       = expected_revenue − selling_costs − required_profit
auction_budget     = total_budget − freight
max_bid            = auction_budget / (1 + buyers_premium)      (default premium 0.10)
landed_unit_price  = total_budget / total_units
```

`required_profit` accepts an absolute dollar amount or a percentage of expected revenue. Pure functions make the math exhaustively unit-testable, including the canonical worked example (revenue $2,400, fees 15%, profit $800, freight $340, premium 10% → total_budget $1,240, auction_budget $900, max_bid $818 floored, landed unit price $6.20 at 200 units).

### 5. Comps source: manual entry for v1

eBay's official APIs gate sold-price data behind the Marketplace Insights program. Options: (a) apply for Marketplace Insights access, (b) a paid comps provider, (c) manual comp entry for top-N value items. **Chosen: (c) for v1** — the top ~10 items usually cover most of a lot's value, so manual entry is viable and keeps v1 dependency-free. (a) is the recommended fast-follow behind a comps-client interface so a real API slots in without touching valuation logic.

### 6. Freight estimation: static zone/weight table for v1

*Alternative considered:* live carrier APIs — more accurate but adds accounts, keys, and failure modes. **Chosen:** a static zone/weight table keyed by seller zip and lot size (pallet count/weight class), with a prominent "estimate — get a real quote" nudge. The estimate flag (Decision 3) covers the accuracy gap.

### 7. Platform: local web app

*Alternative considered:* hosted web app — easier sharing but introduces hosting cost, accounts, and puts the buyer's financial data on a server. **Chosen:** a locally run single-page web app with local persistence. Keeps data private, no hosting cost, and the browser gives us file upload + a decent form UI for free.

### 8. Storage: local SQLite

Profile, per-seller column mappings, analyzed lots, and outcomes go in a local SQLite database (`src/store/`). SQLite over JSON files because lot-history queries (per-segment aggregation for recalibration and closing-range prediction) are naturally relational.

### 9. Suggested code layout

- `src/ingest/` — manifest parsers and column-mapping
- `src/valuation/` — comps clients, recovery-rate model
- `src/calc/` — bid math (pure functions, fully unit-tested)
- `src/reasoning/` — deal-rationale generator (template-driven v1)
- `src/store/` — profile + lot history persistence (SQLite)
- `src/ui/` — web UI (single-page app)

## Risks / Trade-offs

- **[Manifest heterogeneity]** Column names vary widely across sellers → column-alias auto-mapping with a confidence threshold; below threshold, a mapping-confirmation UI pre-filled with best guesses; confirmed mappings are remembered per seller. Malformed-manifest fuzz tests in hardening.
- **[Bad valuations from thin comps]** Manual comps for only top-N items leaves a long tail valued by MSRP × recovery rate → conservative floor rates, explicit high/low-confidence tagging, and a displayed unverified-value percentage keep the user honest about what's guesswork.
- **[Estimate leakage]** An estimated freight or floor valuation silently reaching the verdict would defeat the conservatism guarantee → estimate flags propagate structurally; a hardening task audits that no unflagged estimated number reaches the verdict.
- **[Self-calibration on small samples]** Recalibrating recovery rates from ≥3 outcomes per segment is noisy → recalibrated rates are *suggested*, not silently applied; the user confirms edits. Closing-range prediction requires ≥5 finals per segment.
- **[Manual-entry friction]** ~6 fields per lot is real friction and the main churn risk → acceptable for v1; the sanctioned mitigation path (extension with B-Stock consent) is documented but deferred.
- **[Grail exclusion is conservative]** Basing max bid on the grails-excluded valuation can underbid genuinely good lots → both valuations are shown side by side; the user can knowingly bid against the full number.

## Migration Plan

Greenfield — no migration. Rollout order follows task groups: foundation → ingestion → valuation/calculator → reasoning/UI → history/calibration → hardening. The bid calculator is pure and testable before any UI exists.

## Open Questions

1. **Comps fast-follow:** apply for eBay Marketplace Insights access, or evaluate a paid comps provider? (v1 ships with manual entry either way; the comps-client interface isolates the decision.)
2. **Freight table sourcing:** which zone/weight matrix to seed the static estimator with, and how often to refresh it.
3. **Tech stack specifics** (framework, SQLite driver, packaging as a local app) — deliberately left to implementation; nothing in the specs depends on the choice.
