import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  assertStableVersion,
  buildWindowsAssetNames,
  shouldBuildStableWindowsAsset
} from '../stable-windows-release.mjs'

describe('stable Windows release asset', () => {
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

  it('preserves mixed npm failures after producing any available stable Windows asset', async () => {
    const workflow = await readFile('.github/workflows/npm-publish-alpha.yml', 'utf8')

    expect(workflow).toContain('id: npm_publish\n        continue-on-error: true')
    expect(workflow).toContain("steps.npm_publish.outcome != 'skipped'")
    expect(workflow).toContain("steps.npm_publish.outcome == 'failure'")
    expect(workflow).toContain('name: Preserve npm publish failure')
  })
})
