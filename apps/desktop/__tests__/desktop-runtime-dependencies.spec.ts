import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const workspaceManifest = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')

const desktopPackageJson = require('../package.json') as {
  dependencies?: Record<string, string>
  scripts?: Record<string, string>
}
const relayPackageJson = require('../../../packages/plugins/relay/package.json') as {
  files?: string[]
  icon?: string
}
const { BUILTIN_PLUGIN_PACKAGES } = require('../src/builtin-adapter-cache.cjs') as {
  BUILTIN_PLUGIN_PACKAGES: string[]
}

const bundledAdapterPackages = [
  '@oneworks/adapter-claude-code',
  '@oneworks/adapter-codex',
  '@oneworks/adapter-copilot',
  '@oneworks/adapter-gemini',
  '@oneworks/adapter-kimi',
  '@oneworks/adapter-opencode',
  '@oneworks/adapter-pi'
]

const bundledPluginPackages = [
  '@oneworks/plugin-browser-driver',
  '@oneworks/plugin-external-browser-driver',
  '@oneworks/plugin-cua-driver',
  '@oneworks/plugin-logger',
  '@oneworks/plugin-relay'
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
    expect(BUILTIN_PLUGIN_PACKAGES).toEqual(bundledPluginPackages)
    expect(desktopPackageJson.scripts?.['build:plugins']).toBe(
      'pnpm --filter @oneworks/plugin-external-browser-driver --filter @oneworks/plugin-cua-driver ' +
        '--filter @oneworks/plugin-relay build'
    )
    expect(desktopPackageJson.scripts?.package).toContain('pnpm run build:plugins')
    expect(workspaceManifest).toContain(
      "'@oneworks/plugin-cua-driver@file:packages/plugins/cua-driver': true"
    )
  })

  it('ships the Relay presentation icon in the built-in plugin package', () => {
    expect(relayPackageJson.icon).toBe('./assets/icon.svg')
    expect(relayPackageJson.files).toContain('assets')
  })
})
