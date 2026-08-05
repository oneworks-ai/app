# Winget Manifest Templates

This directory keeps the OneWorks Windows Package Manager manifest templates.

The public `winget install --id OneWorks.OneWorks -e` path only works after the manifests are submitted to and accepted by `microsoft/winget-pkgs`.

## Release Flow

1. Publish `oneworks` to npm.
2. Let the stable npm workflow publish the version-pinned Windows portable zip containing `oneworks.cmd`, `ow.cmd`, and `owo.cmd`. The launchers require Node.js 22+ and resolve the exact published `oneworks` version through npm.
3. Sync versions and installer metadata:

   ```bash
   pnpm tools windows-install sync-oneworks \
     --version <version> \
    --winget-installer-url <windows-zip-url>
   ```

4. Copy these templates into the matching `manifests/o/OneWorks/OneWorks/<version>/` path in a fork of `microsoft/winget-pkgs`, then validate and submit the PR.

The Scoop bucket can be released before the winget PR is accepted.
