# time-card

## ADDED Requirements

### Requirement: Punch clock
The system SHALL let the user clock in with a task category and optional lot, and clock out later; a running punch SHALL persist server-side so it survives closing the page or switching devices. Only one punch SHALL be running at a time.

#### Scenario: Clock in
- **WHEN** the user clocks in with category "receiving" on lot MON-6995946
- **THEN** a punch with the current start time and no end time exists and Today shows it running with elapsed time

#### Scenario: Clock out
- **WHEN** the user clocks out
- **THEN** the running punch gets the current end time and its duration counts toward the day

#### Scenario: Switch task
- **WHEN** the user switches the running punch from "receiving" to "listing"
- **THEN** the current punch is closed and a new one starts with the new category

#### Scenario: Second clock-in refused
- **WHEN** a punch is already running and the user clocks in again
- **THEN** the request is refused and the running punch is shown instead

### Requirement: Manual entries and edits
The system SHALL let the user add a punch with explicit start and end times, and edit or delete any punch.

#### Scenario: Forgot to clock out
- **WHEN** a punch has been running for 14 hours and the user edits its end time to 18:08 the previous day
- **THEN** the punch is closed with that end time and the day's hours reflect it

### Requirement: Weekly time card
The system SHALL show a week grid (Monday–Sunday) of hours per day, the week total, hours by task category with share, and a punch log for the week; the user SHALL be able to step to previous weeks.

#### Scenario: Week view
- **WHEN** the user has punches on Mon 2.5h, Tue 4.0h, Thu 3.2h, Fri 5.1h, Sun 2.7h
- **THEN** the week grid shows those values, blanks for Wed and Sat, and a total of 17.5h

### Requirement: Profit per hour and labor cost per lot
The system SHALL compute profit per hour as net profit ÷ hours for the selected period, and labor cost per lot as hours punched against the lot × the configured hourly value (default: trailing profit per hour).

#### Scenario: Profit per hour
- **WHEN** net profit over 90 days is $1,516 and 37 hours were punched
- **THEN** the Money scorecard shows $41 per hour

#### Scenario: Labor cost on the scoreboard
- **WHEN** 7 hours were punched against a lot and the hourly value is $41
- **THEN** the lot's predicted-vs-actual row shows $287 of labor

### Requirement: Migration of existing hours
Existing hour-log rows SHALL become manual punches and a running legacy timer SHALL become a running punch, so no logged time is lost.

#### Scenario: Legacy hours
- **WHEN** the migration runs with a legacy hours row of 3.5h on 2026-08-20
- **THEN** a manual punch from 09:00 to 12:30 on that date exists
