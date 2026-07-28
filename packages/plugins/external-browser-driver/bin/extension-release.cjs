const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const pluginRoot = resolve(__dirname, '..')
const packageManifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))

const chromeStageOffsets = {
  alpha: 10_000,
  beta: 20_000,
  rc: 30_000
}

const extensionIcons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png'
}

const baseReleasePermissionPolicy = {
  content_script_matches: ['http://127.0.0.1/*', 'http://localhost/*'],
  host_permissions: ['http://127.0.0.1/*'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  optional_permissions: [
    'bookmarks',
    'browsingData',
    'contentSettings',
    'cookies',
    'downloads',
    'downloads.open',
    'history',
    'management',
    'pageCapture',
    'privacy',
    'readingList',
    'scripting',
    'sessions',
    'system.display',
    'tabGroups',
    'tabs',
    'webNavigation'
  ],
  permissions: ['storage', 'alarms', 'activeTab']
}

const releasePermissionPolicy = {
  base: baseReleasePermissionPolicy,
  privileged: {
    ...baseReleasePermissionPolicy,
    permissions: [...baseReleasePermissionPolicy.permissions, 'debugger', 'proxy']
  }
}

const supportedReleaseFlavors = new Set(['base', 'privileged'])
const stableExtensionId = 'eiikbhfmjohfcldcmgjikafpmpbfipbi'
const publicExtensionName = 'OneWorks'
const extensionNames = {
  base: `${publicExtensionName} (Minimal)`,
  privileged: publicExtensionName
}

const extensionIdForKey = (key) => {
  const decoded = Buffer.from(key, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== key) {
    throw new Error('Extension public key must be canonical Base64')
  }
  const digest = createHash('sha256').update(decoded).digest('hex').slice(0, 32)
  return [...digest].map(character => String.fromCharCode(97 + Number.parseInt(character, 16))).join('')
}

const chromeVersionFor = (packageVersion) => {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/u.exec(
    packageVersion
  )
  if (match == null) {
    throw new Error(
      `Unsupported extension package version ${packageVersion}; expected x.y.z, x.y.z-alpha.n, x.y.z-beta.n, or x.y.z-rc.n`
    )
  }

  const [, majorValue, minorValue, patchValue, stage, sequenceValue] = match
  const core = [majorValue, minorValue, patchValue].map(value => Number(value))
  if (core.some(value => !Number.isSafeInteger(value) || value < 0 || value > 65_535)) {
    throw new Error(`Chrome extension version components must be integers between 0 and 65535: ${packageVersion}`)
  }

  let build = 65_535
  if (stage != null) {
    const sequence = Number(sequenceValue)
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 9_999) {
      throw new Error(`Chrome extension prerelease sequence must be between 0 and 9999: ${packageVersion}`)
    }
    build = chromeStageOffsets[stage] + sequence
  }

  return [...core, build].join('.')
}

const assertReleaseFlavor = (flavor) => {
  if (!supportedReleaseFlavors.has(flavor)) {
    throw new Error(`Release packages support only base or privileged flavor, received: ${flavor}`)
  }
  return flavor
}

const archiveFileName = (flavor, packageVersion = packageManifest.version) => {
  assertReleaseFlavor(flavor)
  const suffix = flavor === 'base' ? '-minimal' : ''
  return `oneworks-v${packageVersion}${suffix}.zip`
}

const materializedManifest = (template, packageVersion = packageManifest.version) => ({
  ...template,
  version: chromeVersionFor(packageVersion),
  version_name: packageVersion,
  icons: extensionIcons,
  action: {
    ...template.action,
    default_icon: {
      16: extensionIcons[16],
      32: extensionIcons[32]
    }
  }
})

module.exports = {
  archiveFileName,
  assertReleaseFlavor,
  chromeVersionFor,
  extensionNames,
  extensionIdForKey,
  extensionIcons,
  materializedManifest,
  packageManifest,
  pluginRoot,
  publicExtensionName,
  releasePermissionPolicy,
  stableExtensionId
}
