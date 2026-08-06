# Winget Manifest Templates

This directory keeps the OneWorks Windows Package Manager manifest templates.

The public `winget install --id OneWorks.OneWorks -e` path only works after the manifests are submitted to and accepted by `microsoft/winget-pkgs`.

## Release Flow

1. Publish `oneworks` to npm.
2. Let the Stable Windows MSI Release publish and attest the version-pinned x64 per-machine MSI. The MSI installs `oneworks.cmd`, `ow.cmd`, and `owo.cmd`; Node.js LTS remains a winget dependency.
3. Sync the winget MSI version and installer metadata:

   ```bash
   pnpm tools windows-install sync-oneworks \
     --version <version> \
    --winget-installer-url <windows-msi-url> \
    --winget-installer-sha256 <windows-msi-sha256>
   ```

4. Copy these templates into the matching `manifests/o/OneWorks/OneWorks/<version>/` path in a fork of `microsoft/winget-pkgs`, then validate and submit the PR.

The Scoop bucket remains ZIP-only and can be released before the winget PR is accepted.
