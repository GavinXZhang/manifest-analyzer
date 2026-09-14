# Manifest Analyzer

## Why

Buying liquidation lots on B-Stock profitably requires answering three questions per listing, fast: *What is this lot actually worth to me? What is the most I can bid? Why is (or isn't) this a good deal?* Today this is done by hand in spreadsheets, per lot, and most bad buys happen because the math was skipped or the extended-retail number on the listing was trusted at face value.

Automated scraping of B-Stock is prohibited by its Terms of Use and puts the buyer account at risk. However, manifest downloads are explicitly sanctioned by B-Stock's own download functionality. This change builds a local-first analyzer that ingests user-downloaded manifests plus a small amount of manually entered listing context, and outputs a valuation, a walk-away max bid, a target unit price, and a plain-language deal rationale.

## What Changes

- **NEW capability: `manifest-ingestion`** — parse user-supplied manifest files (.xlsx, .csv) from any B-Stock storefront into a normalized line-item schema, plus capture manual listing context (current bid, end time, freight, buyer's premium).
- **NEW capability: `comps-valuation`** — estimate realistic resale value per line item using UPC/ASIN/model lookups and condition-based recovery rates, with grail-risk detection.
- **NEW capability: `bid-calculator`** — compute total budget, max bid, and landed unit price by working backwards from expected revenue; present max bid as a single walk-away number.
- **NEW capability: `deal-reasoning`** — generate a human-readable explanation of deal quality (composition, seasonality, location/freight, competition, confidence).
- **NEW capability: `user-profile`** — persist the buyer's constraints: location/zip, categories of interest, acceptable conditions, preferred sellers, finance tolerance (max spend per lot, required profit margin).
- **NEW capability: `lot-history`** — log analyzed lots and (optionally) actual outcomes, so recovery-rate assumptions self-calibrate over time and market closing ranges can be predicted.

**Explicit non-goals (out of scope):**

- No automated crawling, scraping, or headless-browser access to bstock.com or any B-Stock-powered marketplace.
- No credential storage or login automation for B-Stock accounts.
- No automated bid placement. The tool outputs a number; the human places the bid.
- No screen-reading browser extension (deferred; see design.md).

## Capabilities

### New Capabilities

- `manifest-ingestion`: Parse heterogeneous .xlsx/.csv manifests into a canonical line-item schema with column auto-mapping, per-seller mapping memory, unverifiable-row flagging, and a manual listing-context entry form.
- `comps-valuation`: Per-item resale estimates from comps (median sold price preferred), condition recovery rates (configurable, self-calibrating from history), conservative floor valuation for no-comp items, and grail-risk detection with dual valuation.
- `bid-calculator`: Pure deterministic bid math working backwards from expected revenue to total budget, auction budget, max bid, and landed unit price; PASS verdict when current bid exceeds max bid; walk-away framing in the UI.
- `deal-reasoning`: Template-driven plain-language rationale covering value composition, freight impact, seasonality, competition signals, and valuation confidence.
- `user-profile`: Buyer constraint storage (zip, max spend, required profit, acceptable conditions, categories, preferred sellers, fee defaults) applied automatically to every analysis, with hard-constraint PASS enforcement.
- `lot-history`: Outcome logging (won/lost, final price, actual gross recovered), recovery-rate recalibration per seller/category, and market closing-range prediction from recorded finals.

### Modified Capabilities

None — this is a new project with no existing specs.

## Impact

- **Affected specs:** none existing (all new capabilities).
- **Affected code:** new project. Suggested layout:
  - `src/ingest/` — manifest parsers and column-mapping
  - `src/valuation/` — comps clients, recovery-rate model
  - `src/calc/` — bid math (pure functions, fully unit-tested)
  - `src/reasoning/` — deal-rationale generator
  - `src/store/` — profile + lot history persistence (local SQLite or JSON)
  - `src/ui/` — web UI (single-page app)
- **External dependencies:** at least one pricing-comps source. v1 uses manual comp entry for top-N value items; eBay Marketplace Insights API access is the recommended fast-follow (see design.md Open Questions).
- **Compliance boundary:** all B-Stock data enters via user-downloaded manifests and a manual context form. This is an invariant of the project, not a preference.
