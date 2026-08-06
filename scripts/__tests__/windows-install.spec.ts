import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildDefaultScoopInstallerUrl,
  buildDefaultWingetInstallerUrl,
  buildInitialScoopManifest,
  buildWindowsPortableCommand,
  runWindowsInstallSyncOneWorks,
  runWindowsPortablePackage,
  updateScoopManifest,
  updateWingetInstallerTemplate,
  updateWingetPackageVersion
} from '../windows-install'
import installerIdentity from '../windows-installer-identity.cjs'

const { assertWingetInstallerTemplate, buildStableWindowsMsiProductCode } = installerIdentity

const buildWingetTemplate = (version: string, installerSha256 = 'a'.repeat(64)) =>
  [
    'PackageIdentifier: OneWorks.OneWorks',
    `PackageVersion: ${version}`,
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
    `    InstallerUrl: ${buildDefaultWingetInstallerUrl(version)}`,
    `    InstallerSha256: ${installerSha256}`,
    `    ProductCode: '${buildStableWindowsMsiProductCode(version)}'`,
    'ManifestType: installer',
    'ManifestVersion: 1.12.0',
    ''
  ].join('\n')

describe('windows install tooling', () => {
  it('keeps default Scoop ZIP and Winget MSI release asset urls separate', () => {
    expect(buildDefaultScoopInstallerUrl('1.2.3')).toBe(
      'https://github.com/oneworks-ai/app/releases/download/pkg/oneworks/v1.2.3/oneworks-windows-1.2.3.zip'
    )
    expect(buildDefaultWingetInstallerUrl('1.2.3')).toBe(
      'https://github.com/oneworks-ai/app/releases/download/pkg/oneworks/v1.2.3/oneworks-windows-1.2.3.msi'
    )
  })

  it('builds launchers pinned to the coordinated npm package version', () => {
    expect(buildWindowsPortableCommand('v1.2.3', 'oneworks')).toBe([
      '@echo off',
      'setlocal',
      'npx --yes --package "oneworks@1.2.3" oneworks %*',
      'exit /b %errorlevel%',
      ''
    ].join('\r\n'))
    expect(() => buildWindowsPortableCommand('1.2.3', 'unknown')).toThrow(
      'Unsupported One Works Windows command'
    )
  })

  it('packages all supported Windows command launchers', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'oneworks-windows-package-'))
    const result = await runWindowsPortablePackage({
      cwd,
      outDir: 'dist',
      version: '1.2.3',
      stdout: { write: () => true }
    })

    expect(result.commands.map(file => path.basename(file))).toEqual([
      'oneworks.cmd',
      'ow.cmd',
      'owo.cmd'
    ])
    await expect(readFile(path.join(cwd, 'dist', 'ow.cmd'), 'utf8')).resolves.toContain(
      'oneworks@1.2.3" ow %*'
    )
    await expect(readFile(path.join(cwd, 'dist', 'README.txt'), 'utf8')).resolves.toContain(
      'Requires Node.js 22 or newer'
    )
  })

  it('builds a complete first Scoop manifest', () => {
    const manifest = JSON.parse(buildInitialScoopManifest({
      version: '1.2.3',
      installerUrl: 'https://example.com/oneworks-windows-1.2.3.zip',
      installerSha256: 'a'.repeat(64)
    })) as Record<string, unknown>

    expect(manifest).toMatchObject({
      version: '1.2.3',
      url: 'https://example.com/oneworks-windows-1.2.3.zip',
      hash: 'a'.repeat(64),
      bin: ['oneworks.cmd', 'ow.cmd', 'owo.cmd'],
      depends: 'nodejs-lts'
    })
  })

  it('updates the Scoop manifest version, url, and hash', () => {
    const content = JSON.stringify({
      version: '1.0.1',
      url: 'https://registry.npmjs.org/oneworks/-/oneworks-1.0.1.tgz',
      hash: '0'.repeat(64),
      autoupdate: {
        url: 'https://registry.npmjs.org/oneworks/-/oneworks-$version.tgz'
      }
    })

    const manifest = JSON.parse(updateScoopManifest(content, {
      version: '1.2.3',
      installerUrl: 'https://example.com/oneworks-windows-1.2.3.zip',
      installerSha256: 'a'.repeat(64)
    })) as Record<string, unknown>

    expect(manifest).toMatchObject({
      version: '1.2.3',
      url: 'https://example.com/oneworks-windows-1.2.3.zip',
      hash: 'a'.repeat(64)
    })
  })

  it('updates the winget installer template', () => {
    const content = buildWingetTemplate('1.0.1', '0'.repeat(64))

    const result = updateWingetInstallerTemplate(content, {
      version: '1.2.3',
      installerUrl: buildDefaultWingetInstallerUrl('1.2.3'),
      installerSha256: 'b'.repeat(64)
    })

    expect(result).toContain('PackageVersion: 1.2.3')
    expect(result).toContain(`  InstallerUrl: ${buildDefaultWingetInstallerUrl('1.2.3')}`)
    expect(result).toContain(`  InstallerSha256: ${'b'.repeat(64)}`)
    expect(result).toContain(`ProductCode: '${buildStableWindowsMsiProductCode('1.2.3')}'`)
  })

  it('requires every static Winget MSI identity field and rejects portable regressions', () => {
    const version = '1.2.3'
    const validTemplate = buildWingetTemplate(version)
    expect(assertWingetInstallerTemplate(validTemplate, { version })).toMatchObject({
      installerUrl: buildDefaultWingetInstallerUrl(version),
      productCode: buildStableWindowsMsiProductCode(version)
    })

    for (
      const [needle, replacement] of [
        ['InstallerType: wix', 'InstallerType: zip'],
        ['PackageIdentifier: OneWorks.OneWorks', 'PackageIdentifier: Example.Wrong'],
        ['  - Windows.Desktop', '  - Windows.Universal'],
        ['MinimumOSVersion: 10.0.17763.0', 'MinimumOSVersion: 10.0.0.0'],
        ['  - Architecture: x64', '  - Architecture: arm64'],
        ['    Scope: machine', '    Scope: user'],
        [buildDefaultWingetInstallerUrl(version), 'https://example.invalid/oneworks.msi'],
        [buildStableWindowsMsiProductCode(version), '{00000000-0000-0000-0000-000000000000}'],
        ['  - oneworks', '  - oneworks-cli'],
        ['  - ow', '  - ow-cli'],
        ['  - owo', '  - owo-cli'],
        ['    - PackageIdentifier: OpenJS.NodeJS.LTS', '    - PackageIdentifier: OpenJS.NodeJS'],
        ['ManifestType: installer', 'ManifestType: defaultLocale'],
        ['ManifestVersion: 1.12.0', 'ManifestVersion: 1.10.0'],
        [`InstallerSha256: ${'a'.repeat(64)}`, `InstallerSha256: ${'A'.repeat(64)}`]
      ]
    ) {
      expect(() => assertWingetInstallerTemplate(validTemplate.replace(needle, replacement), { version })).toThrow()
    }
    for (
      const portableField of [
        'NestedInstallerType: portable',
        'NestedInstallerFiles: []',
        'PortableCommandAlias: oneworks'
      ]
    ) {
      expect(() => assertWingetInstallerTemplate(`${validTemplate}${portableField}\n`, { version })).toThrow()
    }
  })

  it('rejects duplicate identity keys and accepts optional dependencies', () => {
    const version = '1.2.3'
    const validTemplate = buildWingetTemplate(version)
    const withOptionalDependency = validTemplate.replace(
      '    - PackageIdentifier: OpenJS.NodeJS.LTS',
      '    - PackageIdentifier: OpenJS.NodeJS.LTS\n    - PackageIdentifier: Example.Optional'
    )
    expect(() => assertWingetInstallerTemplate(withOptionalDependency, { version })).not.toThrow()

    for (
      const [key, wrongValue] of [
        ['PackageIdentifier', 'Example.Wrong'],
        ['PackageVersion', '9.9.9'],
        ['InstallerType', 'zip'],
        ['MinimumOSVersion', '10.0.0.0'],
        ['ManifestType', 'defaultLocale'],
        ['ManifestVersion', '1.10.0'],
        ['InstallerSha256', 'b'.repeat(64)],
        ['Scope', 'user'],
        ['InstallerUrl', 'https://example.invalid/oneworks.msi'],
        ['ProductCode', "'{00000000-0000-0000-0000-000000000000}'"]
      ]
    ) {
      expect(() => assertWingetInstallerTemplate(`${validTemplate}${key}: ${wrongValue}\n`, { version })).toThrow()
    }
    expect(() => assertWingetInstallerTemplate(`${validTemplate}  - Architecture: arm64\n`, { version })).toThrow()
  })

  it('requires exactly the supported Winget command set', () => {
    const version = '1.2.3'
    const validTemplate = buildWingetTemplate(version)
    for (
      const replacement of [
        '  - oneworks\n  - ow',
        '  - oneworks\n  - ow\n  - owo\n  - extra',
        '  - oneworks\n  - ow\n  - ow',
        '    - oneworks\n  - ow\n  - owo'
      ]
    ) {
      expect(() =>
        assertWingetInstallerTemplate(
          validTemplate.replace('  - oneworks\n  - ow\n  - owo', replacement),
          { version }
        )
      ).toThrow()
    }
    expect(() => assertWingetInstallerTemplate(`${validTemplate}Commands:\n`, { version })).toThrow()
  })

  it('keeps Scoop ZIP verification and Winget MSI verification independent during sync', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'oneworks-windows-sync-'))
    const version = '1.2.3'
    const templatePath = path.join(cwd, 'installer.yaml')
    const versionPath = path.join(cwd, 'version.yaml')
    const localePath = path.join(cwd, 'locale.yaml')
    await Promise.all([
      writeFile(templatePath, buildWingetTemplate(version)),
      writeFile(versionPath, `PackageVersion: ${version}\n`),
      writeFile(localePath, `PackageVersion: ${version}\n`)
    ])
    const scoopSha256 = 'c'.repeat(64)
    const wingetSha256 = 'd'.repeat(64)
    const urls: string[] = []
    const result = await runWindowsInstallSyncOneWorks({
      cwd,
      dryRun: true,
      version,
      wingetInstallerUrl: buildDefaultWingetInstallerUrl(version),
      wingetInstallerSha256: wingetSha256,
      wingetTemplatePath: templatePath,
      wingetVersionManifestPath: versionPath,
      wingetLocaleManifestPath: localePath,
      stdout: { write: () => true },
      computeUrlSha256: async url => {
        urls.push(url)
        return url.endsWith('.zip') ? scoopSha256 : wingetSha256
      }
    })

    expect(urls).toEqual([buildDefaultScoopInstallerUrl(version), buildDefaultWingetInstallerUrl(version)])
    expect(result).toMatchObject({ scoopInstallerSha256: scoopSha256, wingetInstallerSha256: wingetSha256 })
    expect(result).not.toHaveProperty('installerSha256')
  })

  it('fails closed for Winget URL, SHA syntax, and downloaded MSI mismatch', async () => {
    const base = {
      cwd: await mkdtemp(path.join(tmpdir(), 'oneworks-windows-sync-reject-')),
      dryRun: true,
      version: '1.2.3',
      wingetInstallerUrl: buildDefaultWingetInstallerUrl('1.2.3'),
      wingetInstallerSha256: 'd'.repeat(64),
      computeUrlSha256: async () => 'c'.repeat(64),
      stdout: { write: () => true }
    }
    await expect(runWindowsInstallSyncOneWorks({ ...base, wingetInstallerUrl: 'https://example.invalid/file.msi' }))
      .rejects.toThrow('canonical MSI URL')
    await expect(runWindowsInstallSyncOneWorks({ ...base, wingetInstallerSha256: 'D'.repeat(64) })).rejects.toThrow(
      'lowercase hexadecimal'
    )
    await expect(runWindowsInstallSyncOneWorks(base)).rejects.toThrow('does not match downloaded MSI bytes')
  })

  it('updates winget package versions across manifest files', () => {
    expect(updateWingetPackageVersion(
      [
        'PackageIdentifier: OneWorks.OneWorks',
        'PackageVersion: 1.0.1',
        'ManifestType: version',
        ''
      ].join('\n'),
      'v1.2.3'
    )).toContain('PackageVersion: 1.2.3')
  })
})
