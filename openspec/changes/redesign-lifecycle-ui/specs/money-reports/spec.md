# money-reports

## ADDED Requirements

### Requirement: Period selection with comparison
Money SHALL offer a period selector (30 days, 90 days, year to date, all time) and an optional lot filter; scorecards SHALL show the value for the period and the change versus the immediately preceding period of the same length.

#### Scenario: Ninety-day scorecards
- **WHEN** the user selects 90 days
- **THEN** revenue, expenses, net profit, profit per hour and sell-through are shown for the last 90 days, each with the delta versus the prior 90 days

### Requirement: One chart area with a switcher
Money SHALL present a single chart area with a switcher between: revenue vs goal, net profit, funnel, cycle time, hours, storage. Switching SHALL not change the selected period. Each chart SHALL offer a table view of the same data.

#### Scenario: Switching charts
- **WHEN** the user switches from "Revenue vs goal" to "Funnel"
- **THEN** the funnel renders for the same period and lot filter

#### Scenario: Table view
- **WHEN** the user presses "Table" on any chart
- **THEN** the same series is shown as a table with the same period

### Requirement: Revenue vs goal
The revenue chart SHALL show revenue per month as columns inside a neutral goal ghost bar sized to the configured monthly revenue goal, with the current month labeled as to-date and its progress toward the goal stated.

#### Scenario: Progress statement
- **WHEN** the goal is $3,000 and September revenue to date is $2,140 on the 14th
- **THEN** the chart states September is 71% of goal with the days remaining

### Requirement: Funnel
The funnel SHALL count lots that reached each stage (analyzed → bid placed → won → received → sold through) in the period, show stage-to-stage conversion percentages between columns, and state the overall analyzed-to-won rate.

#### Scenario: Conversion between stages
- **WHEN** 10 lots were analyzed, 6 had bids placed and 3 were won in the period
- **THEN** the funnel shows 60% between analyzed and bid placed and 50% between bid placed and won, with an overall 30% win rate

### Requirement: Cycle time
The cycle-time chart SHALL show the average days lots spend in each stage (won → received, received → selling, selling → closed) computed from the stage event log, excluding back-filled events, and state the average total cycle.

#### Scenario: Average time in stage
- **WHEN** two lots took 12 and 4 days from won to received
- **THEN** the chart shows 8 days for that stage and the tooltip states it is based on 2 lots

### Requirement: Hours and storage charts
The hours chart SHALL show hours per day for the period as columns; the storage chart SHALL show recurring storage cost per month against revenue per month.

#### Scenario: Hours chart
- **WHEN** the user selects the hours chart for 30 days
- **THEN** one column per day shows hours punched, with days without punches shown empty

### Requirement: Predicted vs actual and tax set-aside remain
Money SHALL keep the predicted-vs-actual scoreboard with calibration suggestions and the quarterly tax set-aside estimate.

#### Scenario: Scoreboard present
- **WHEN** the user opens Money
- **THEN** the predicted-vs-actual table, calibration link and current-quarter set-aside are visible
