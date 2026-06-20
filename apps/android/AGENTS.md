# Android App

`apps/android` is the native Android shell for mobile WebView experiments. It should stay an app entrypoint: shared OneWorks runtime logic belongs in `packages/*`, while Android-specific WebView orchestration, native bridges, permissions, and service wiring stay here.

## Key Entries

- `app/src/main/kotlin/ai/oneworks/android/MainActivity.kt`
  - Creates the host WebView and the native container for real target WebViews.
  - Loads packaged `apps/client/dist` through `https://oneworks.local/client/launcher` as the main host page when available; falls back to `file:///android_asset/host/index.html` only when no client dist is packaged.
- `app/src/main/kotlin/ai/oneworks/android/bridge/`
  - `BundledAssetLoader.kt`: maps `https://oneworks.local/client/` and `https://oneworks.local/server/` to APK assets and injects the host-side bridge helper into the bundled client.
  - `AndroidLocalBackend.kt`: prototype in-emulator backend adapter for `https://oneworks.local/api/*`; it serves the minimal auth/config/session/workspace API surface needed to render a workspace page and read files from the active Android workspace.
  - `HostBridge.kt`: JSON command dispatch from the host page.
  - `DeviceWorkspaceController.kt`: Android implementation of the shared `@oneworks/types` device shell workspace directory listing, picker fallback, active workspace, and recent/running project state contract.
  - `SystemAppearanceController.kt`: keeps Android status/navigation bars and safe-area background aligned with the bundled client's light/dark theme.
  - `TargetWebViewManager.kt`: real `android.webkit.WebView` creation, navigation, script execution, and lifecycle events.
  - `WebViewBridgeScripts.kt`: target-page JavaScript injection snippets.
  - `TargetJavascriptBridge.kt`: DOM event forwarding from target WebViews back to the host.
- `app/src/main/kotlin/ai/oneworks/android/accessibility/`
  - Accessibility service and command helpers. Android still requires the user to enable the service in system settings.
- `app/src/main/assets/bridge/contract.json`
  - Prototype command/event list used by `pnpm -C apps/android validate`.
- `app/src/main/assets/host/` and `app/src/main/assets/target/`
  - Local fallback host and target pages for initial functional verification without a packaged client or network dependency.
- `app/build.gradle.kts`
  - Syncs `apps/client/dist` into APK assets at `client/` when that dist exists.
  - Syncs a source snapshot of `apps/server` into APK assets at `server/source/`; when `apps/server/dist` exists, it also syncs those artifacts into `server/dist/`. This packages backend code/assets but does not make Node/Koa runnable on Android by itself.
- Bundled client pages should be built with `__ONEWORKS_PROJECT_CLIENT_BASE__=/client/`; `TargetWebViewManager.kt` maps `https://oneworks.local/client/` back to APK assets so module scripts, CSS, fonts, and CSP use a real origin instead of `file://`.
- Shared-storage project validation currently requires Android all-files access (`MANAGE_EXTERNAL_STORAGE`) when the internal directory list opens a path such as `/storage/emulated/0/Download/...`; otherwise Android scoped storage can expose directories while hiding source files. Treat this as prototype validation plumbing, not a final distribution policy.

## Current Bridge Surface

Host pages call `window.OneWorksAndroidBridge.postMessage(JSON.stringify({ id, method, params }))`.

Supported prototype commands:

- `target.create`, `target.show`, `target.destroy`, `target.snapshot`
- `target.evaluate`, `target.inject`, `target.query`, `target.click`, `target.setValue`
- `accessibility.status`, `accessibility.openSettings`, `accessibility.clickByText`, `accessibility.setTextByText`, `accessibility.globalAction`
- `device.getWorkspaceSelectorState`, `device.chooseWorkspace`, `device.openWorkspace`, `device.forgetWorkspace`, `device.stopWorkspace`

Native emits envelopes into the host page through `window.__oneworksNativeBridgeDispatch(envelope)`.

Device shell capabilities exposed to the bundled client should keep their shared TypeScript contract in `packages/types/src/device-shell.ts`. Android implements those capabilities through native WebView injection and bridge commands, including `getWorkspaceConnection()` after `openWorkspace()` navigates from `/client/launcher` to `/client/`; Electron implements the same front-end-facing shape through preload IPC.

## Verification

- Local protocol check: `pnpm -C apps/android validate`
- Android build, when SDK/Gradle are available: open `apps/android` in Android Studio or run `gradle assembleDebug` from this directory.

Keep this app Kotlin-first. Do not add AndroidX, Compose, or native UI frameworks unless a feature actually needs them; the product direction is still WebView-rendered UI with native capability bridges.
