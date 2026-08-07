import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import {
  evaluateStablePackageGraph,
  runStableReleasePreflight,
  validateStableWingetInstallerTemplate
} from '../stable-release-preflight.mjs'
import installerIdentity from '../windows-installer-identity.cjs'

const { buildCanonicalWingetInstallerUrl, buildStableWindowsMsiProductCode } = installerIdentity

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
  const input = { version: '1.0.0' }

  it('accepts one coordinated stable graph including VS Code', () => {
    expect(evaluateStablePackageGraph(input, [
      { name: 'oneworks-dev', version: '1.0.0', license: 'MIT' },
      { name: '@oneworks/core', version: '1.0.0', license: 'MIT' },
      { name: '@oneworks/vscode-extension', version: '1.0.0', license: 'MIT' },
      {
        name: '@oneworks/plugin-demo',
        version: '1.0.0',
        license: 'MIT',
        pluginVersion: '1.0.0'
      }
    ])).toEqual([])
  })

  it('uses one coordinated version input in every stable workflow caller', async () => {
    const repositoryRoot = process.cwd()
    const workflowPaths = [
      '.github/workflows/npm-publish-alpha.yml',
      '.github/workflows/release-tags.yml'
    ]

    for (const workflowPath of workflowPaths) {
      const workflow = readFileSync(join(repositoryRoot, workflowPath), 'utf8')
      expect(workflow).toContain('--version "$version"')
      expect(workflow).not.toContain('--vscode-version')
    }
    await expect(
      runStableReleasePreflight(['--version', '1.0.0', '--vscode-version', '1.0.0'])
    ).rejects.toThrow(/Unknown stable release preflight argument/u)
  })

  it('rejects prerelease, license, and plugin identity drift', () => {
    const errors = evaluateStablePackageGraph(input, [
      { name: '@oneworks/core', version: '1.0.0-rc.0', license: undefined },
      {
        name: '@oneworks/plugin-demo',
        version: '1.0.0',
        license: 'MIT',
        pluginVersion: '1.0.0-rc.0'
      }
    ])

    expect(errors).toEqual([
      '@oneworks/core has version 1.0.0-rc.0; expected 1.0.0',
      '@oneworks/core must declare license MIT',
      '@oneworks/plugin-demo plugin.json version 1.0.0-rc.0 does not match 1.0.0'
    ])
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
