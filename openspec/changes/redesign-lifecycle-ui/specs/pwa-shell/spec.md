# pwa-shell

## ADDED Requirements

### Requirement: Installable app
The web app SHALL provide a web app manifest (name, icons, standalone display, theme color) and a service worker so it can be installed to a phone or desktop home screen and opens without browser chrome.

#### Scenario: Install on a phone
- **WHEN** the user adds the site to their home screen on iOS or Android
- **THEN** it launches full-screen with the app icon and name "Manifest Analyzer"

### Requirement: Shell caching, never data
The service worker SHALL precache the built application shell and SHALL never cache `/api/*` responses.

#### Scenario: Offline open
- **WHEN** the app is opened with no network
- **THEN** the shell renders with a "reconnect to load data" state and no stale data is shown

#### Scenario: New version
- **WHEN** a new build is deployed and the user has the app open
- **THEN** a "new version available — reload" prompt appears and reloading loads the new shell

### Requirement: Mobile layout
At phone widths the app SHALL use a bottom tab bar (Today, Lots, Receive, Inventory, Money) and single-column layouts; Receive SHALL present one manifest line at a time with 44px-or-larger count controls; Today SHALL keep clock in/out and mark-sold reachable without scrolling past the first card.

#### Scenario: Check-in on a phone
- **WHEN** the user opens Receive on a 390px-wide screen
- **THEN** one manifest line is shown with large count controls and a "Save · next line" action

### Requirement: Password gate unaffected
The existing password gate SHALL work in the installed app.

#### Scenario: Login in the installed app
- **WHEN** the installed app opens without a session cookie
- **THEN** the password screen is shown and, after login, Today loads
