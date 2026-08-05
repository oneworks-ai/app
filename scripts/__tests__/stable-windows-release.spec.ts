import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  STABLE_WINDOWS_MSI_UPGRADE_CODE,
  assertStableVersion,
  assertStableWindowsMsiReleaseIntegrity,
  assertStableWindowsMsiVersion,
  buildStableWindowsMsiAssetNames,
  buildStableWindowsMsiProductCode,
  buildStableWindowsMsiProvenance,
  buildStableWindowsMsiWxs,
  buildWindowsAssetNames,
  resolvePnpmInvocation,
  shouldBuildStableWindowsAsset
} from '../stable-windows-release.mjs'

describe('stable Windows release asset', () => {
  it('invokes the Windows pnpm command shim through cmd.exe', () => {
    expect(resolvePnpmInvocation('win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'pnpm.cmd']
    })
    expect(resolvePnpmInvocation('linux')).toEqual({ command: 'pnpm', prefixArgs: [] })
  })

  it('builds only when the stable plan contains the bootstrap package', () => {
    expect(shouldBuildStableWindowsAsset('', 'true')).toBe(true)
    expect(shouldBuildStableWindowsAsset('@oneworks/core, oneworks', 'false')).toBe(true)
    expect(shouldBuildStableWindowsAsset('@oneworks/core', 'false')).toBe(false)
  })

  it('rejects prerelease identities', () => {
    expect(assertStableVersion('0.1.0')).toBe('0.1.0')
    expect(() => assertStableVersion('0.1.0-rc.7')).toThrow('requires stable semver')
  })

  it('uses the immutable package tag and versioned asset names', () => {
    expect(buildWindowsAssetNames('0.1.0')).toEqual({
      archiveName: 'oneworks-windows-0.1.0.zip',
      checksumName: 'oneworks-windows-0.1.0.sha256',
      releaseTag: 'pkg/oneworks/v0.1.0'
    })
  })

  it('uses Windows Installer-compatible MSI identities with a stable upgrade code', () => {
    expect(assertStableWindowsMsiVersion('0.1.0')).toBe('0.1.0')
    expect(() => assertStableWindowsMsiVersion('256.0.0')).toThrow('outside Windows Installer limits')
    expect(buildStableWindowsMsiProductCode('0.1.0')).toMatch(
      /^\{[A-F0-9]{8}-[A-F0-9]{4}-5[A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}\}$/u
    )
    expect(buildStableWindowsMsiProductCode('0.1.0')).toBe(buildStableWindowsMsiProductCode('0.1.0'))
    expect(buildStableWindowsMsiProductCode('0.1.0')).not.toBe(buildStableWindowsMsiProductCode('0.1.1'))
    expect(STABLE_WINDOWS_MSI_UPGRADE_CODE).toMatch(/^\{[A-F0-9-]{36}\}$/u)
    expect(buildStableWindowsMsiAssetNames('0.1.0')).toEqual({
      checksumName: 'oneworks-windows-0.1.0.msi.sha256',
      installerName: 'oneworks-windows-0.1.0.msi',
      provenanceName: 'oneworks-windows-0.1.0.msi.provenance.json',
      releaseTag: 'pkg/oneworks/v0.1.0'
    })
  })

  it('authors a per-machine x64 MSI that appends and removes only the One Works PATH entry', () => {
    const wxs = buildStableWindowsMsiWxs({
      payloadDir: 'C:\\temp\\payload',
      productSourceSha: 'a'.repeat(40),
      version: '0.1.0'
    })

    expect(wxs).toContain('Scope="perMachine"')
    expect(wxs).toContain('<MajorUpgrade ')
    expect(wxs).toContain('ProductCode="')
    expect(wxs).toContain(`UpgradeCode="${STABLE_WINDOWS_MSI_UPGRADE_CODE}"`)
    expect(wxs).toContain('Id="ProgramFiles64Folder"')
    expect(wxs).toContain('Name="PATH"')
    expect(wxs).toContain('Action="set"')
    expect(wxs).toContain('Part="last"')
    expect(wxs).toContain('System="yes"')
    expect(wxs).not.toContain('Permanent="yes"')
    expect(wxs).toContain('Source="C:/temp/payload/oneworks.cmd"')
    expect(wxs).toContain('ProductSourceSha')
  })

  it('normalizes machine PATH segments while checking the MSI PATH lifecycle', async () => {
    const smoke = await readFile('scripts/stable-windows-msi-smoke.ps1', 'utf8')

    expect(smoke).toContain('function Normalize-DirectoryPath')
    expect(smoke).toContain('[System.IO.Path]::TrimEndingDirectorySeparator($Path)')
    expect(smoke).toContain("[Environment]::GetEnvironmentVariable('PATH', 'Machine')")
    expect(smoke).toContain('if (-not (Get-MachinePathSegments | Where-Object { $_ -ieq $installDir }))')
    expect(smoke).toContain('Machine PATH does not contain $installDir after install.')
    expect(smoke).toContain('if (Get-MachinePathSegments | Where-Object { $_ -ieq $installDir })')
    expect(smoke).toContain('Machine PATH still contains $installDir after uninstall.')
  })

  it('records the immutable product and builder identities in the MSI provenance', () => {
    expect(buildStableWindowsMsiProvenance({
      builderWorkflowSha: 'b'.repeat(40),
      installerName: 'oneworks-windows-0.1.0.msi',
      installerSha256: 'c'.repeat(64),
      launchers: { 'oneworks.cmd': 'd'.repeat(64) },
      productSourceSha: 'a'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })).toMatchObject({
      builderWorkflowSha: 'b'.repeat(40),
      installer: { name: 'oneworks-windows-0.1.0.msi', sha256: 'c'.repeat(64) },
      productSourceSha: 'a'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })
  })

  it('requires the checksum and provenance to match the released MSI bytes', () => {
    const installerSha256 = 'c'.repeat(64)
    const provenance = buildStableWindowsMsiProvenance({
      builderWorkflowSha: 'b'.repeat(40),
      installerName: 'oneworks-windows-0.1.0.msi',
      installerSha256,
      launchers: {},
      productSourceSha: 'a'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })
    const input = {
      checksum: `${installerSha256}  oneworks-windows-0.1.0.msi\n`,
      installerSha256,
      provenance,
      version: '0.1.0'
    }

    expect(() => assertStableWindowsMsiReleaseIntegrity(input)).not.toThrow()
    expect(() => assertStableWindowsMsiReleaseIntegrity({ ...input, installerSha256: 'd'.repeat(64) })).toThrow(
      'MSI checksum does not match'
    )
    expect(() =>
      assertStableWindowsMsiReleaseIntegrity({
        ...input,
        provenance: { ...provenance, installer: { ...provenance.installer, sha256: 'd'.repeat(64) } }
      })
    ).toThrow('MSI provenance does not match')
  })

  it('preserves mixed npm failures after producing any available stable Windows asset', async () => {
    const workflow = await readFile('.github/workflows/npm-publish-alpha.yml', 'utf8')

    expect(workflow).toContain('id: npm_publish\n        continue-on-error: true')
    expect(workflow).toContain("steps.npm_publish.outcome != 'skipped'")
    expect(workflow).toContain("steps.npm_publish.outcome == 'failure'")
    expect(workflow).toContain('name: Preserve npm publish failure')
  })

  it('keeps MSI construction on protected main with smoke and attestation gates', async () => {
    const workflow = await readFile('.github/workflows/stable-windows-msi-release.yml', 'utf8')

    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'')
    expect(workflow).toContain('runs-on: windows-2022')
    expect(workflow).toContain('dotnet tool install --tool-path $wixDir wix --version 4.0.5')
    expect(workflow).toContain('actions/attest@v4')
    expect(workflow).toContain('stable-windows-msi-smoke.ps1')
    expect(workflow).toContain('prepare-msi')
    expect(workflow).toContain('publish-msi')
  })
})
