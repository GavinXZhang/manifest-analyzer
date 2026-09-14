# Tasks: Manifest Analyzer

## 1. Foundation

- [x] 1.1 Project scaffold: repo layout per design (`src/ingest`, `src/valuation`, `src/calc`, `src/reasoning`, `src/store`, `src/ui`), build/test tooling
- [x] 1.2 Storage layer: local SQLite setup with tables for profile, per-seller column mappings, analyzed lots, outcomes
- [x] 1.3 User-profile CRUD: home zip, max spend per lot, required profit (absolute or %), acceptable conditions, categories, preferred sellers, default selling-fee rate
- [x] 1.4 Canonical line-item schema (`description, identifier_type, identifier, quantity, unit_msrp, condition, category`) + fixtures from 3+ real manifests (different sellers)

## 2. Ingestion

- [x] 2.1 .xlsx/.csv parser producing raw rows with header detection
- [x] 2.2 Column-alias auto-mapping with confidence scoring against the canonical schema
- [x] 2.3 Mapping-confirmation UI pre-filled with best guesses + per-seller mapping memory (persisted)
- [x] 2.4 Unverifiable-row flagging and unverified-value percentage computation for partial/unmanifested lots
- [x] 2.5 Listing-context form: current bid, auction end time, shipping type, freight quote or seller zip + lot size, seller/marketplace, buyer's-premium rate (default 10%)
- [x] 2.6 Static zone/weight freight estimator from seller zip + lot size, with "estimate" flag attached to its output

## 3. Valuation & Calculator

- [x] 3.1 Recovery-rate model with editable defaults per condition grade (New 0.55, Like New 0.45, Customer Returns 0.35, Salvage 0.10)
- [x] 3.2 Manual comps entry for top-N value items behind a comps-client interface; median-of-sold comp_price, high/low confidence tagging, conservative floor (MSRP × 10%) for no-comp items
- [x] 3.3 Bid calculator as pure functions (expected_revenue → total_budget → auction_budget → max_bid → landed_unit_price; required_profit as absolute or %) + exhaustive unit tests including the worked example ($2,400 / 15% / $800 / $340 / 10% → $818 max bid, $6.20 landed unit price)
- [x] 3.4 Grail-risk detection (>40% of value in ≤3 items) with dual valuation; recommended max bid uses grails-excluded valuation
- [x] 3.5 Hard-constraint enforcement: profile violations (e.g., max spend) mark lot PASS with the violated constraint named

## 4. Reasoning & UI

- [x] 4.1 Deal-rationale generator (template-driven v1) covering value composition, freight % of budget, seasonality, competition (bids + time remaining, incl. few-bids-near-close dual reading), and confidence split
- [x] 4.2 Lot analysis view: verdict (BID ≤ $X / PASS with reason), landed unit price, confidence bar, rationale, walk-away framing copy, no "bid more to win" affordance
- [x] 4.3 Comparison view: multiple analyzed lots side by side on landed unit price

## 5. History & Calibration

- [x] 5.1 Outcome logging: won/lost, final price, actual gross recovered; predicted-vs-actual scoreboard
- [x] 5.2 Recovery-rate recalibration per seller/category segment at ≥3 recorded outcomes (suggested, user-confirmed)
- [x] 5.3 Market closing-range prediction from ≥5 logged finals per segment, labeled "market estimate" vs "your walk-away number"

## 6. Hardening

- [x] 6.1 Malformed-manifest fuzz tests (bad encodings, merged cells, missing headers, junk rows)
- [x] 6.2 "Estimate" flag propagation audit: no unflagged estimated number reaches the verdict
