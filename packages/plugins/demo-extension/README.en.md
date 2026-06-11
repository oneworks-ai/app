# Plugin Demo Extension

This local plugin validates plugin-to-plugin extension points.

It contributes one quick action to the `demo/quick-actions` extension point exposed by Plugin Demo through the manifest. Its client entry also listens with `ctx.extensionPoints.onAvailable('demo/quick-actions', callback)` and records the target point metadata. Clicking the contributed action calls this plugin's own `demo-quick-action` command through the scoped command runtime, and that command calls the Demo plugin's pure client API with `ctx.pluginApis.call('demo/describe-extension-point', input)`.

It also adds a left more-menu item for a simple activation status command.

The source entry lives in `client/src/index.tsx`, while the host loads `client/dist/index.js` by default. Frontend dev mode loads the source entry through the host Vite dev server; run `pnpm -C packages/plugins/demo-extension build` after source edits to generate the committed or published browser ESM output with Vite.
