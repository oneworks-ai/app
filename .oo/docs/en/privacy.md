# OneWorks Chrome Extension Privacy Policy

Effective date: July 14, 2026

This policy explains how the “OneWorks” Chrome extension handles user data. The extension has one purpose: after an explicit pairing, it lets a user-authorized OneWorks Agent operate and debug browser targets selected by the user.

## Data handled

Depending on the capabilities the user enables, the browser targets the user selects, and the operations the user requests, the extension may handle Chrome Web Store data categories including personally identifiable information, health information, financial and payment information, authentication information, personal communications, location, web history, user activity, and website content. The extension does not seek these categories independently; it can encounter them when they are present in a selected browser target or result requested by the user. Examples include:

- identifiers and metadata for browsers, windows, tabs, groups, frames, and documents, including URLs, titles, and favicons;
- page content, form fields, console, network, and performance information that the user asks an Agent to inspect or operate;
- bookmarks, history, downloads, Reading List entries, cookies, site settings, and browsing data that the user authorizes on demand;
- origins, protocol versions, capabilities, connection state, and audit classifications required to pair the extension with OneWorks.

Password fields, complete cookie values, sensitive page fields, and raw JavaScript/CDP are off by default. A user must explicitly enable the relevant advanced access for the current browser session, and high-risk operations still require per-use confirmation bound to the exact target and arguments. Proxy status is available after pairing because `proxy` is a required developer permission; setting or clearing a proxy is a high-risk operation that requires exact per-use confirmation. The extension does not read passwords saved in Chrome Password Manager.

## How data is used

Data is used only to perform browser control, debugging, workflows, safety confirmations, and auditing explicitly requested by the user. The extension does not use user data for advertising or credit decisions, sell user data, or transfer user data to data brokers.

The extension communicates only with the authenticated OneWorks bridge bound to the loopback interface on the user's device. Results needed by an Agent may then be sent by the paired OneWorks runtime to model, AI, or tool providers configured by the user or the runtime operator. Those providers process and retain data under their own policies and the user's configuration. The operator of a configured OneWorks runtime is responsible for its server-side data handling and retention.

## Storage and retention

- `chrome.storage.local` stores the paired bridge URL, trusted origin, reconnect client token, and OneWorks tab identifier under the connection record.
- `chrome.storage.session` stores the extension session identifier, cursor session/state, and advanced-access policy. Session data is cleared when the Chrome session ends.
- Operation results and audit records are retained by the paired OneWorks instance according to its configuration. The extension does not create a separate cloud advertising profile or analytics database.
- Users can disconnect or forget a connection, revoke Chrome permissions, clear extension data, or uninstall the extension.

## Sharing and security

We do not share user data for advertising, sale, credit decisions, or data brokerage. Data passes from the extension to the authenticated local loopback bridge and may then be sent by the paired OneWorks runtime to user- or operator-configured model, AI, and tool providers when necessary to perform the requested operation. We may also disclose data when required by law or necessary to address a security incident. Sensitive results are redacted by default, and access is limited through trusted-origin handshakes, session scope, stable target identities, risk levels, confirmations, and auditing. Users and operators are responsible for secure transport and access controls for configured provider endpoints.

The use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/), including the Limited Use requirements.

## Contact

For questions about this policy or data handling, contact [support@oneworks.cloud](mailto:support@oneworks.cloud).

[简体中文](../privacy.md)
