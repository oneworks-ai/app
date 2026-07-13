#!/usr/bin/env node
const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const process = require('node:process')
const { unzipSync } = require('fflate')

const {
  assertReleaseFlavor,
  chromeVersionFor,
  extensionIdForKey,
  extensionIcons,
  packageManifest,
  releasePermissionPolicy,
  stableExtensionId
} = require('./extension-release.cjs')

const readArgument = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const fail = (message) => {
  throw new Error(`Invalid Chrome extension package: ${message}`)
}

const validateExactSet = (actual, expected, label) => {
  const actualValues = [...new Set(actual ?? [])].sort()
  const expectedValues = [...expected].sort()
  if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
    fail(`${label} must match the audited ${label} policy`)
  }
}

const parseJsonEntry = (entries, name) => {
  const value = entries[name]
  if (value == null) fail(`missing ${name} at the archive root`)
  try {
    return JSON.parse(Buffer.from(value).toString('utf8'))
  } catch (error) {
    fail(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const validatePngDimensions = (value, expectedSize, name) => {
  const bytes = Buffer.from(value)
  const pngSignature = '89504e470d0a1a0a'
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== pngSignature) {
    fail(`${name} is not a PNG`)
  }
  if (bytes.readUInt32BE(16) !== expectedSize || bytes.readUInt32BE(20) !== expectedSize) {
    fail(`${name} must be ${expectedSize}x${expectedSize}`)
  }
}

const validateExtensionArchive = ({ archivePath, flavor, packageVersion = packageManifest.version }) => {
  assertReleaseFlavor(flavor)
  const bytes = readFileSync(archivePath)
  const entries = unzipSync(new Uint8Array(bytes))
  const entryNames = Object.keys(entries).sort()
  if (entryNames.length === 0) fail('archive is empty')
  if (entryNames.some(name => name.startsWith('/') || name.includes('../') || name.includes('\\'))) {
    fail('archive contains an unsafe path')
  }
  if (entryNames.some(name => name.endsWith('.DS_Store') || name.includes('__MACOSX'))) {
    fail('archive contains platform metadata')
  }

  const manifest = parseJsonEntry(entries, 'manifest.json')
  const expectedVersion = chromeVersionFor(packageVersion)
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3')
  if (manifest.version !== expectedVersion) {
    fail(`manifest version ${String(manifest.version)} does not match ${expectedVersion}`)
  }
  if (manifest.version_name !== packageVersion) {
    fail(`manifest version_name ${String(manifest.version_name)} does not match ${packageVersion}`)
  }
  let extensionId
  try {
    extensionId = typeof manifest.key === 'string' ? extensionIdForKey(manifest.key) : undefined
  } catch {
    fail('stable extension key must be canonical Base64')
  }
  if (extensionId !== stableExtensionId) {
    fail(`stable extension identity must be ${stableExtensionId}`)
  }

  for (const [size, iconPath] of Object.entries(extensionIcons)) {
    if (manifest.icons?.[size] !== iconPath) fail(`manifest icon ${size} must reference ${iconPath}`)
    if (entries[iconPath] == null) fail(`missing ${iconPath}`)
    validatePngDimensions(entries[iconPath], Number(size), iconPath)
  }
  if (
    manifest.action?.default_icon?.['16'] !== extensionIcons[16] ||
    manifest.action?.default_icon?.['32'] !== extensionIcons[32]
  ) {
    fail('action.default_icon must reference the packaged 16px and 32px icons')
  }

  const permissions = new Set(manifest.permissions ?? [])
  const optionalPermissions = new Set(manifest.optional_permissions ?? [])
  const hostPermissions = new Set(manifest.host_permissions ?? [])
  const policy = releasePermissionPolicy[flavor]
  validateExactSet(manifest.permissions, policy.permissions, `${flavor} permissions`)
  validateExactSet(manifest.optional_permissions, policy.optional_permissions, `${flavor} optional_permissions`)
  validateExactSet(manifest.host_permissions, policy.host_permissions, `${flavor} host_permissions`)
  validateExactSet(
    manifest.optional_host_permissions,
    policy.optional_host_permissions,
    `${flavor} optional_host_permissions`
  )
  validateExactSet(
    (manifest.content_scripts ?? []).flatMap(contentScript => contentScript.matches ?? []),
    policy.content_script_matches,
    `${flavor} content script matches`
  )
  if (flavor === 'base') {
    if (manifest.name !== 'oneWorks External Browser (Minimal)') fail('base package has the wrong extension name')
    if (
      permissions.has('debugger') || permissions.has('proxy') ||
      optionalPermissions.has('debugger') || optionalPermissions.has('proxy')
    ) {
      fail('base package must not contain debugger or proxy permission')
    }
    if (hostPermissions.has('<all_urls>')) fail('base package must not contain an all-URLs host permission')
  } else {
    if (manifest.name !== 'oneWorks External Browser') {
      fail('privileged package has the wrong extension name')
    }
    if (!permissions.has('debugger') || !permissions.has('proxy')) {
      fail('privileged package must explicitly contain debugger and proxy permissions')
    }
  }

  if (/\(E2E\)/u.test(manifest.name ?? '') || hostPermissions.has('<all_urls>')) {
    fail('release package contains E2E-only manifest capabilities')
  }

  for (const required of ['background.js', 'content-script.js', 'cursor-runtime.js', 'popup.html', 'popup.js']) {
    if (entries[required] == null) fail(`missing runtime entry ${required}`)
  }

  return {
    archive: resolve(archivePath),
    entries: entryNames.length,
    extension_id: stableExtensionId,
    flavor,
    manifest_version: manifest.version,
    package_version: packageVersion,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

const main = () => {
  const archivePath = readArgument('--archive')
  const flavor = readArgument('--flavor')
  const packageVersion = readArgument('--package-version') ?? packageManifest.version
  if (!archivePath || !flavor) {
    throw new Error('Usage: validate-extension-package.cjs --archive <zip> --flavor <base|privileged>')
  }
  process.stdout.write(`${JSON.stringify(validateExtensionArchive({ archivePath, flavor, packageVersion }))}\n`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { validateExtensionArchive }
