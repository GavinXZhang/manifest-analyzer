# inventory-aging

## ADDED Requirements

### Requirement: Days on shelf
Every inventory item SHALL show days on shelf, counted from its received date (or acquired date for items not from a lot) to today, or to its sold date once sold.

#### Scenario: Received item
- **WHEN** an item was received 47 days ago and is unsold
- **THEN** it shows 47 days on shelf

### Requirement: Carrying cost per item-day
The system SHALL compute a carrying cost per item-day as the month's active storage recurring expenses divided by days in the month divided by units on hand, and SHALL show each item's accrued carrying cost.

#### Scenario: Burn rate
- **WHEN** storage recurring expenses total $184 per month, the month has 30 days, and 71 units are on hand
- **THEN** the carrying cost is about $0.086 per item-day and an item 47 days on shelf shows about $4.06 accrued

### Requirement: Aging thresholds and alerts
The system SHALL flag items whose days on shelf exceed a warning threshold and SHALL suggest a price cut at a second threshold; both thresholds SHALL be configurable in Settings with defaults 21 and 30 days.

#### Scenario: Warning tint
- **WHEN** an item has been 21 days on shelf and the warning threshold is 21
- **THEN** the item's row is tinted and its days badge is amber

#### Scenario: Price-cut suggestion
- **WHEN** an item has been 30 days on shelf and the cut threshold is 30
- **THEN** the item's row is tinted red, the days badge is red, and a "Cut price" action is offered on Today and in Inventory

### Requirement: Cut price action
The "Cut price" action SHALL reduce the ask on every active listing of the item by the configured percentage (default 10%) and record the change.

#### Scenario: Applying a cut
- **WHEN** the user applies a 10% cut to an item listed at $199 on eBay and $185 on Facebook Marketplace
- **THEN** the asks become $179.10 and $166.50 and the item shows when the cut was applied
