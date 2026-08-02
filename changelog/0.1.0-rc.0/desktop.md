# @oneworks/desktop 0.1.0-rc.0

- Allow unsigned macOS release artifacts when signing is disabled and label them accurately; when signing is enabled, require the complete Developer ID and notarization credentials, notarize and staple both DMG and PKG installers, then verify the installed app and installers with `codesign`, `pkgutil`, `stapler`, and Gatekeeper.
- Record a release-candidate manifest and allow a verified candidate run to be promoted without rebuilding its desktop artifacts.
- Give cold local-plugin source compilation its own two-minute deadline during packaged-server smoke tests while keeping ordinary HTTP requests at 30 seconds, so valid macOS release builds are not rejected without masking stalled endpoints.
