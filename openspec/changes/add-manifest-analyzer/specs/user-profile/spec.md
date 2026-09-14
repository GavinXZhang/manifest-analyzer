# user-profile

## ADDED Requirements

### Requirement: Buyer constraints
The system SHALL store: home zip, max spend per lot, required profit (absolute or %), acceptable condition grades, categories of interest, preferred sellers, and default selling-fee rate. All analyses SHALL apply the profile automatically; any lot violating a hard constraint (e.g., max spend) is marked PASS with the violated constraint named.

#### Scenario: Profile applied automatically
- **WHEN** a lot is analyzed
- **THEN** the buyer's stored profile (zip, required profit, fee rate, condition and category preferences) is applied without re-entry

#### Scenario: Hard constraint violated
- **WHEN** an analyzed lot violates a hard constraint (e.g., max_bid would require exceeding max spend per lot)
- **THEN** the lot is marked PASS
- **AND** the violated constraint is named in the verdict
