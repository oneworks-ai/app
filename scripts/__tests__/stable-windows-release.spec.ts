import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  STABLE_WINDOWS_MSI_UPGRADE_CODE,
  assertStableVersion,
  assertStableWindowsMsiReleaseIntegrity,
  assertStableWindowsMsiReuseIntegrity,
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

  it('normalizes published installer and validates the MSI launcher lifecycle', async () => {
    const smoke = await readFile('scripts/stable-windows-msi-smoke.ps1', 'utf8')
    const workflow = await readFile('.github/workflows/stable-windows-msi-release.yml', 'utf8')

    expect(smoke).toContain('$Installer = [System.IO.Path]::GetFullPath($Installer)')
    expect(smoke).toContain('function Normalize-DirectoryPath')
    expect(smoke).toContain('[System.IO.Path]::TrimEndingDirectorySeparator($Path)')
    expect(smoke).toContain("[Environment]::GetEnvironmentVariable('PATH', 'Machine')")
    expect(smoke).toContain('if (-not (Get-MachinePathSegments | Where-Object { $_ -ieq $installDir }))')
    expect(smoke).toContain('Machine PATH does not contain $installDir after install.')
    expect(smoke).toContain('if (Get-MachinePathSegments | Where-Object { $_ -ieq $installDir })')
    expect(smoke).toContain('Machine PATH still contains $installDir after uninstall.')
    expect(smoke).toContain('[string]`$ExpectedVersion')
    expect(smoke).toContain("@('oneworks.cmd', 'ow.cmd', 'owo.cmd')")
    expect(smoke).toContain("(Join-Path '$installDir' `$command) --version")
    expect(smoke).toContain('`$versionOutput -cne `$ExpectedVersion')
    expect(smoke).toContain('-ExpectedVersion $Version')
    expect(workflow.match(/stable-windows-msi-smoke\.ps1/gu)).toHaveLength(2)
  })

  it('records the immutable product and builder identities in the MSI provenance', () => {
    const provenance = buildStableWindowsMsiProvenance({
      builderWorkflowSha: 'b'.repeat(40),
      installerName: 'oneworks-windows-0.1.0.msi',
      installerSha256: 'c'.repeat(64),
      launchers: { 'oneworks.cmd': 'd'.repeat(64) },
      productSourceSha: 'a'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })

    expect(provenance).toMatchObject({
      builderWorkflowSha: 'b'.repeat(40),
      installer: { name: 'oneworks-windows-0.1.0.msi', sha256: 'c'.repeat(64) },
      productSourceSha: 'a'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })
    expect(provenance).not.toHaveProperty('validatorWorkflowSha')
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

  it('accepts an immutable MSI built by an ancestor of its validator', () => {
    const builderWorkflowSha = 'a'.repeat(40)
    const validatorWorkflowSha = 'b'.repeat(40)
    const installerSha256 = 'c'.repeat(64)
    const calls: string[][] = []
    const provenance = buildStableWindowsMsiProvenance({
      builderWorkflowSha,
      installerName: 'oneworks-windows-0.1.0.msi',
      installerSha256,
      launchers: {},
      productSourceSha: 'd'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })

    expect(assertStableWindowsMsiReuseIntegrity({
      checksum: `${installerSha256}  oneworks-windows-0.1.0.msi\n`,
      installerSha256,
      productSourceSha: 'd'.repeat(40),
      provenance,
      releaseTag: 'pkg/oneworks/v0.1.0',
      validatorWorkflowSha,
      version: '0.1.0'
    }, (command, args) => {
      expect(command).toBe('git')
      calls.push(args)
      return ''
    })).toEqual({ builderWorkflowSha, validatorWorkflowSha })
    expect(calls).toEqual([
      ['cat-file', '-e', `${builderWorkflowSha}^{commit}`],
      ['cat-file', '-e', `${validatorWorkflowSha}^{commit}`],
      ['merge-base', '--is-ancestor', builderWorkflowSha, validatorWorkflowSha]
    ])
  })

  it('fails closed when immutable MSI reuse lineage or identity is invalid', () => {
    const builderWorkflowSha = 'a'.repeat(40)
    const validatorWorkflowSha = 'b'.repeat(40)
    const installerSha256 = 'c'.repeat(64)
    const provenance = buildStableWindowsMsiProvenance({
      builderWorkflowSha,
      installerName: 'oneworks-windows-0.1.0.msi',
      installerSha256,
      launchers: {},
      productSourceSha: 'd'.repeat(40),
      releaseTag: 'pkg/oneworks/v0.1.0',
      version: '0.1.0'
    })
    const input = {
      checksum: `${installerSha256}  oneworks-windows-0.1.0.msi\n`,
      installerSha256,
      productSourceSha: 'd'.repeat(40),
      provenance,
      releaseTag: 'pkg/oneworks/v0.1.0',
      validatorWorkflowSha,
      version: '0.1.0'
    }

    expect(() => assertStableWindowsMsiReuseIntegrity({ ...input, validatorWorkflowSha: 'invalid' })).toThrow(
      'VALIDATOR_WORKFLOW_SHA must be a full lowercase Git commit SHA'
    )
    expect(() =>
      assertStableWindowsMsiReuseIntegrity({
        ...input,
        provenance: { ...provenance, builderWorkflowSha: '' }
      })
    ).toThrow('Existing MSI builderWorkflowSha must be a full lowercase Git commit SHA')
    expect(() => assertStableWindowsMsiReuseIntegrity({ ...input, releaseTag: 'pkg/oneworks/v0.1.1' })).toThrow(
      'Unexpected MSI release tag'
    )
    expect(() =>
      assertStableWindowsMsiReuseIntegrity({
        ...input,
        provenance: { ...provenance, releaseTag: 'pkg/oneworks/v0.1.1' }
      })
    ).toThrow('Existing MSI provenance differs for releaseTag.')
    expect(() =>
      assertStableWindowsMsiReuseIntegrity({
        ...input,
        provenance: { ...provenance, releaseTag: 'pkg/oneworks/v0.1.1' },
        releaseTag: 'pkg/oneworks/v0.1.1',
        version: '0.1.1'
      })
    ).toThrow('differs for version')
    expect(() => assertStableWindowsMsiReuseIntegrity({ ...input, provenance: { ...provenance, schemaVersion: 2 } }))
      .toThrow('schema version 1')
    expect(() => assertStableWindowsMsiReuseIntegrity({ ...input, productSourceSha: 'e'.repeat(40) })).toThrow(
      'productSourceSha'
    )
    expect(() =>
      assertStableWindowsMsiReuseIntegrity({
        ...input,
        provenance: { ...provenance, productCode: buildStableWindowsMsiProductCode('0.1.1') }
      })
    ).toThrow('productCode')
    expect(() => assertStableWindowsMsiReuseIntegrity({ ...input, installerSha256: 'e'.repeat(64) })).toThrow(
      'MSI checksum does not match'
    )
    expect(() =>
      assertStableWindowsMsiReuseIntegrity({
        ...input,
        provenance: { ...provenance, installer: { ...provenance.installer, name: 'other.msi' } }
      })
    ).toThrow('MSI provenance does not match')
    expect(() =>
      assertStableWindowsMsiReuseIntegrity(input, () => {
        throw new Error('missing commit')
      })
    ).toThrow('missing commit')
    expect(() =>
      assertStableWindowsMsiReuseIntegrity(input, (_command, args) => {
        if (args[2] === `${validatorWorkflowSha}^{commit}`) throw new Error('missing validator commit')
        return ''
      })
    ).toThrow('missing validator commit')
    expect(() =>
      assertStableWindowsMsiReuseIntegrity(input, (_command, args) => {
        if (args[0] === 'merge-base') throw new Error('not an ancestor')
        return ''
      })
    ).toThrow('not an ancestor')
  })

  it('gates stable Windows assets on complete npm publication and reconciliation', async () => {
    const workflow = await readFile('.github/workflows/npm-publish-alpha.yml', 'utf8')

    expect(workflow).toContain('id: npm_publish\n        continue-on-error: true')
    expect(workflow).toContain('id: npm_postflight\n        if: $' + '{{ always() && !inputs.dry_run }}')
    expect(workflow).toContain(
      "!inputs.dry_run && inputs.publish_tag == 'latest' && steps.npm_publish.outcome == 'success' && steps.npm_postflight.outcome == 'success'"
    )
    expect(workflow).toContain("steps.npm_publish.outcome == 'failure' || steps.npm_postflight.outcome == 'failure'")
    expect(workflow).toContain('name: Preserve npm publish failure')
  })

  it('keeps MSI construction on protected main with smoke and attestation gates', async () => {
    const workflow = await readFile('.github/workflows/stable-windows-msi-release.yml', 'utf8')

    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'')
    expect(workflow).toContain('runs-on: windows-2022')
    expect(workflow).toContain('dotnet tool install --tool-path $wixDir wix --version 4.0.5')
    expect(workflow).toContain('actions/attest@v4')
    expect(workflow).toContain('VALIDATOR_WORKFLOW_SHA: $' + '{{ github.workflow_sha }}')
    expect(workflow).toContain('BUILDER_WORKFLOW_SHA: $' + '{{ github.workflow_sha }}')
    expect(workflow).toContain('git merge-base --is-ancestor "$VALIDATOR_WORKFLOW_SHA" "$GITHUB_SHA"')
    expect(workflow).toContain('if: $' + "{{ steps.existing.outputs.should_build == 'false' }}")
    expect(workflow).toContain(
      'ASSET_BUILDER_WORKFLOW_SHA: $' + '{{ steps.existing.outputs.asset_builder_workflow_sha }}'
    )
    expect(workflow).toContain('VALIDATOR_WORKFLOW_SHA: $' + '{{ steps.existing.outputs.validator_workflow_sha }}')
    expect(workflow).toContain('Recorded asset builder workflow SHA')
    expect(workflow).toContain('Validator workflow SHA')
    expect(workflow).toContain('stable-windows-msi-smoke.ps1')
    expect(workflow).toContain('prepare-msi')
    expect(workflow).toContain('publish-msi')
  })
})
