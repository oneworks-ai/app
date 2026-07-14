# OneWorks

The OneWorks Chrome extension lets a OneWorks Agent control an explicitly paired browser. It reuses Browser Driver workflow and progressive-result infrastructure while keeping a separate Chrome bridge, stable `windowId` / `tabId` / `frameId` / `documentId` targets, and typed tools. It never guesses an implicit current tab. Arbitrary JavaScript/CDP, complete cookie values, and sensitive page fields are off by default and can be explicitly enabled for the current browser session from Settings or the extension popup.

[简体中文](./README.md)

## Install the development extension

```bash
pnpm --filter @oneworks/plugin-chrome-driver build:extension
```

Enable Developer mode at `chrome://extensions`, choose “Load unpacked”, and load `packages/plugins/chrome-driver/dist-extension/privileged`. Open “External Browser” in OneWorks Settings, choose “Connect this OneWorks tab” in the extension popup, then click “Connect browser” in OneWorks.

The official developer package declares `debugger` and `proxy` for bounded network/console/DOM/performance debugging, full-page screenshots, PDF output, and proxy control. Bookmarks, history, cookies, downloads, and site-data capabilities remain grouped popup requests and still pass through session switches, risk confirmation, and auditing. For semantic-only operation, run `build:extension:minimal` and load `dist-extension/base`. `build:extension:e2e` is for isolated-profile automation only and must not be installed in a daily browser.

## Build distributable ZIPs

```bash
pnpm --filter @oneworks/plugin-chrome-driver package:extension:all
```

Artifacts are written under `packages/plugins/chrome-driver/dist-package/`:

- `oneworks-v<version>.zip` is the official developer package with `debugger` / `proxy`, for Chrome Web Store upload or unpacked sideloading.
- `oneworks-v<version>-minimal.zip` is the optional minimum-permission fallback and is not uploaded to Chrome Web Store.

Both packages use the same fixed extension identity and cannot be enabled together in one Chrome profile. Disable or remove the official developer package before switching to minimal (and vice versa), or use a separate profile for minimal.

