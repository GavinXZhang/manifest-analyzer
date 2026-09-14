# user-profile

## ADDED Requirements

### Requirement: Settings replaces Profile
The Profile tab SHALL be renamed Settings and organized into sections: Buyer rules, Fees & recovery rates, Selling channels, Salvage parts book, Integrations, Data & backup. Existing profile fields SHALL keep their behavior under Buyer rules and Fees & recovery rates.

#### Scenario: Existing fields preserved
- **WHEN** the user opens Settings → Buyer rules
- **THEN** home zip, max spend per lot, required profit, acceptable conditions, categories and preferred sellers are shown with their current values

### Requirement: New buyer-rule settings
Settings SHALL add: monthly revenue goal, aging warning days (default 21), aging price-cut days (default 30), price-cut percentage (default 10), check-in overdue days (default 7), and hourly labor value (default: trailing profit per hour, editable).

#### Scenario: Goal drives the chart
- **WHEN** the user sets the monthly revenue goal to $3,000
- **THEN** the revenue vs goal chart uses a $3,000 ghost bar

### Requirement: Integrations section
Settings SHALL show the Google Calendar subscribe URL with a copy action, the Claude drafting status (configured or not), and the password change control.

#### Scenario: Copy the feed URL
- **WHEN** the user presses Copy next to the calendar feed URL
- **THEN** the full absolute ICS URL is copied

### Requirement: Data & backup
Settings SHALL offer export of lots, inventory, listings, sales, expenses and punches as CSV files.

#### Scenario: Export sales
- **WHEN** the user exports sales
- **THEN** a CSV with date, amount, fees, channel, item and lot columns is produced

## REMOVED Requirements

### Requirement: Listings tab and description library
**Reason**: Listing drafts now live on the inventory item per channel; the description library had no production data.
**Migration**: Any item `listing_text` is kept as the item's draft; the `listing_library` table is dropped.

### Requirement: Storage & Hours tab
**Reason**: Storage units become recurring expenses under Money; the hours log and timer become the time card under Money and Today.
**Migration**: `storage_units` → `recurring_expenses`; `work_hours` and `timer` → `punches`.

### Requirement: Calendar tab
**Reason**: Events are shown on Today and reach Google Calendar via the ICS feed and per-event links.
**Migration**: Event data, the `/api/events` routes and the ICS feed are unchanged.

### Requirement: Taxes tab
**Reason**: The set-aside estimate is shown on Money.
**Migration**: `/api/tax-estimate` is unchanged; the standalone view is removed.
