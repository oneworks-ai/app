# Chrome Web Store listing

## Product details

- Name: `OneWorks`
- Default language: English (United States)
- Category: Developer Tools
- Homepage: `https://oneworks.cloud/`
- Support: `https://github.com/oneworks-ai/app/issues`
- Privacy policy: `https://oneworks.cloud/docs/en/privacy`
- Visibility: Public
- Pricing: Free

### Detailed description

Connect OneWorks to browser tabs you explicitly select, then let your authorized Agent inspect, operate, and debug those targets with stable tab, frame, and document identities.

OneWorks provides typed browser automation for tabs, windows, page semantics, forms, screenshots, bookmarks, history, downloads, Reading List, and site data. Developer capabilities include exact-tab Chrome debugger access, network and console inspection, performance metrics, PDF and page capture, session-gated raw JavaScript/CDP, and typed proxy controls.

Safety is part of the control model:

- The extension connects only after an explicit pairing with a trusted OneWorks origin.
- Every operation names its exact browser target; it never guesses the current tab.
- Sensitive values are redacted by default.
- Raw JavaScript/CDP, complete cookie values, and sensitive fields are off by default and reset with the browser session. Proxy status is readable after pairing; every proxy set or clear requires exact high-risk confirmation.
- High-risk operations require a confirmation bound to the exact operation, target, and arguments.
- Operations produce auditable summaries without storing complete secrets.

OneWorks is intended for developers who want an Agent to work with their real browser while preserving visible control, recoverable permissions, target isolation, and an explicit audit trail.

## Privacy practices

### Single purpose

After an explicit user pairing, allow a user-authorized OneWorks Agent to operate and debug browser targets selected by that user.

### Permission justifications

- `activeTab`: Grants temporary access to the user-selected active tab during pairing and visible actions.
- `alarms`: Schedules a reconnect attempt after a capability-sync or polling failure, without keeping a persistent background page alive.
- `storage`: `chrome.storage.local` stores the paired bridge URL, trusted origin, reconnect client token, and OneWorks tab ID. `chrome.storage.session` stores the extension/cursor session state and advanced-access policy so those switches reset with the Chrome session.
- `debugger`: Provides developer-requested console, network, DOM, performance, screenshot, PDF, and explicitly enabled raw JavaScript/CDP operations for an exact tab. Chrome shows the debugger attachment; it remains scoped to that tab until an explicit detach or Chrome ends the attachment.
- `proxy`: Reads the current Chrome proxy status and applies typed proxy settings. Every set or clear is classified as high risk and requires confirmation bound to the exact requested configuration.
- Loopback host access: Connects the extension to a locally running OneWorks bridge and completes the bidirectional origin/version handshake.
- Optional HTTP(S) host access: Accesses only origins the user grants for selected page/frame operations; it is requested on demand rather than at installation.
- Optional browser-data permissions: Bookmarks, history, downloads, Reading List, cookies, site settings, browsing data, privacy, tab groups, navigation, and related capabilities are requested in labeled groups only when the user enables those existing features.

### Remote code

Declare the developer execution capability in the dashboard: **Yes — only through Chrome's documented `chrome.debugger` API.** The packaged extension does not download remotely hosted extension files, libraries, JavaScript, or WebAssembly. Raw JavaScript/CDP is a user- or Agent-directed developer operation against an explicitly selected browser target. It is off by default, requires an explicit session enablement and exact-target preflight, and each execution requires high-risk confirmation. Chrome's Manifest V3 policy expressly permits code execution through documented debugger APIs when used for their intended purpose.

### Data-use disclosures

Disclose the following categories because the extension can handle them when the user invokes the corresponding capability:

- Personally identifiable information
- Health information
- Financial and payment information
- Authentication information
- Personal communications
- Location
- Web history
- User activity
- Website content

These categories are disclosed because a selected page or requested debugger result may contain them; the extension does not independently seek them. The extension does not sell data, use it for advertising or credit decisions, or transfer it to data brokers. Data is used only to provide the user-requested browser-control and debugging purpose. It is sent to the explicitly paired OneWorks instance and, when needed for the requested Agent operation, to model, AI, or tool providers configured by the user or instance operator. Certify all Chrome Web Store Limited Use statements and use `https://oneworks.cloud/docs/en/privacy` as the policy URL.

## Test instructions

1. Install OneWorks from `https://github.com/oneworks-ai/app/releases` and start the desktop application or local Web UI.
2. Open Settings → External Browser.
3. Open the extension popup in the same Chrome profile and choose “Connect this OneWorks tab”.
4. Return to External Browser settings and connect the browser.
5. Use a normal test page to verify tab discovery and a semantic click or scroll. Raw JavaScript/CDP and other sensitive advanced access remain off until explicitly enabled. Proxy status is available after pairing; proxy changes require an exact high-risk confirmation.

No paid account or reviewer credential is required.
