import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildDefaultWingetInstallerUrl,
  buildInitialScoopManifest,
  buildWindowsPortableCommand,
  runWindowsPortablePackage,
  updateScoopManifest,
  updateWingetInstallerTemplate,
  updateWingetPackageVersion
} from '../windows-install'

describe('windows install tooling', () => {
  it('builds the default winget release asset url', () => {
    expect(buildDefaultWingetInstallerUrl('1.2.3')).toBe(
      'https://github.com/oneworks-ai/app/releases/download/pkg/oneworks/v1.2.3/oneworks-windows-1.2.3.zip'
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
    const content = [
      'PackageIdentifier: OneWorks.OneWorks',
      'PackageVersion: 1.0.1',
      'Installers:',
      '- Architecture: x64',
      '  InstallerUrl: https://example.com/old.zip',
      `  InstallerSha256: ${'0'.repeat(64)}`,
      ''
    ].join('\n')

    const result = updateWingetInstallerTemplate(content, {
      version: '1.2.3',
      installerUrl: 'https://example.com/new.zip',
      installerSha256: 'b'.repeat(64)
    })

    expect(result).toContain('PackageVersion: 1.2.3')
    expect(result).toContain('  InstallerUrl: https://example.com/new.zip')
    expect(result).toContain(`  InstallerSha256: ${'b'.repeat(64)}`)
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
