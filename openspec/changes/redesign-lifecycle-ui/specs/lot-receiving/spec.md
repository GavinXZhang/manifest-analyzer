# lot-receiving

## ADDED Requirements

### Requirement: Lot lifecycle stage
Every lot SHALL have a stage from {analyzing, bid_placed, won, received, selling, closed}, and every stage change SHALL be recorded with a timestamp in a stage event log.

#### Scenario: Outcome drives the stage
- **WHEN** the user saves an outcome of won for a lot
- **THEN** the lot's stage becomes `won` and a stage event with the current time is recorded

#### Scenario: Lost lot closes
- **WHEN** the user saves an outcome of lost for a lot
- **THEN** the lot's stage becomes `closed`

#### Scenario: Existing lots are back-filled
- **WHEN** the schema migration runs on a database with lots that have no stage
- **THEN** each lot receives an inferred stage (won/closed from its outcome, selling if it has inventory, otherwise analyzing) and a single back-filled stage event flagged as inferred

### Requirement: Check-in tallies per manifest line
For a lot in stage `won` or `received`, the system SHALL let the user record per manifest line: units received, and how many of them work, are incomplete, have a weak battery, or are dead, plus a free-text note. Tallies SHALL be saved per line as they are entered.

#### Scenario: Recording a line
- **WHEN** the user enters received 4, works 2, incomplete 0, weak battery 1, dead 1 for a manifest line
- **THEN** the tallies are persisted for that line and the lot's check-in progress counts 4 more units checked

#### Scenario: Tallies must add up
- **WHEN** works + incomplete + weak battery + dead exceeds units received for a line
- **THEN** the save is rejected with a message naming the line

#### Scenario: Progress is visible
- **WHEN** 68 of 103 manifest units have been checked
- **THEN** the lot shows "68 / 103 checked" and the counts of working, incomplete/weak, and dead units

### Requirement: Working units flow into inventory
The system SHALL create or update inventory rows for a lot's working units with quantity equal to the works tally, cost basis equal to the lot's landed unit cost, kind `unit`, and a link to the manifest line. Re-running the transfer SHALL adjust quantities rather than create duplicates.

#### Scenario: First transfer
- **WHEN** the user sends working units to inventory for a lot whose landed unit cost is $52.30
- **THEN** one inventory row per manifest line with works > 0 exists, with qty = works and cost = $52.30

#### Scenario: Re-transfer after more check-in
- **WHEN** the user updates a line's works tally from 2 to 3 and sends working units again
- **THEN** the existing inventory row for that line has qty 3 and no second row was created

### Requirement: Stage transitions from check-in and selling
The system SHALL move a lot to `received` when the user finishes check-in, to `selling` when the first listing is created for one of its inventory items, and SHALL suggest `closed` when every unit is sold or disposed.

#### Scenario: Finishing check-in
- **WHEN** the user presses "Finish check-in" on a won lot
- **THEN** the lot's stage becomes `received` and a stage event is recorded

#### Scenario: First listing
- **WHEN** a listing is created for an inventory item that belongs to a lot in stage `received`
- **THEN** the lot's stage becomes `selling`

#### Scenario: Everything sold
- **WHEN** the last remaining unit from a lot is marked sold
- **THEN** the lot shows a suggestion to close it, and closing requires the user's confirmation

### Requirement: Unchecked won lots are flagged
A lot in stage `won` SHALL be flagged as overdue for check-in once more days than the configured threshold have passed since it was won.

#### Scenario: Rotting tint
- **WHEN** a lot has been in stage `won` for 12 days and the threshold is 7
- **THEN** the lot appears highlighted on the board with "12d unchecked" and on Today as needing check-in
