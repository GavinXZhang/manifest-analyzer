# manifest-ingestion

## ADDED Requirements

### Requirement: Parse heterogeneous manifest files
The system SHALL accept .xlsx and .csv manifest files and normalize them to the canonical line-item schema: `{description, identifier_type (UPC|ASIN|model|none), identifier, quantity, unit_msrp, condition, category}`.

#### Scenario: Standard B-Stock manifest
- **WHEN** the user uploads a downloaded manifest with columns Item Description, UPC, Qty, Unit Retail, Condition
- **THEN** every row is mapped to the canonical schema with zero manual configuration

#### Scenario: Non-standard column names
- **WHEN** a manifest's columns don't match known aliases (e.g., "Est. MSRP" vs "Unit Retail") and auto-mapping confidence is below threshold
- **THEN** the user is shown a column-mapping screen pre-filled with best guesses
- **AND** the confirmed mapping is remembered for that seller

#### Scenario: Unmanifested or partial lots
- **WHEN** a lot marked unmanifested, or a manifest missing identifiers on some rows, is ingested
- **THEN** rows without identifiers are flagged "unverifiable"
- **AND** the analysis proceeds with an explicit unverified-value percentage displayed

### Requirement: Manual listing-context entry
The system SHALL capture per-lot context not present in the manifest via a short form: current bid, auction end time, shipping type and freight quote (or seller zip for estimation), seller/marketplace, buyer's-premium rate (default 10%).

#### Scenario: Freight unknown
- **WHEN** the user has no freight quote and enters the seller zip and lot size (pallet count/weight class)
- **THEN** the system produces a rough freight estimate
- **AND** marks all downstream numbers as "estimate — get a real quote before bidding"
