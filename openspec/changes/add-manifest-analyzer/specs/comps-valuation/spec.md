# comps-valuation

## ADDED Requirements

### Requirement: Per-item resale estimate
The system SHALL estimate resale value per line item as `comp_price × condition_recovery_rate × sell_through_probability`, preferring sold-price data over listing prices.

#### Scenario: Item with UPC and good comps
- **WHEN** valuation runs on a line item with a UPC that returns ≥3 recent sold comps
- **THEN** comp_price = median sold price
- **AND** the item is tagged "high confidence"

#### Scenario: No comps found
- **WHEN** valuation runs on a line item whose identifier returns no comps
- **THEN** the item's resale value defaults to `unit_msrp × conservative_floor_rate` (default 10%)
- **AND** the item is tagged "low confidence"

### Requirement: Condition recovery rates are configurable and self-calibrating
The system SHALL ship with default recovery rates by condition grade (e.g., New 0.55, Like New 0.45, Customer Returns 0.35, Salvage 0.10) that the user can edit, and SHALL recompute suggested rates per seller/category once the lot-history capability has ≥3 recorded outcomes for that segment.

#### Scenario: User edits default rates
- **WHEN** the user edits a condition grade's recovery rate
- **THEN** subsequent valuations use the edited rate

#### Scenario: Suggested rates from history
- **WHEN** the lot-history capability has ≥3 recorded outcomes for a seller/category segment
- **THEN** the system recomputes and displays suggested recovery rates for that segment

### Requirement: Grail-risk detection and dual valuation
The system SHALL detect value concentration and produce an alternate valuation that excludes concentrated items.

#### Scenario: Grail discounting
- **WHEN** valuation runs on a manifest where >40% of estimated value is concentrated in ≤3 line items
- **THEN** those items are flagged "grail risk"
- **AND** an alternate valuation excluding them is shown
- **AND** the recommended max bid uses the bread-and-butter (grails-excluded) valuation