Versioned screenshots, promotional artwork, and review copy for Chrome Web Store live in [`store-assets`](./store-assets/). The Store privacy fields use the public [OneWorks Privacy Policy](https://oneworks.cloud/docs/en/privacy).

Each ZIP has `manifest.json` at its root. Packaging maps the workspace semver to Chrome's comparable four-integer version while retaining the original string in `version_name`; for example, `0.1.0-beta.6` becomes `0.1.0.20006`. Rebuilding the same source and version produces the same SHA-256. `package:extension:all` also validates the fixed extension identity, icons, runtime entries, flavor permissions, and absence of E2E capabilities.

`.github/workflows/chrome-extension-ci.yml` builds the developer and minimal ZIPs plus `SHA256SUMS` for relevant pull requests and `main` changes. When `main` first creates a `pkg/oneworks-plugin-chrome-driver/v*` tag, Release Tags explicitly dispatches `.github/workflows/chrome-extension-release.yml`: it creates a GitHub Release with provenance attestations and, after the `chrome-web-store` environment gate, obtains a short-lived WIF service-account token to upload the full developer package and submit it for review automatically. Rerunning an existing tag restores only the GitHub Release by default so it cannot double-submit to the Store; a failed Store submission can be retried manually from the same tag with `publish_store=true`.

## Capability matrix

| Module                        | Discovery                                                                                                                                                            | Mutation / control                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser targets               | Capabilities, permissions, windows, tabs, groups, active tab, recent sessions, synced devices, displays, debug targets                                               | Create, close, activate, move, pin, mute, reload, navigate history, zoom, group                                                                                                             |
| User data                     | Bookmark tree/search, history/visits, downloads, Reading List, extension metadata                                                                                    | Bookmark CRUD/move, history cleanup, download control/record/file cleanup, Reading List maintenance; native-gesture extension/download actions are reported, not silently executed          |
| Page and frames               | Metadata, semantic snapshot, stable refs, frame/document inventory, conditions; opt-in sensitive field values                                                        | Click, type, select, key, scroll, visible screenshot, print, MHTML, PDF; opt-in sensitive/password field input                                                                              |
| Debugging and advanced access | Network/console/exception events, DOM summary, performance metrics, attach status; the privileged flavor can opt into broad `Runtime.evaluate` / CDP for the session | Explicit attach/detach and bounded screenshot/PDF; Raw is browser-session-wide, checks `tab_id` and origin before dispatch to catch accidental navigation, and requires per-use R4 approval |
| Privacy and network           | Redacted cookie metadata by default; opt-in complete values for an exact URL; site settings, removal preview, proxy/privacy values                                   | Exact cookie/site changes, origin-bounded browsing-data removal, typed proxy/privacy configuration                                                                                          |
| Workflow                      | Run, step, audit, and progressive-result lookup                                                                                                                      | Ordered steps, conditions, waits, timeout, exit when missing, checkpoints, pause/resume, cross-target concurrency                                                                           |

Commands for one target are serialized at the bridge; different targets may run concurrently. Short workflows return inline. Long workflows return a `run_id` and expose selected `step_id` results or checkpoint resume.

Semantic mutations require the `document_id` returned by snapshot or frame discovery. A navigation invalidates old refs instead of allowing a click or type to land in a replacement document. Complete workflows share a canonical tab lock, so two workflows on one tab cannot interleave while different tabs remain concurrent. Screenshot/PDF payloads use a bounded 50 MiB chunk channel instead of the request/ack JSON limit.

## OneWorks Web bridge

The distributed manifests pin one extension identity. The bridge releases a one-time ticket only after that ID, the server-owned loopback/configured OneWorks origin allowlist, the page nonce, and the bidirectional protocol version all match; extension requests must also carry the exact `chrome-extension://` Origin. It can then discover frames in that paired tab. Cross-origin frames still require matching host permission and retain separate `frameId` / `documentId` identities. Navigation, refresh, disconnect, missing permission, and version mismatch are recoverable states. Page titles are never treated as identity, and sensitive iframes are never accessed without scope.

## Risk and explicit boundaries

- R0 is capability/audit discovery; R1 metadata and semantic reads; R2 reversible target control; R3 sensitive or destructive bounded actions; R4 browser-wide privileged changes.
- The bridge computes an authoritative server-side minimum for R3/R4. Approval binds the exact operation, arguments, target, connection, and browser session, expires after five minutes, and is invalidated on session replacement. Tab/window close and complete page capture/archive/PDF are R3.
- Results are redacted at both the extension and bridge by default. URLs strip userinfo and sensitive query keys, secret-like form values and console text are masked, inline PAC source is removed, and cookie metadata discovery never returns values.
- “Advanced session access” provides switches for raw CDP/JavaScript, complete cookie values, and sensitive page fields. The policy lives only in `chrome.storage.session` and resets with the browser session. Raw is a superset of cookie and sensitive-field access and is browser-session-wide; the tab/origin preflight catches accidental navigation but is not a security boundary. Raw operations execute globally exclusively and require per-use R4 approval. Pending confirmations show a redacted preview, while persistent audit records contain only classification and hashes. Host file paths and file-system escape methods remain blocked.
- Click, type, select, key, and scroll actions use the shared 28px `@oneworks/cursor` pointer. It fades in on the first action, keeps its position across consecutive actions in the same connection session, and fades out only when the connection is disconnected or forgotten. While an action runs, the target Chrome tab temporarily uses the same Agent cursor as its favicon, then restores the page's latest favicon after completion or cancellation. State is isolated by explicit tab/document identity.
- Chrome APIs that require a native user gesture, including opening a downloaded file and enabling/disabling another extension, return `USER_GESTURE_REQUIRED`; an agent confirmation is not misrepresented as Chrome user activation.
- Chrome exposes no extension API for reading or exporting saved Password Manager entries. Advanced access covers password fields, DOM, and storage in the current page; it does not read the browser password vault.
- Still unsupported: direct browser password-vault reads, host file paths/file-system primitives, host-process code execution, cross-origin policy bypass outside raw debugger access, silent install/permission grants, operating the desktop-capture picker/stream on the user's behalf, ChromeOS-only printing APIs, and unbounded response-body capture.
