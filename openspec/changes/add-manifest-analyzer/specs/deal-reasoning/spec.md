# deal-reasoning

## ADDED Requirements

### Requirement: Plain-language rationale
For every analyzed lot the system SHALL output a short rationale covering: (a) value composition — where the money in the lot actually is; (b) location — freight as % of total budget and its effect on max bid; (c) seasonality — category vs. current calendar (e.g., outdoor items analyzed in fall = off-season discount opportunity, longer holding time); (d) competition — user-entered bid count and time remaining interpreted as demand signal; (e) confidence — % of valuation that is high- vs low-confidence.

#### Scenario: Rationale generated for every analysis
- **WHEN** a lot analysis completes
- **THEN** a rationale covering value composition, freight impact, seasonality, competition, and confidence is displayed

#### Scenario: Few-bids-near-close opportunity
- **WHEN** reasoning is generated and the user has entered ≤2 bids with <24h remaining
- **THEN** the rationale highlights low competition as a favorable signal
- **AND** notes it can also indicate a problem other buyers spotted, prompting a manifest re-check
