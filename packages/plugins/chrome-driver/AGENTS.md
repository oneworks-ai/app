# Chrome Driver Plugin

This package controls an explicitly paired external Google Chrome through a Manifest V3 extension.

- `extension/` owns Chrome API calls, optional-permission prompts, stable tab/frame/document identities, semantic page operations, bounded debugger domains, and the oneWorks Web handshake.
- `server/src/` owns the authenticated loopback request/ack bridge, pairing/reconnect state, high-risk confirmation grants, and redacted audit records. The bridge is started by the normal workspace plugin runtime; users must not configure or manage it.
- `bin/` owns MCP schemas, per-target scheduling, workflow execution, compact results, and progressive step lookup. It may call only named semantic operations.
- `bin/extension-release.cjs`, `materialize-extension.cjs`, `package-extension.cjs`, `validate-extension-package.cjs`, and `publish-chrome-web-store.cjs` own Chrome version mapping, flavor materialization, deterministic ZIPs, release validation, and the Web Store V2 state machine. The official developer/Web Store artifact is the audited privileged flavor; base is the optional minimal artifact, and release code must never package E2E.
- `store-assets/` owns Chrome Web Store listing/reviewer copy, screenshots, and promotional images. These files are release inputs, not extension runtime assets, and must not enter the npm package or extension ZIP. Public extension privacy policies live in `.oo/docs/privacy.md` and `.oo/docs/en/privacy.md`.
- `client/` owns the oneWorks connection/permission/recovery UI and Web bridge handshake. Reuse host UI primitives and tokens.

Prefer named semantic operations. Arbitrary JavaScript/CDP, complete cookie values, and sensitive page fields may be exposed only through their dedicated advanced-access operations after an explicit `chrome.storage.session` toggle, exact target/origin binding, and server-enforced per-use R4 confirmation. Sensitive result pass-through must be allowlisted by the bridge from the actual operation name and must never enter audit summaries. Never expose the Chrome password vault, arbitrary filesystem paths, remote code execution, cross-origin bypasses, or silent permission grants. All page operations require `tab_id`; ref-bearing mutations require the snapshot/frame `document_id`. Keep one canonical tab target serial for the complete workflow and allow independent tabs to run concurrently.

Run `pnpm -C packages/plugins/chrome-driver test`, `pnpm -C packages/plugins/chrome-driver typecheck`, `pnpm -C packages/plugins/chrome-driver package:extension:all`, and the repository typecheck after changes.
