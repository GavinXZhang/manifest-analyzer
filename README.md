# Manifest Analyzer

**Manifest in, walk-away max bid out.**

A local-first analyzer for B-Stock liquidation lots. Feed it a manifest you
downloaded from a listing plus a few manually entered listing details; it gives
you a valuation, a **walk-away max bid**, a landed unit price, and a
plain-language explanation of why the lot is (or isn't) a deal.

![Node ≥ 22.5](https://img.shields.io/badge/node-%E2%89%A5%2022.5-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-native-3178C6?logo=typescript&logoColor=white)
![SQLite / libSQL](https://img.shields.io/badge/storage-SQLite%20%2F%20libSQL-003B57?logo=sqlite&logoColor=white)
![Tests](https://img.shields.io/badge/tests-103%20passing-brightgreen)

![Lot analysis view](lot-analysis-view.png)

---

## Why

Buying liquidation lots profitably means answering three questions per listing,
fast:

1. **What is this lot actually worth to me?**
2. **What is the most I can bid?**
3. **Why is (or isn't) this a good deal?**

That usually happens by hand in spreadsheets, and most bad buys come from
skipping the math or trusting the listing's "extended retail" number. This tool
does the math the same way every time and shows its work.

## Features

- **Manifest ingestion:** `.xlsx` / `.csv` from any storefront. Header
  detection and column auto-mapping, with a confirmation screen for low-confidence
  mappings that is remembered per seller.
- **Comps valuation:** paste recent *sold* prices for top-value items. Items
  without comps fall back to a conservative MSRP floor based on condition
  recovery rates.
- **Bid calculator:** pure, deterministic math working backwards from expected
  revenue → selling costs → required profit → freight → buyer's premium → max bid.
- **Grail-risk detection:** when >40% of the value sits in ≤3 items, the bid is
  computed from the grails-excluded valuation.
- **Deal rationale:** plain-language breakdown covering value composition,
  freight impact, seasonality, competition, and valuation confidence.
- **Buyer profile:** zip, max spend, required profit, acceptable conditions,
  and fee defaults, applied to every analysis automatically.
- **Lot history & calibration:** log outcomes (won/lost, final price, gross
  recovered) to self-calibrate recovery rates and predict market closing ranges.
- **Optional password gate and hosted deploy:** Vercel + Turso.

## The compliance boundary

This tool **never** connects to bstock.com or any B-Stock-powered marketplace.
All listing data enters two ways only:

1. **Manifest files you downloaded yourself** via B-Stock's own download button.
2. **A short manual form** (current bid, end time, freight, premium: about 6 fields).

No scraping, no credential storage, no automated bidding. The tool outputs a
number; you place the bid.

## Quick start

Requires Node ≥ 22.5 (runs TypeScript natively, no build step).

```sh
git clone https://github.com/GavinXZhang/manifest-analyzer.git
cd manifest-analyzer
npm install
npm start          # http://127.0.0.1:4317 (loopback only)
```

Try it with the sample manifests in [`fixtures/`](fixtures/) (three realistic
seller layouts).

```sh
npm test           # full test suite (node:test)
npm run typecheck
npm run dev        # restart on file changes
```

### Configuration

Data lives in `data/analyzer.db` (a SQLite file, via libSQL). Environment variables:

| Variable | Purpose |
| --- | --- |
| `MA_PORT` / `MA_HOST` | Port (default `4317`) and bind address (default loopback) |
| `MA_PASSWORD` | Gate everything behind a password login |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Use a hosted Turso database instead of the local file |
| `MA_DB_URL` / `MA_DB_AUTH_TOKEN` / `MA_DB_PATH` | Point at another libSQL URL or file path |

## Workflow

1. **Profile:** set your zip, max spend per lot, required profit (absolute $ or
   % of revenue), acceptable condition grades, and fee defaults.
2. **New lot:** upload the manifest. Standard layouts map automatically;
   anything uncertain gets a mapping screen with best guesses pre-filled.
3. **Context:** enter current bid, bid count, end time, buyer's premium, and
   freight (a real quote, or seller zip + pallet count for a rough estimate).
4. **Comps:** for the top-value items, paste recent *sold* prices (eBay sold
   listings, etc.). ≥3 comps means high confidence.
5. **Analysis:** verdict (`BID ≤ $X`, or `PASS` naming the violated constraint
   or gap), the full budget math, a confidence bar, and the rationale.
6. **Outcome:** after the auction, log won/lost, the final price, and later the
   actual gross recovered. History drives recovery-rate calibration (≥3
   outcomes per seller/category) and closing-range predictions (≥5 finals per
   segment).

## The two numbers that are never the same thing

- **Your walk-away number:** a budget fact computed backwards from expected
  revenue, fees, your required profit, freight, and premium. Place one proxy bid
  at it and stop. B-Stock's proxy bidding and popcorn extensions make sniping
  pointless.
- **The market estimate:** a prediction of where similar lots close, from your
  own logged history. It is shown separately with its own label and never moves
  your walk-away.

## Conservative by default

- Numbers derived from any estimate render as `~$X *` with the reason listed,
  so an estimated freight or an MSRP-floor valuation can never pass for a hard number.
- Grail-heavy lots are bid on the grails-excluded valuation.
- Any condition grade outside your acceptable set marks the lot PASS with the
  constraint named (widen the set in Profile if you disagree).

## Deploy (Vercel + Turso)

`api/app.mjs` is an esbuild bundle of the whole Express app (static SPA
included, so the password gate covers everything), and `vercel.json` routes
every request to it.

1. Create the database and seed it with your local data:
   ```sh
   turso db create manifest-analyzer --from-file data/analyzer.db
   turso db show manifest-analyzer --url        # → TURSO_DATABASE_URL
   turso db tokens create manifest-analyzer    # → TURSO_AUTH_TOKEN
   ```
2. On the Vercel project, set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and
   `MA_PASSWORD` (never deploy without a password).
3. `npm run deploy` (bundles to `api/app.mjs`, then `vercel deploy --prod`).

## Project layout

```
src/ingest/      manifest parsing, header detection, column mapping, freight table
src/valuation/   comps interface (manual v1), recovery rates, grail detection, calibration
src/calc/        pure bid math + constraint verdicts (fully unit-tested)
src/reasoning/   template-driven deal rationale
src/store/       SQLite persistence (profile, lots, comps, outcomes, mappings)
src/ui/          Express API + no-build vanilla SPA
api/             bundled Vercel serverless entry
fixtures/        realistic manifests from three seller layouts (see fixtures/README.md)
openspec/        spec-driven design docs
```

Spec-driven via [OpenSpec](openspec/). See
[`openspec/changes/add-manifest-analyzer/`](openspec/changes/add-manifest-analyzer/)
for the proposal, design, and per-capability specs.

## Disclaimer

Not affiliated with or endorsed by B-Stock Solutions. Valuations are estimates;
you are responsible for your own bids.
