# lot-history

## ADDED Requirements

### Requirement: Lots board with stage columns
The Lots screen SHALL show lots as cards in stage columns (Analyzing, Bid placed, Won, Received, Selling, Closed) with each column header showing the lot count and a stage-appropriate total (max bid for bid placed, landed cost for won, sell-through for selling, net for closed). Cards SHALL show the verdict or max bid, landed unit cost, seller and unit count; overdue check-in SHALL be highlighted.

#### Scenario: Column totals
- **WHEN** one lot in Won has a landed cost of $5,386.90
- **THEN** the Won column header reads "1 lot · $5,387 landed"

#### Scenario: Card opens the lot
- **WHEN** the user clicks a lot card
- **THEN** the existing lot detail page (mapping, context, comps, analysis, outcome) opens

### Requirement: Table view replaces Compare
The Lots screen SHALL offer a Table view listing confirmed lots sorted by landed unit price with verdict, max bid, expected revenue and high-confidence share; there SHALL be no separate Compare tab.

#### Scenario: Switch to table
- **WHEN** the user toggles Board to Table
- **THEN** the lots are listed sorted by landed unit price ascending with the same columns Compare showed

### Requirement: Scoreboard includes labor and cycle
The predicted-vs-actual scoreboard SHALL add labor cost (from punches against the lot) and days from won to closed for each lot.

#### Scenario: Closed lot row
- **WHEN** a lot closed 41 days after it was won with 7 hours punched
- **THEN** its scoreboard row shows a 41-day cycle and the labor cost
