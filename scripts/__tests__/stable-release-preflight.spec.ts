import { describe, expect, it } from 'vitest'

import {
  evaluateStablePackageGraph,
  runStableReleasePreflight,
  validateStableWingetInstallerTemplate
} from '../stable-release-preflight.mjs'
import { buildStableWindowsMsiProductCode } from '../stable-windows-release.mjs'
import { buildCanonicalWingetInstallerUrl } from '../windows-installer-identity.mjs'

const buildWingetTemplate = (version: string, installerSha256 = 'a'.repeat(64)) =>
  [
    `PackageVersion: ${version}`,
    'PackageIdentifier: OneWorks.OneWorks',
    'Platform:',
    '  - Windows.Desktop',
    'MinimumOSVersion: 10.0.17763.0',
    'InstallerType: wix',
    'Commands:',
    '  - oneworks',
    '  - ow',
    '  - owo',
    'Dependencies:',
    '  PackageDependencies:',
    '    - PackageIdentifier: OpenJS.NodeJS.LTS',
    'Installers:',
    '  - Architecture: x64',
    '    Scope: machine',
    `    InstallerUrl: ${buildCanonicalWingetInstallerUrl(version)}`,
    `    InstallerSha256: ${installerSha256}`,
    `    ProductCode: '${buildStableWindowsMsiProductCode(version)}'`,
    'ManifestType: installer',
    'ManifestVersion: 1.12.0',
    ''
  ].join('\n')

describe('stable release preflight', () => {
  const input = { version: '0.1.0', vscodeVersion: '0.1.4' }

  it('accepts a coordinated stable graph with the VS Code store exception', () => {
    expect(evaluateStablePackageGraph(input, [
      { name: 'oneworks-dev', version: '0.1.0', license: 'MIT' },
      { name: '@oneworks/core', version: '0.1.0', license: 'MIT' },
      { name: '@oneworks/vscode-extension', version: '0.1.4', license: 'MIT' },
      {
        name: '@oneworks/plugin-demo',
        version: '0.1.0',
        license: 'MIT',
        pluginVersion: '0.1.0'
      }
    ])).toEqual([])
  })

  it('rejects prerelease, license, and plugin identity drift', () => {
    const errors = evaluateStablePackageGraph(input, [
      { name: '@oneworks/core', version: '0.1.0-rc.7', license: undefined },
      {
        name: '@oneworks/plugin-demo',
        version: '0.1.0',
        license: 'MIT',
        pluginVersion: '0.1.0-rc.7'
      }
    ])

    expect(errors).toEqual([
      '@oneworks/core has version 0.1.0-rc.7; expected 0.1.0',
      '@oneworks/core must declare license MIT',
      '@oneworks/plugin-demo plugin.json version 0.1.0-rc.7 does not match 0.1.0'
    ])
  })

  it('accepts the current repository Winget MSI identity', async () => {
    await expect(runStableReleasePreflight(['--version', '0.1.0', '--vscode-version', '0.1.4'])).resolves.toMatchObject(
      {
        ok: true
      }
    )
  })

  it('validates future stable MSI template shapes without a checksum map', () => {
    const version = '7.8.9'
    const template = buildWingetTemplate(version, 'b'.repeat(64))
    expect(validateStableWingetInstallerTemplate(template, version)).toEqual([])
    expect(validateStableWingetInstallerTemplate(template.replace('Scope: machine', 'Scope: user'), version)).not
      .toEqual([])
    expect(validateStableWingetInstallerTemplate(template.replace('InstallerType: wix', 'InstallerType: zip'), version))
      .not.toEqual([])
    expect(validateStableWingetInstallerTemplate(`${template}PortableCommandAlias: oneworks\n`, version)).not.toEqual(
      []
    )
  })
})
