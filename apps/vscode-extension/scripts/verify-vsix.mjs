import vsceZip from '@vscode/vsce/out/zip.js'

import { isPrereleaseVersion, resolveMarketplaceVersion } from './release-manifest.mjs'

const propertyPattern = /<Property [^>]*>/gu
const vsixIdentityEntries = new Set([
  'extension/package.json',
  'extension.vsixmanifest'
])
const { readZip } = vsceZip

export function assertVsixReleaseIdentity(input) {
  const manifest = JSON.parse(input.extensionManifest)
  const expectedStoreVersion = resolveMarketplaceVersion(input.sourceVersion)

  if (manifest.version !== expectedStoreVersion) {
    throw new Error(
      `VSIX manifest version ${String(manifest.version)} does not match expected store version ${expectedStoreVersion}.`
    )
  }

  const hasPrereleaseMarker = [...input.vsixManifest.matchAll(propertyPattern)]
    .some(([property]) => (
      property.includes('Id="Microsoft.VisualStudio.Code.PreRelease"') &&
      property.includes('Value="true"')
    ))
  const expectedPrereleaseMarker = isPrereleaseVersion(input.sourceVersion)
  if (hasPrereleaseMarker !== expectedPrereleaseMarker) {
    throw new Error(
      `VSIX prerelease marker is ${hasPrereleaseMarker ? 'enabled' : 'missing'} for logical version ` +
        `${input.sourceVersion}; expected ${expectedPrereleaseMarker ? 'enabled' : 'absent'}.`
    )
  }

  return {
    prerelease: hasPrereleaseMarker,
    sourceVersion: input.sourceVersion,
    storeVersion: expectedStoreVersion
  }
}

export async function verifyVsixFile(packagePath, sourceVersion) {
  const entries = await readZip(packagePath, entryPath => vsixIdentityEntries.has(entryPath))
  const extensionManifest = readArchiveEntry(entries, 'extension/package.json')
  const vsixManifest = readArchiveEntry(entries, 'extension.vsixmanifest')
  return assertVsixReleaseIdentity({
    extensionManifest,
    sourceVersion,
    vsixManifest
  })
}

function readArchiveEntry(entries, entryPath) {
  const entry = entries.get(entryPath)
  if (entry == null) {
    throw new Error(`VSIX archive is missing ${entryPath}.`)
  }
  return entry.toString('utf8')
}
