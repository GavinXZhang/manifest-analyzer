# recurring-expenses

## ADDED Requirements

### Requirement: Recurring expense definitions
The system SHALL let the user define recurring expenses (name, amount, category, due day 1–28, active flag). Existing storage units SHALL migrate to recurring expenses in the storage category.

#### Scenario: Adding a unit
- **WHEN** the user adds "Extra Space 5×10", $129, storage, due on the 15th
- **THEN** it appears under Storage & recurring with its next due date

### Requirement: Automatic, idempotent posting
The system SHALL post each active recurring expense to the ledger once per period when its due day has passed, and SHALL back-fill a missed period on the next opportunity without posting twice.

#### Scenario: Due day reached
- **WHEN** it is the 15th or later and the $129 expense has not been posted for this month
- **THEN** an expense of $129 dated the 15th, marked automatic and linked to the recurring definition, is created and the definition records this period as posted

#### Scenario: Opened twice in a month
- **WHEN** the posting routine runs again in the same month
- **THEN** no second expense is created

#### Scenario: Not opened for a month
- **WHEN** the app was not used in September and is opened on October 3rd
- **THEN** both the September and October postings exist, each dated to its own due day

### Requirement: Burn rate
The system SHALL show the monthly total of active recurring expenses and the storage-only total used for carrying cost.

#### Scenario: Burn shown
- **WHEN** recurring expenses are $55 and $129 per month, both storage
- **THEN** Money shows a burn of $184 per month
