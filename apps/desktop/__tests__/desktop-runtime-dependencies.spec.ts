import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

const desktopPackageJson = require('../package.json') as {
  dependencies?: Record<string, string>
}

const bundledAdapterPackages = [
  '@oneworks/adapter-claude-code',
  '@oneworks/adapter-codex',
  '@oneworks/adapter-copilot',
  '@oneworks/adapter-gemini',
  '@oneworks/adapter-kimi',
  '@oneworks/adapter-opencode'
]

const bundledPluginPackages = [
  '@oneworks/plugin-logger',
  '@oneworks/plugin-standard-dev'
]

describe('desktop runtime dependencies', () => {
  it('bundles built-in adapter packages for packaged server model metadata', () => {
    expect(desktopPackageJson.dependencies).toEqual(
      expect.objectContaining(
        Object.fromEntries(bundledAdapterPackages.map(packageName => [packageName, 'workspace:*']))
      )
    )
  })

  it('bundles built-in plugin packages so packaged launches can seed the global package cache', () => {
    expect(desktopPackageJson.dependencies).toEqual(
      expect.objectContaining(
        Object.fromEntries(bundledPluginPackages.map(packageName => [packageName, 'workspace:*']))
      )
    )
  })
})
