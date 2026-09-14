# today-dashboard

## ADDED Requirements

### Requirement: Today is the home screen
The app SHALL open on Today, which SHALL be composed in one request and show: the time card (running punch or clock-in), lots needing check-in with progress and days since won, month-to-date revenue, net profit, cash in inventory and tax set-aside, inventory past the aging warning threshold, upcoming events for the next 14 days, and sales from the last 7 days.

#### Scenario: Opening the app
- **WHEN** the user opens the app
- **THEN** Today is shown with all sections populated from a single data request

#### Scenario: Nothing to check in
- **WHEN** no lot is in stage `won`
- **THEN** the check-in card is replaced by the next lot ending soonest in `bid_placed`, or is hidden if none

### Requirement: Cards link into their owning tab
Every card on Today SHALL link to the tab that owns the data (time card → Money, check-in → Receive, aging → Inventory, money → Money, events → the item) and SHALL not contain forms other than the clock in/out control and "mark sold".

#### Scenario: Continue check-in
- **WHEN** the user presses "Continue check-in" on Today
- **THEN** the Receive screen for that lot opens at the first unchecked line

### Requirement: Events reach Google Calendar
Today's upcoming events SHALL offer a Google Calendar subscribe link (the ICS feed) and each event SHALL offer an add-to-Google-Calendar link; there SHALL be no separate Calendar tab.

#### Scenario: Subscribe
- **WHEN** the user presses "Subscribe in Google Calendar"
- **THEN** the ICS feed URL is shown with a copy action and instructions
