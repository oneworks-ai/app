# Cursor Package

`@oneworks/cursor` owns the reusable pointer SVG design only: geometry, hex-color validation, contrast border selection, and SVG serialization.

- Plugins remain responsible for choosing colors, session defaults, Agent-facing configuration, storage, lifecycle, motion, and permissions.
- Keep the package synchronous and dependency-free. `index.cjs` preserves direct CommonJS plugin consumption while `index.mjs` is the native ESM/browser entry; parity tests must keep their serialized SVG output identical.
- Add new visual variants through explicit render options; do not add CUA-specific motion or daemon behavior here.

Run `pnpm -C packages/cursor test` after changes.
