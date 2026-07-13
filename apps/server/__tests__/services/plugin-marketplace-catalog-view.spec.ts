import { describe, expect, it } from 'vitest'

import type { ClaudeCodeMarketplacePluginDefinition } from '@oneworks/types'

import { resolveMarketplacePluginVersion } from '#~/services/plugins/marketplace-catalog-view.js'

const createPlugin = (
  source: ClaudeCodeMarketplacePluginDefinition['source'],
  version?: string
): ClaudeCodeMarketplacePluginDefinition => ({
  name: 'demo',
  source,
  ...(version != null ? { version } : {})
})

describe('plugin marketplace catalog version', () => {
  it('prefers an explicitly declared plugin version', () => {
    expect(resolveMarketplacePluginVersion(createPlugin({
      source: 'git-subdir',
      url: 'https://github.com/acme/plugins.git',
      path: 'plugins/demo',
      ref: 'v9.9.9'
    }, ' 2.1.0 '))).toBe('2.1.0')
  })

  it('uses npm selectors and semantic Git tags as version fallbacks', () => {
    expect(resolveMarketplacePluginVersion(createPlugin({
      source: 'npm',
      package: '@acme/demo',
      version: '^3.2.1'
    }))).toBe('^3.2.1')
    expect(resolveMarketplacePluginVersion(createPlugin({
      source: 'git-subdir',
      url: 'https://github.com/acme/plugins.git',
      path: 'plugins/demo',
      ref: 'v1.5.5'
    }))).toBe('1.5.5')
    expect(resolveMarketplacePluginVersion(createPlugin({
      source: 'url',
      url: 'https://github.com/acme/demo.git',
      ref: 'refs/tags/v2.0.0-beta.1+build.7'
    }))).toBe('2.0.0-beta.1+build.7')
  })

  it('does not present branches, commit SHAs, or local paths as versions', () => {
    expect(resolveMarketplacePluginVersion(createPlugin({
      source: 'github',
      repo: 'acme/demo',
      ref: 'main',
      sha: 'a175b24f7b34852b70c78c21545cce8037eb3112'
    }))).toBeUndefined()
    expect(resolveMarketplacePluginVersion(createPlugin('./plugins/demo'))).toBeUndefined()
    expect(resolveMarketplacePluginVersion(createPlugin({
      source: 'git-subdir',
      url: 'https://github.com/acme/plugins.git',
      path: 'plugins/demo',
      ref: 'feature/1.5.5'
    }))).toBeUndefined()
  })
})
