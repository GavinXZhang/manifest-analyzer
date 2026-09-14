# salvage-planning

## ADDED Requirements

### Requirement: Parts book
The system SHALL maintain a user-editable parts book: product families, each with match rules (brand and keywords) and a list of parts with a low and high value. It SHALL ship seeded with families for the product types in the owner's first lots, and every seeded value SHALL be labeled as an estimate.

#### Scenario: Editing a part value
- **WHEN** the user changes the Dyson V11 battery range from $40–70 to $45–65 in Settings
- **THEN** every salvage plan that references that family shows the new range

#### Scenario: Adding a family
- **WHEN** the user adds a family "Samsung Jet" with keyword "JET" and brand "SAMSUNG"
- **THEN** manifest lines matching those rules are grouped under that family in salvage plans

### Requirement: Family matching
The system SHALL assign each manifest line to at most one parts-book family using the family's match rules against the line's description, brand and vendor, and SHALL leave lines with no match ungrouped.

#### Scenario: Match by keyword
- **WHEN** a manifest line reads "DYSON V11 TORQUE DR STICK" and a family "Dyson V11" matches brand DYSON with keyword V11
- **THEN** the line is assigned to "Dyson V11"

#### Scenario: No match
- **WHEN** a manifest line matches no family
- **THEN** it appears in the salvage plan under "Unmatched" with no parts list

### Requirement: Salvage plan per lot
For a lot with check-in tallies, the system SHALL produce a salvage plan that groups dead and weak-battery units by family and shows, per family: the counts, the parts list with value ranges, and a parts-out floor equal to dead units × the family's summed low/high part values.

#### Scenario: Plan for a family with dead units
- **WHEN** a lot has 1 dead and 1 weak-battery Dyson V11
- **THEN** the plan shows "Dyson V11 · 1 dead · 1 weak batt." with the family's parts and a floor range

#### Scenario: Lot-level floor
- **WHEN** the plan has families with floors $120–200 and $200–350
- **THEN** the lot shows a salvage floor of $320–550

### Requirement: Cannibalisation suggestion
When a family has both dead and weak-battery units in a lot, the system SHALL suggest swapping parts from dead units into weak ones and state how many additional working units that yields (the smaller of the two counts).

#### Scenario: One donor, one recipient
- **WHEN** a family has 1 dead and 1 weak-battery unit
- **THEN** the plan states that swapping the battery yields 1 more working unit

### Requirement: Parts become inventory
The system SHALL let the user create inventory rows of kind `parts` from a salvage plan, one per part per family, with quantity equal to the dead-unit count, cost 0, and the family's part value range as the pricing hint.

#### Scenario: Creating parts items
- **WHEN** the user presses "Create parts inventory items" for a plan with 1 dead Ecovacs X2 Omni
- **THEN** inventory rows "Ecovacs X2 — OMNI station", "— LiDAR / mainboard", "— battery" exist with qty 1, cost $0, kind `parts`
