import { buildStableWindowsMsiProductCode } from './stable-windows-release.mjs'

export const WINGET_COMMANDS = ['oneworks', 'ow', 'owo']

const normalizeOneWorksVersion = version => {
  const normalized = version.replace(/^v/u, '')
  if (!/^\d+\.\d+\.\d+$/u.test(normalized)) throw new Error(`Invalid One Works version: ${version}`)
  return normalized
}

export const buildCanonicalScoopInstallerUrl = version => (
  `https://github.com/oneworks-ai/app/releases/download/${`pkg/oneworks/v${
    normalizeOneWorksVersion(version)
  }`}/oneworks-windows-${normalizeOneWorksVersion(version)}.zip`
)

export const buildCanonicalWingetInstallerUrl = version => (
  `https://github.com/oneworks-ai/app/releases/download/${`pkg/oneworks/v${
    normalizeOneWorksVersion(version)
  }`}/oneworks-windows-${normalizeOneWorksVersion(version)}.msi`
)

const assertContains = (content, expected, field) => {
  if (!content.includes(expected)) throw new Error(`Winget installer template is missing ${field}.`)
}

const assertExactLine = (content, expected, field) => {
  const matches = content.match(new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'gmu'))
  if (matches?.length !== 1) throw new Error(`Winget installer template must contain exactly one ${field}.`)
}

export const assertWingetInstallerTemplate = (content, input) => {
  const version = normalizeOneWorksVersion(input.version)
  const installerUrl = buildCanonicalWingetInstallerUrl(version)
  const productCode = buildStableWindowsMsiProductCode(version)
  const shaMatch = content.match(/^ {4}InstallerSha256: ([a-f0-9]{64})$/mu)
  if (shaMatch == null) throw new Error('Winget installer template must contain a lowercase InstallerSha256.')
  if (input.installerSha256 != null && shaMatch[1] !== input.installerSha256) {
    throw new Error('Winget installer template SHA-256 differs from the verified MSI.')
  }
  for (
    const [expected, field] of [
      ['PackageIdentifier: OneWorks.OneWorks', 'PackageIdentifier'],
      ['InstallerType: wix', 'InstallerType: wix'],
      [`PackageVersion: ${version}`, 'PackageVersion'],
      ['Platform:\n  - Windows.Desktop', 'Windows.Desktop platform'],
      ['MinimumOSVersion: 10.0.17763.0', 'MinimumOSVersion'],
      ['Installers:\n  - Architecture: x64', 'a sole x64 installer'],
      ['    Scope: machine', 'Scope: machine'],
      [`    InstallerUrl: ${installerUrl}`, 'canonical MSI InstallerUrl'],
      [`    ProductCode: '${productCode}'`, 'quoted MSI ProductCode'],
      ['Commands:', 'Commands'],
      ['  - oneworks', 'oneworks command'],
      ['  - ow', 'ow command'],
      ['  - owo', 'owo command'],
      ['    - PackageIdentifier: OpenJS.NodeJS.LTS', 'Node LTS dependency'],
      ['ManifestType: installer', 'installer ManifestType'],
      ['ManifestVersion: 1.12.0', 'ManifestVersion']
    ]
  ) assertContains(content, expected, field)
  for (
    const [expected, field] of [
      ['PackageIdentifier: OneWorks.OneWorks', 'PackageIdentifier'],
      ['InstallerType: wix', 'InstallerType: wix'],
      [`PackageVersion: ${version}`, 'PackageVersion'],
      ['  - Windows.Desktop', 'Windows.Desktop platform'],
      ['MinimumOSVersion: 10.0.17763.0', 'MinimumOSVersion'],
      ['  - Architecture: x64', 'x64 installer'],
      ['    Scope: machine', 'Scope: machine'],
      [`    InstallerUrl: ${installerUrl}`, 'canonical MSI InstallerUrl'],
      [`    ProductCode: '${productCode}'`, 'quoted MSI ProductCode'],
      ['  - oneworks', 'oneworks command'],
      ['  - ow', 'ow command'],
      ['  - owo', 'owo command'],
      ['    - PackageIdentifier: OpenJS.NodeJS.LTS', 'Node LTS dependency'],
      ['ManifestType: installer', 'installer ManifestType'],
      ['ManifestVersion: 1.12.0', 'ManifestVersion']
    ]
  ) assertExactLine(content, expected, field)
  if ((content.match(/^ {2}- Architecture:/gmu) ?? []).length !== 1) {
    throw new Error('Winget installer template must contain exactly one installer entry.')
  }
  if (/NestedInstallerType|NestedInstallerFiles|PortableCommandAlias/u.test(content)) {
    throw new Error('Winget installer template must not contain portable installer fields.')
  }
  return { installerSha256: shaMatch[1], installerUrl, productCode, version }
}
