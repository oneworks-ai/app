const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')

const MSI_VERSION_LIMITS = [255, 255, 65535]
const PRODUCT_CODE_NAMESPACE = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')

const assertStableWindowsMsiVersion = version => {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`Windows stable asset requires stable semver, received: ${version}`)
  }
  const segments = version.split('.').map(Number)
  if (segments.some((segment, index) => segment > MSI_VERSION_LIMITS[index])) {
    throw new Error(`Windows MSI version is outside Windows Installer limits: ${version}`)
  }
  return version
}

const formatGuid = bytes => {
  const hex = bytes.toString('hex').toUpperCase()
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`
}

const buildStableWindowsMsiProductCode = version => {
  const stableVersion = assertStableWindowsMsiVersion(version)
  const digest = createHash('sha1')
    .update(PRODUCT_CODE_NAMESPACE)
    .update(`OneWorks.OneWorks:${stableVersion}`)
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6] & 0x0F) | 0x50
  digest[8] = (digest[8] & 0x3F) | 0x80
  return formatGuid(digest)
}

const WINGET_COMMANDS = ['oneworks', 'ow', 'owo']

const normalizeOneWorksVersion = version => {
  const normalized = version.replace(/^v/u, '')
  if (!/^\d+\.\d+\.\d+$/u.test(normalized)) throw new Error(`Invalid One Works version: ${version}`)
  return normalized
}

const buildCanonicalScoopInstallerUrl = version => (
  `https://github.com/oneworks-ai/app/releases/download/${`pkg/oneworks/v${
    normalizeOneWorksVersion(version)
  }`}/oneworks-windows-${normalizeOneWorksVersion(version)}.zip`
)

const buildCanonicalWingetInstallerUrl = version => (
  `https://github.com/oneworks-ai/app/releases/download/${`pkg/oneworks/v${
    normalizeOneWorksVersion(version)
  }`}/oneworks-windows-${normalizeOneWorksVersion(version)}.msi`
)

const normalizeLines = content => content.replace(/\r\n?/gu, '\n').split('\n')

const assertTopLevelSingleton = (lines, key, expected) => {
  const matches = lines.filter(line => line.startsWith(`${key}:`))
  if (matches.length !== 1 || matches[0] !== expected) {
    throw new Error(`Winget installer template must contain exactly one ${expected}.`)
  }
}

const assertInstallerSingleton = (lines, key, expected) => {
  const matches = lines.filter(line => new RegExp(`^\\s*${key}:`, 'u').test(line))
  if (matches.length !== 1 || matches[0] !== expected) {
    throw new Error(`Winget installer template must contain exactly one ${expected}.`)
  }
}

const assertArchitectureSingleton = lines => {
  const matches = lines.filter(line => /^\s*-\s*Architecture:/u.test(line))
  if (matches.length !== 1 || matches[0] !== '  - Architecture: x64') {
    throw new Error('Winget installer template must contain exactly one x64 installer.')
  }
}

const assertPlatform = lines => {
  const platformIndexes = lines.flatMap((line, index) => line === 'Platform:' ? [index] : [])
  if (platformIndexes.length !== 1) {
    throw new Error('Winget installer template must contain exactly one Platform block.')
  }
  const platformLines = []
  for (let index = platformIndexes[0] + 1; index < lines.length && !/^[^ ]/u.test(lines[index]); index += 1) {
    if (lines[index] !== '') platformLines.push(lines[index])
  }
  if (platformLines.length !== 1 || platformLines[0] !== '  - Windows.Desktop') {
    throw new Error('Winget Platform must contain only Windows.Desktop.')
  }
}

const assertInstallersHeader = lines => {
  if (lines.filter(line => line === 'Installers:').length !== 1) {
    throw new Error('Winget installer template must contain exactly one Installers header.')
  }
}

const assertCommands = lines => {
  const commandIndexes = lines.flatMap((line, index) => line === 'Commands:' ? [index] : [])
  if (commandIndexes.length !== 1) throw new Error('Winget installer template must contain exactly one Commands block.')
  const commandLines = []
  for (let index = commandIndexes[0] + 1; index < lines.length && !/^[^ ]/u.test(lines[index]); index += 1) {
    if (lines[index] !== '') commandLines.push(lines[index])
  }
  if (commandLines.some(line => !/^ {2}- \S.*$/u.test(line))) {
    throw new Error('Winget Commands entries must be two-space scalar values.')
  }
  const commands = commandLines.map(line => line.slice(4))
  if (commands.length !== WINGET_COMMANDS.length || new Set(commands).size !== commands.length) {
    throw new Error('Winget Commands must contain each required command exactly once.')
  }
  for (const command of WINGET_COMMANDS) {
    if (!commands.includes(command)) throw new Error('Winget Commands must contain each required command exactly once.')
  }
}

const assertWingetInstallerTemplate = (content, input) => {
  const version = normalizeOneWorksVersion(input.version)
  const installerUrl = buildCanonicalWingetInstallerUrl(version)
  const productCode = buildStableWindowsMsiProductCode(version)
  const lines = normalizeLines(content)
  const normalizedContent = lines.join('\n')
  assertTopLevelSingleton(lines, 'PackageIdentifier', 'PackageIdentifier: OneWorks.OneWorks')
  assertTopLevelSingleton(lines, 'PackageVersion', `PackageVersion: ${version}`)
  assertTopLevelSingleton(lines, 'InstallerType', 'InstallerType: wix')
  assertTopLevelSingleton(lines, 'MinimumOSVersion', 'MinimumOSVersion: 10.0.17763.0')
  assertTopLevelSingleton(lines, 'ManifestType', 'ManifestType: installer')
  assertTopLevelSingleton(lines, 'ManifestVersion', 'ManifestVersion: 1.12.0')
  assertPlatform(lines)
  assertInstallersHeader(lines)
  assertArchitectureSingleton(lines)
  assertInstallerSingleton(lines, 'Scope', '    Scope: machine')
  assertInstallerSingleton(lines, 'InstallerUrl', `    InstallerUrl: ${installerUrl}`)
  const shaLines = lines.filter(line => /^\s*InstallerSha256:/u.test(line))
  if (shaLines.length !== 1) throw new Error('Winget installer template must contain exactly one InstallerSha256.')
  const shaMatch = shaLines[0].match(/^ {4}InstallerSha256: ([a-f0-9]{64})$/u)
  if (shaMatch == null) throw new Error('Winget installer template must contain a lowercase InstallerSha256.')
  if (input.installerSha256 != null && shaMatch[1] !== input.installerSha256) {
    throw new Error('Winget installer template SHA-256 differs from the verified MSI.')
  }
  assertInstallerSingleton(lines, 'ProductCode', `    ProductCode: '${productCode}'`)
  assertCommands(lines)
  if (!normalizedContent.includes('    - PackageIdentifier: OpenJS.NodeJS.LTS')) {
    throw new Error('Winget installer template is missing Node LTS dependency.')
  }
  if (/NestedInstallerType|NestedInstallerFiles|PortableCommandAlias/u.test(normalizedContent)) {
    throw new Error('Winget installer template must not contain portable installer fields.')
  }
  return { installerSha256: shaMatch[1], installerUrl, productCode, version }
}

module.exports = {
  WINGET_COMMANDS,
  assertStableWindowsMsiVersion,
  assertWingetInstallerTemplate,
  buildCanonicalScoopInstallerUrl,
  buildCanonicalWingetInstallerUrl,
  buildStableWindowsMsiProductCode
}
