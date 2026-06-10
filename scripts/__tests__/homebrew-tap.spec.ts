import { describe, expect, it } from 'vitest'

import {
  ONEWORKS_CLI_PACKAGE_NAME,
  buildOneWorksCliTarballUrl,
  buildOneWorksTarballUrl,
  buildPackageReleaseTag,
  normalizeOneWorksCliVersion,
  normalizeOneWorksVersion
} from '../cli-package-release'
import { updateOneWorksFormula } from '../homebrew-tap'

describe('homebrew tap tooling', () => {
  it('builds the npm tarball url for the oneworks package', () => {
    expect(buildOneWorksTarballUrl('1.2.3')).toBe('https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz')
  })

  it('normalizes a tagged version', () => {
    expect(normalizeOneWorksVersion('v1.2.3')).toBe('1.2.3')
  })

  it('normalizes a package release tag version', () => {
    expect(normalizeOneWorksVersion('pkg/oneworks/v1.2.3')).toBe('1.2.3')
  })

  it('builds a package release tag', () => {
    expect(buildPackageReleaseTag('oneworks', '1.2.3')).toBe('pkg/oneworks/v1.2.3')
  })

  it('builds the npm tarball url for the implementation CLI package', () => {
    expect(buildOneWorksCliTarballUrl('1.2.3')).toBe(
      'https://registry.npmjs.org/@oneworks/cli/-/cli-1.2.3.tgz'
    )
  })

  it('normalizes an implementation CLI package release tag version', () => {
    expect(normalizeOneWorksCliVersion(`pkg/oneworks-cli/v1.2.3`)).toBe('1.2.3')
    expect(buildPackageReleaseTag(ONEWORKS_CLI_PACKAGE_NAME, '1.2.3')).toBe('pkg/oneworks-cli/v1.2.3')
  })

  it('updates the formula url and sha256', () => {
    const content = [
      'class Oneworks < Formula',
      '  url "https://registry.npmjs.org/oneworks/-/oneworks-1.0.1.tgz"',
      '  sha256 "cc3992d84090cbce3eb30b49c49af87a119442ee5af3a4c5009a0dfd4abb68e3"',
      'end',
      ''
    ].join('\n')

    expect(updateOneWorksFormula(content, {
      tarballUrl: 'https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz',
      sha256: 'a'.repeat(64)
    })).toContain('url "https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz"')
  })

  it('allows an already-synced formula', () => {
    const content = [
      'class Oneworks < Formula',
      '  url "https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz"',
      `  sha256 "${'a'.repeat(64)}"`,
      'end',
      ''
    ].join('\n')

    expect(updateOneWorksFormula(content, {
      tarballUrl: 'https://registry.npmjs.org/oneworks/-/oneworks-1.2.3.tgz',
      sha256: 'a'.repeat(64)
    })).toBe(content)
  })
})
