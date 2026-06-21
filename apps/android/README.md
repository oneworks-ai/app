[简体中文](./README.zh-Hans.md)

# OneWorks Android

This is the Android WebView shell prototype. It renders the bundled OneWorks client through a host WebView and lets that host create and operate separate real target WebViews through a native JSON bridge.

## Prototype Scope

- Host WebView loads the packaged `apps/client/dist` bundle at `https://oneworks.local/client/launcher` when available. `app/src/main/assets/host/index.html` remains a local fallback/demo page when no client dist is packaged.
- Target pages are real `android.webkit.WebView` instances managed by native code.
- The host can create targets, inject JavaScript, query/click/set target DOM elements, and receive target DOM events.
- Android system bars and safe-area background follow the bundled client's light/dark theme via the injected bridge helper.
- If `apps/client/dist` exists, Gradle packages it into APK assets under `client/`; the Android host opens that bundle as the main app WebView.
- Gradle packages a snapshot of `apps/server` into APK assets under `server/source/`; if `apps/server/dist` exists later, it is also packaged under `server/dist/`. Running that Node/Koa backend on Android still needs an embedded Node runtime or a native server port.
- Accessibility commands are scaffolded through an Android `AccessibilityService`; users must enable the service in Android settings before those commands can operate other apps/pages.
- The host injects a device shell workspace API aligned with the Electron launcher shape. New Project and Open Project reuse the internal OneWorks directory list by default; Android implements directory enumeration, workspace directory creation, and recent-project state. The system directory picker remains available as a later authorization/fallback path. This validates selection/state flow; starting the OneWorks backend inside Android is still out of scope for this prototype.

## Validate

```bash
pnpm -C apps/android validate
__ONEWORKS_PROJECT_CLIENT_MODE__=standalone __ONEWORKS_PROJECT_CLIENT_BASE__=/client/ pnpm -C apps/client exec vite build
ANDROID_HOME="$HOME/.codex/android-sdk" ANDROID_SDK_ROOT="$HOME/.codex/android-sdk" ./gradlew assembleDebug
```

To build the APK, open `apps/android` in Android Studio or run `gradle assembleDebug` from this directory after installing Android SDK and Gradle.

## Visible Emulator On macOS

Use the detached helper when an agent or non-interactive shell needs to keep a visible Android Emulator window open:

```bash
pnpm -C apps/android emulator:visible -- --avd OneWorksApi35Visible --install-apk app/build/outputs/apk/debug/app-debug.apk --start-app
```

The helper starts the emulator with detached stdio redirected into `.logs/`, matching the repository's dev service startup pattern. The window is not tied to a Terminal tab or to the parent command process.
