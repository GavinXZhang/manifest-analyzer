# lot-history

## ADDED Requirements

### Requirement: Outcome logging
The system SHALL let the user record for any analyzed lot: won/lost, final price, and (later) actual gross recovered. Recorded outcomes SHALL feed recovery-rate calibration and a running scoreboard (predicted vs. actual).

#### Scenario: Recording an outcome
- **WHEN** the user records won/lost and final price for an analyzed lot
- **THEN** the outcome is persisted and appears in the predicted-vs-actual scoreboard

#### Scenario: Recording recovered value later
- **WHEN** the user later records actual gross recovered for a won lot
- **THEN** the outcome feeds recovery-rate calibration for that lot's seller/category segment

### Requirement: Market closing-range prediction
The system SHALL predict a market closing range from recorded final prices, clearly separated from the user's own walk-away number.

#### Scenario: Ceiling estimation from history
- **WHEN** a new lot is analyzed in a seller+category segment with ≥5 recorded final prices
- **THEN** the system displays a predicted market closing range (as a % of extended retail) alongside the user's own max bid
- **AND** the two numbers are clearly labeled "market estimate" vs "your walk-away number"
