# selling-channels

## ADDED Requirements

### Requirement: Configurable selling channels
The system SHALL maintain a list of selling channels, each with a name, a fee rule (percentage plus fixed amount, optionally different for local vs shipped), applicable categories, a listing draft style, and an enabled flag. It SHALL ship seeded with eBay, Facebook Marketplace, OfferUp, Mercari, AptDeco and Craigslist with editable default fees.

#### Scenario: Editing a fee
- **WHEN** the user changes eBay's fee to 13.6% + $0.30
- **THEN** every net-after-fees figure for eBay listings reflects the new fee immediately

#### Scenario: Disabled channel
- **WHEN** the user disables Mercari
- **THEN** Mercari is not offered when adding a listing, but existing Mercari listings remain visible

### Requirement: Listings per inventory item
An inventory item SHALL be listable on any number of enabled channels, each listing having an ask price, an optional URL, a status from {draft, active, ended, sold}, and listed/ended timestamps.

#### Scenario: Adding a listing
- **WHEN** the user adds an eBay listing at $199 for an item
- **THEN** the item shows an eBay chip with $199 and the listing is active as of now

#### Scenario: Ending a listing
- **WHEN** the user ends a listing
- **THEN** its status is `ended` with the end time recorded and it no longer counts toward the item's listed status

### Requirement: Net after fees
For every listing, the system SHALL show the net the owner would receive after that channel's fee rule, and for the item SHALL show the best net across active listings with the channel it comes from.

#### Scenario: Percentage plus fixed
- **WHEN** an item is listed on eBay at $199 with fee 13.25% + $0.30
- **THEN** the listing shows net $172.34

#### Scenario: Best net
- **WHEN** an item is listed on eBay at $199 (net $172) and Facebook Marketplace local at $185 (net $185)
- **THEN** the item shows best net $185 from Facebook Marketplace

### Requirement: Derived inventory status
An inventory item's status SHALL be derived: `sold` when units sold ≥ quantity, otherwise `listed` when at least one listing is active, otherwise `unlisted`. The status SHALL not be directly editable.

#### Scenario: Status follows listings
- **WHEN** an unlisted item gets its first active listing
- **THEN** its status is `listed`

#### Scenario: Partial sale
- **WHEN** 1 of 3 units of an item is sold
- **THEN** the item remains `listed` with quantity remaining 2

### Requirement: Sales record the channel and fees
Marking an item sold SHALL record the sale amount, the channel, the fee computed from that channel's rule at the time of sale, and the inventory item, and SHALL decrement the item's remaining quantity.

#### Scenario: Mark sold from a listing
- **WHEN** the user marks an item sold on eBay for $189
- **THEN** a sale of $189 with fees $25.34 linked to the item and channel is recorded, the eBay listing is `sold`, and net revenue reports use $163.66

### Requirement: Listing drafts per channel
The system SHALL generate a listing draft for an item in the draft style of the chosen channel (template-based), and SHALL use the configured Claude drafting endpoint instead when an API key is present.

#### Scenario: Template draft
- **WHEN** the user requests a Facebook Marketplace draft for an item and no API key is configured
- **THEN** a casual-style draft with the item name, condition, ask and pickup note is shown for copying

#### Scenario: Claude draft
- **WHEN** an API key is configured and the user requests an eBay draft
- **THEN** the draft is produced by the drafting endpoint in eBay style (title ≤ 80 characters, item specifics, condition notes)
