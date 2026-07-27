# @oneworks/desktop 0.1.0-beta.10

- Default prerelease desktop builds to their matching update channel, never auto-downgrade to an older prerelease, and fall back to GitHub's public release feed when the anonymous API rate limit is exhausted.
- Reduce first-launch package-cache work by trusting immutable packaged build identities, linking built-in plugin caches to the installed app, cloning supported files, and moving workspace-only cache preparation off the Launcher critical path.
- Keep TLS certificate verification enabled after the embedded web debugger loads, and prefer a valid Relay account session over stale device credentials for restore and device discovery.
- Refuse to publish macOS release artifacts without Developer ID signing and notarization; notarize and staple both DMG and PKG installers, then verify the installed app and installers with `codesign`, `pkgutil`, `stapler`, and Gatekeeper.
