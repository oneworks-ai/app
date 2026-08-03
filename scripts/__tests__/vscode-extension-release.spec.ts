import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import {
  assertVscodeStoreVersionAvailable,
  resolveMarketplaceVersion,
  resolvePersistedVsixCandidateAction
} from '../../apps/vscode-extension/scripts/release-identity.cjs'
import { assertVsixReleaseIdentity } from '../../apps/vscode-extension/scripts/verify-vsix.mjs'

const tag = (version: string) => `pkg/oneworks-vscode-extension/v${version}`

describe('vscode extension release identity', () => {
  it('maps prerelease and stable logical versions to stable numeric identities', () => {
    expect(resolveMarketplaceVersion('0.1.3-rc.7')).toBe('0.1.3')
    expect(resolveMarketplaceVersion('0.2.0')).toBe('0.2.0')
  })

  it('rejects a later RC that reuses the rc.4 numeric base', () => {
    expect(() =>
      assertVscodeStoreVersionAvailable(tag('0.1.2-rc.7'), [
        tag('0.1.2-rc.4')
      ])
    ).toThrow(/0\.1\.2.*rc\.4/u)
  })

  it('accepts a prerelease with a fresh newer numeric base', () => {
    expect(assertVscodeStoreVersionAvailable(tag('0.1.3-rc.7'), [
      tag('0.1.2-rc.4'),
      tag('0.1.2-rc.5'),
      tag('0.1.2-rc.6')
    ])).toEqual({
      logicalVersion: '0.1.3-rc.7',
      prerelease: true,
      storeVersion: '0.1.3',
      tag: tag('0.1.3-rc.7')
    })
  })

  it('accepts a stable 0.2.0 release identity', () => {
    expect(assertVscodeStoreVersionAvailable(tag('0.2.0'), [
      tag('0.1.3-rc.7')
    ])).toMatchObject({
      logicalVersion: '0.2.0',
      prerelease: false,
      storeVersion: '0.2.0'
    })
  })

  it('rejects an exact tag without persisted-candidate evidence when another tag owns its base', () => {
    expect(() =>
      assertVscodeStoreVersionAvailable(tag('0.1.3-rc.7'), [
        tag('0.1.3-beta.8'),
        tag('0.1.3-rc.7')
      ])
    ).toThrow(/already owned/u)
  })

  it('allows same-tag recovery only with persisted-candidate evidence', () => {
    expect(assertVscodeStoreVersionAvailable(tag('0.1.3-rc.7'), [
      tag('0.1.2-rc.4'),
      tag('0.1.3-beta.8'),
      tag('0.1.3-rc.7'),
      tag('0.1.4-rc.8')
    ], {
      recoveryEvidence: true
    })).toMatchObject({
      logicalVersion: '0.1.3-rc.7',
      storeVersion: '0.1.3'
    })
  })

  it('accepts a first clean publication when its tag is already present', () => {
    expect(assertVscodeStoreVersionAvailable(tag('0.1.3-rc.7'), [
      tag('0.1.3-rc.7')
    ])).toMatchObject({
      logicalVersion: '0.1.3-rc.7',
      storeVersion: '0.1.3'
    })
  })

  it('does not let recovery evidence bypass checks when the exact tag is absent', () => {
    expect(() =>
      assertVscodeStoreVersionAvailable(tag('0.1.3-rc.7'), [
        tag('0.1.3-beta.8')
      ], {
        recoveryEvidence: true
      })
    ).toThrow(/already owned/u)
  })

  it('rejects a cross-tag store version collision', () => {
    expect(() =>
      assertVscodeStoreVersionAvailable(tag('0.1.3-beta.8'), [
        tag('0.1.3-rc.7')
      ])
    ).toThrow(/already owned/u)
  })

  it('rejects a prerelease base older than the latest store version', () => {
    expect(() =>
      assertVscodeStoreVersionAvailable(tag('0.1.2-rc.8'), [
        tag('0.1.3-rc.7')
      ])
    ).toThrow(/must be newer/u)
  })

  it('asserts the packaged numeric manifest and prerelease marker', () => {
    expect(assertVsixReleaseIdentity({
      extensionManifest: JSON.stringify({ version: '0.1.3' }),
      sourceVersion: '0.1.3-rc.7',
      vsixManifest: '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" />'
    })).toEqual({
      prerelease: true,
      sourceVersion: '0.1.3-rc.7',
      storeVersion: '0.1.3'
    })

    expect(() =>
      assertVsixReleaseIdentity({
        extensionManifest: JSON.stringify({ version: '0.1.2' }),
        sourceVersion: '0.1.3-rc.7',
        vsixManifest: '<PackageManifest />'
      })
    ).toThrow(/manifest version/u)

    expect(() =>
      assertVsixReleaseIdentity({
        extensionManifest: JSON.stringify({ version: '0.1.3' }),
        sourceVersion: '0.1.3-rc.7',
        vsixManifest: '<PackageManifest />'
      })
    ).toThrow(/prerelease marker/u)
  })

  it('creates, uploads, or reuses the persisted GitHub Release candidate', () => {
    const input = {
      archiveFile: 'oneworks-vscode-extension-v0.1.3-rc.7.vsix',
      logicalVersion: '0.1.3-rc.7',
      tag: tag('0.1.3-rc.7')
    }

    expect(resolvePersistedVsixCandidateAction({
      ...input,
      release: null
    })).toBe('create')
    expect(resolvePersistedVsixCandidateAction({
      ...input,
      release: {
        assets: [],
        isDraft: false,
        isPrerelease: true,
        tagName: input.tag
      }
    })).toBe('upload')
    expect(resolvePersistedVsixCandidateAction({
      ...input,
      release: {
        assets: [{ name: input.archiveFile }],
        isDraft: false,
        isPrerelease: true,
        tagName: input.tag
      }
    })).toBe('reuse')
  })

  it('fails closed when persisted release metadata mismatches the logical release', () => {
    expect(() =>
      resolvePersistedVsixCandidateAction({
        archiveFile: 'oneworks-vscode-extension-v0.1.3-rc.7.vsix',
        logicalVersion: '0.1.3-rc.7',
        release: {
          assets: [],
          isDraft: false,
          isPrerelease: false,
          tagName: tag('0.1.3-rc.7')
        },
        tag: tag('0.1.3-rc.7')
      })
    ).toThrow(/prerelease=false/u)
  })

  it('binds direct-release recovery authorization to the persistence snapshot', () => {
    const repositoryRoot = process.cwd()
    const dollar = '$'
    const directReleaseWorkflow = readFileSync(
      join(repositoryRoot, '.github/workflows/vscode-extension-release.yml'),
      'utf8'
    )
    const releaseTagsWorkflow = readFileSync(
      join(repositoryRoot, '.github/workflows/release-tags.yml'),
      'utf8'
    )

    expect(directReleaseWorkflow).toContain(
      `group: vscode-extension-release-${dollar}{{ inputs.release_tag || github.ref_name }}`
    )
    expect(directReleaseWorkflow).toContain(
      `ref: refs/tags/${dollar}{{ inputs.release_tag || github.ref_name }}`
    )
    expect(directReleaseWorkflow).toContain(
      `ref: refs/tags/${dollar}{{ needs.build.outputs.release_tag }}`
    )
    expect(directReleaseWorkflow).toContain(`git rev-parse "refs/tags/${dollar}{TAG_NAME}^{commit}"`)
    expect(directReleaseWorkflow).toContain(`git rev-parse "refs/tags/${dollar}{RELEASE_TAG}^{commit}"`)
    const candidateIndex = directReleaseWorkflow.indexOf('name: Persist immutable VSIX candidate')
    const verifyIndex = directReleaseWorkflow.indexOf('name: Verify authoritative VSIX identity')
    const marketplaceIndex = directReleaseWorkflow.indexOf('name: Publish to VS Code Marketplace')
    const openVsxIndex = directReleaseWorkflow.indexOf('name: Publish to Open VSX Registry')
    expect(candidateIndex).toBeGreaterThan(0)
    expect(verifyIndex).toBeGreaterThan(candidateIndex)
    expect(marketplaceIndex).toBeGreaterThan(verifyIndex)
    expect(openVsxIndex).toBeGreaterThan(marketplaceIndex)
    const buildValidation = directReleaseWorkflow.slice(
      directReleaseWorkflow.indexOf('name: Validate release version'),
      directReleaseWorkflow.indexOf('name: Typecheck extension')
    )
    const candidateStep = directReleaseWorkflow.slice(candidateIndex, verifyIndex)
    const candidateActionIndex = candidateStep.indexOf('candidate_action=$(node')
    const guardIndex = candidateStep.indexOf(
      'node apps/vscode-extension/scripts/guard-store-version.mjs'
    )
    const persistenceCaseIndex = candidateStep.indexOf('case "$candidate_action" in')

    expect(buildValidation).not.toContain('gh release view')
    expect(buildValidation).not.toContain('guard-store-version.mjs')
    expect(buildValidation).not.toContain('--recovery-evidence')
    expect(directReleaseWorkflow.match(/gh release view "\$RELEASE_TAG"/gu)).toHaveLength(1)
    expect(candidateStep).toContain('--archive "$ARCHIVE_FILE"')
    expect(candidateStep).toContain('candidate_args+=(--release-json "$release_json")')
    expect(candidateStep).toContain('if [ "$candidate_action" = \'reuse\' ]; then')
    expect(candidateStep).toContain('guard_args+=(--recovery-evidence)')
    expect(candidateStep).toContain(
      `node apps/vscode-extension/scripts/guard-store-version.mjs "${dollar}{guard_args[@]}"`
    )
    expect(candidateActionIndex).toBeGreaterThan(0)
    expect(guardIndex).toBeGreaterThan(candidateActionIndex)
    expect(persistenceCaseIndex).toBeGreaterThan(guardIndex)
    expect(candidateStep.indexOf('gh release create')).toBeGreaterThan(persistenceCaseIndex)
    expect(candidateStep.indexOf('gh release upload')).toBeGreaterThan(persistenceCaseIndex)
    expect(candidateStep.indexOf('gh release download')).toBeGreaterThan(persistenceCaseIndex)
    expect(candidateStep).not.toContain('--clobber')
    expect(directReleaseWorkflow.match(/ARCHIVE_FILE: \$\{\{ steps\.candidate\.outputs\.archive \}\}/gu))
      .toHaveLength(3)
    expect(releaseTagsWorkflow).toContain('scripts/__tests__/release-tags.spec.ts')
    expect(releaseTagsWorkflow).toContain('scripts/__tests__/vscode-extension-release.spec.ts')
  })
})
