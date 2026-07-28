---
name: external-browser-driver
description: Control a user-paired external browser through a Chrome extension, explicit typed targets, and semantic operations.
---

# Browser Control

Browser Control currently controls Google Chrome through the OneWorks extension. Its browser-facing contract is
transport-neutral so future extension transports, such as Firefox, can implement the same capability without
renaming the product.

1. Call `chrome_capabilities` before using a capability family for the first time. Missing permissions are recoverable: ask the user to grant the named group from the Chrome extension popup, then retry. The OneWorks page reports permission state but never grants Chrome permissions itself.
2. Discover targets with `chrome_windows`, `chrome_tabs`, and `chrome_frames`. Never guess IDs or rely on an implicit current tab.
3. Reuse the returned `tab_id`, `frame_id`, and `document_id`. Refresh the target/snapshot after `TARGET_NOT_FOUND` or `DOCUMENT_CHANGED`.
4. Prefer `execute_chrome_workflow` for ordered page-local work. Independent tab workflows may be submitted together with `execute_chrome_workflows`.
5. High-risk operations return `CONFIRMATION_REQUIRED`; describe the audit summary and wait for the user to approve it in the extension/OneWorks UI before retrying.
6. Prefer semantic operations. Use `chrome_raw`, `chrome_cookies.list_with_values`, `chrome_page.snapshot_sensitive`, or `chrome_page.type_sensitive` only when the matching OneWorks advanced-access preference has been applied to the connected browser and capability discovery reports it enabled. Raw is a browser-session-wide superset of cookie/sensitive-field access and executes globally exclusively. Always supply the intended `tab_id` and expected origin; the bridge and extension additionally negotiate and enforce an exact full-URL fingerprint without exposing query or fragment values. Review the R4 preview and obtain confirmation for every use.
7. Never claim access to Chrome Password Manager: Chrome exposes no extension API for reading or exporting saved passwords. Sensitive page operations cover only page fields, DOM, and storage. Do not request host file-system paths, host-process code execution, cross-origin bypasses outside the explicit Raw capability, or silent permission grants.
