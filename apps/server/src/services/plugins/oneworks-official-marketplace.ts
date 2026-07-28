import type {
  OneWorksMarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogSource,
  PluginMarketplaceConfigSource
} from '@oneworks/types'

import serverPackageJson from '../../../package.json'

import { toCatalogPlugin } from './marketplace-catalog-view'

export const ONEWORKS_OFFICIAL_MARKETPLACE_KEY = 'oneworks-official'

export const ONEWORKS_OFFICIAL_MARKETPLACE_ENTRY: OneWorksMarketplaceConfigEntry = {
  type: 'oneworks',
  options: { version: serverPackageJson.version }
}

export interface OneWorksOfficialPluginDefinition {
  category: string
  description?: string
  displayName: string
  featured?: boolean
  icon: PluginMarketplaceCatalogPlugin['icon']
  name: string
  searchKeywords?: string[]
}

export const ONEWORKS_OFFICIAL_PLUGINS: OneWorksOfficialPluginDefinition[] = [
  {
    category: 'automation',
    displayName: 'In-App Browser Control',
    icon: { kind: 'builtin', id: 'oneworks-browser-driver' },
    name: '@oneworks/plugin-browser-driver'
  },
  {
    category: 'themes',
    description: 'An optional China Edition theme pack for One Works.',
    displayName: 'China Edition Theme',
    featured: true,
    icon: { kind: 'builtin', id: 'oneworks-china-red-theme' },
    name: '@oneworks/plugin-china-red-theme',
    searchKeywords: ['中国方案主题']
  },
  {
    category: 'developer-tools',
    displayName: 'Chrome DevTools',
    icon: { kind: 'builtin', id: 'oneworks-chrome-devtools' },
    name: '@oneworks/plugin-chrome-devtools'
  },
  {
    category: 'automation',
    displayName: 'Browser Control',
    icon: { kind: 'builtin', id: 'oneworks-external-browser-driver' },
    name: '@oneworks/plugin-external-browser-driver'
  },
  {
    category: 'developer-tools',
    displayName: 'CLI Skills',
    icon: { kind: 'builtin', id: 'oneworks-cli-skills' },
    name: '@oneworks/plugin-cli-skills'
  },
  {
    category: 'automation',
    displayName: 'Computer Control - CUA',
    featured: true,
    icon: { kind: 'builtin', id: 'oneworks-cua-driver' },
    name: '@oneworks/plugin-cua-driver'
  },
  {
    category: 'developer-tools',
    description: 'A compact reference plugin for One Works routes, commands, panels, and configuration.',
    displayName: 'Plugin Demo',
    featured: true,
    icon: { kind: 'builtin', id: 'oneworks-plugin-demo' },
    name: '@oneworks/plugin-demo'
  },
  {
    category: 'developer-tools',
    description: 'An extension companion that contributes actions and commands to Plugin Demo.',
    displayName: 'Plugin Demo Extension',
    icon: { kind: 'builtin', id: 'oneworks-plugin-demo-extension' },
    name: '@oneworks/plugin-demo-extension'
  },
  {
    category: 'themes',
    description: 'An optional restrained, low-noise workbench theme for One Works.',
    displayName: 'Codex Theme',
    featured: true,
    icon: { kind: 'builtin', id: 'oneworks-focus-workbench-theme' },
    name: '@oneworks/plugin-focus-workbench-theme'
  },
  {
    category: 'developer-tools',
    description: 'Structured runtime logging and diagnostics for One Works plugins.',
    displayName: 'Logger',
    icon: { kind: 'builtin', id: 'oneworks-logger' },
    name: '@oneworks/plugin-logger'
  },
  {
    category: 'themes',
    description: 'An optional neo-brutalist theme pack for One Works.',
    displayName: 'Neo Workshop Theme',
    featured: true,
    icon: { kind: 'builtin', id: 'oneworks-neo-workshop-theme' },
    name: '@oneworks/plugin-neo-workshop-theme'
  },
  {
    category: 'themes',
    description: 'An optional warm, card-oriented collaboration theme for One Works.',
    displayName: 'Cowork Theme',
    featured: true,
    icon: { kind: 'builtin', id: 'oneworks-warm-cowork-theme' },
    name: '@oneworks/plugin-warm-cowork-theme'
  }
]

const officialPluginNames = new Set(ONEWORKS_OFFICIAL_PLUGINS.map(plugin => plugin.name))

export const isOneWorksOfficialPlugin = (marketplace: string, plugin: string) => (
  marketplace === ONEWORKS_OFFICIAL_MARKETPLACE_KEY && officialPluginNames.has(plugin)
)

export const loadOneWorksOfficialMarketplaceCatalog = (params: {
  builtIn: boolean
  configSource?: PluginMarketplaceConfigSource
  installedSources: (plugin: string) => PluginMarketplaceCatalogPlugin['installedSources']
  key: string
  marketplace: OneWorksMarketplaceConfigEntry
}): { plugins: PluginMarketplaceCatalogPlugin[]; source: PluginMarketplaceCatalogSource } => {
  if (params.key !== ONEWORKS_OFFICIAL_MARKETPLACE_KEY) {
    return {
      plugins: [],
      source: {
        builtIn: params.builtIn,
        entry: params.marketplace,
        key: params.key,
        type: params.marketplace.type,
        enabled: params.marketplace.enabled !== false,
        pluginCount: 0,
        error: `Unsupported One Works marketplace ${params.key}.`,
        ...(params.configSource != null ? { configSource: params.configSource } : {})
      }
    }
  }

  const version = params.marketplace.options?.version ?? serverPackageJson.version
  const plugins = ONEWORKS_OFFICIAL_PLUGINS.map(plugin =>
    toCatalogPlugin({
      builtIn: params.builtIn,
      source: { label: `${plugin.name}@${version}`, type: 'npm' },
      configSource: params.configSource,
      marketplace: params.marketplace,
      marketplaceKey: params.key,
      marketplaceTitle: 'One Works',
      installedSources: params.installedSources(plugin.name),
      version,
      plugin
    })
  )
  return {
    plugins,
    source: {
      builtIn: params.builtIn,
      entry: params.marketplace,
      key: params.key,
      type: params.marketplace.type,
      enabled: params.marketplace.enabled !== false,
      pluginCount: plugins.length,
      title: 'One Works',
      ...(params.configSource != null ? { configSource: params.configSource } : {})
    }
  }
}
