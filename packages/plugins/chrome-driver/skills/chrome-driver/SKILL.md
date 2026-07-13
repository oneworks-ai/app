---
name: chrome-driver
description: Control a user-paired external browser through a Chrome extension, explicit typed targets, and semantic operations.
---

# External Browser Driver

1. Call `chrome_capabilities` before using a capability family for the first time. Missing permissions are recoverable: ask the user to grant the named group from the Chrome extension popup, then retry. The oneWorks page reports permission state but never grants Chrome permissions itself.
2. Discover targets with `chrome_windows`, `chrome_tabs`, and `chrome_frames`. Never guess IDs or rely on an implicit current tab.
3. Reuse the returned `tab_id`, `frame_id`, and `document_id`. Refresh the target/snapshot after `TARGET_NOT_FOUND` or `DOCUMENT_CHANGED`.
4. Prefer `execute_chrome_workflow` for ordered page-local work. Independent tab workflows may be submitted together with `execute_chrome_workflows`.
5. High-risk operations return `CONFIRMATION_REQUIRED`; describe the audit summary and wait for the user to approve it in the extension/oneWorks UI before retrying.
6. Prefer semantic operations. Use `chrome_raw`, `chrome_cookies.list_with_values`, `chrome_page.snapshot_sensitive`, or `chrome_page.type_sensitive` only when the matching `advanced_access` capability is enabled by the user for this browser session. Raw is a browser-session-wide superset of cookie/sensitive-field access and executes globally exclusively. Always supply the intended `tab_id` and expected origin as a navigation guard, explain that this is not a security boundary, review the R4 preview, and obtain confirmation for every use.
7. Never claim access to Chrome Password Manager: Chrome exposes no extension API for reading or exporting saved passwords. Sensitive page operations cover only page fields, DOM, and storage. Do not request host file-system paths, host-process code execution, cross-origin bypasses outside the explicit Raw capability, or silent permission grants.
