# bid-calculator

## ADDED Requirements

### Requirement: Backwards max-bid computation
The system SHALL compute, as pure deterministic functions:

```
expected_revenue   = Σ item resale estimates
selling_costs      = expected_revenue × selling_fee_rate        (default 0.15)
total_budget       = expected_revenue − selling_costs − required_profit
auction_budget     = total_budget − freight
max_bid            = auction_budget / (1 + buyers_premium)      (default premium 0.10)
landed_unit_price  = total_budget / total_units
```

`required_profit` SHALL accept either an absolute dollar amount or a percentage of expected revenue.

#### Scenario: Worked example
- **WHEN** the calculator runs with expected_revenue $2,400, fee rate 15%, required profit $800, freight $340, premium 10%
- **THEN** total_budget = $1,240, auction_budget = $900, max_bid = $818 (floor to whole dollars)
- **AND** for 200 units landed_unit_price = $6.20

#### Scenario: Deal impossible at current price
- **WHEN** analysis is displayed and the listing's current bid already exceeds max_bid
- **THEN** the lot is marked "PASS — current bid above your walk-away number" with the gap shown

### Requirement: Walk-away framing
The UI SHALL present max_bid as a single walk-away number with copy that reinforces one proxy bid at max (B-Stock proxy bidding + popcorn-bidding extensions make sniping ineffective), and SHALL NOT present any "bid a little more to win" affordance.

#### Scenario: Max bid displayed
- **WHEN** an analyzed lot's verdict is displayed
- **THEN** max_bid is shown as a single walk-away number with one-proxy-bid guidance
- **AND** no "bid a little more to win" affordance is present anywhere in the UI
