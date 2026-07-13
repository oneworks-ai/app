import process from 'node:process'

import { loadAdapterNativePluginManager, resolveAdapterRuntimeTarget } from '@oneworks/types'
import type {
  NativeHostPlugin,
  NativeHostPluginAssetGroup,
  NativeHostPluginDiscoveryResult,
  NativeHostSkill,
  NativeHostSkillDiscoveryResult
} from '@oneworks/types'
import { listNativeHostPluginAssetsWithin } from '@oneworks/utils'

import { loadConfigState } from '#~/services/config/index.js'

const NATIVE_PLUGIN_ADAPTERS = [
  'codex',
  'claude-code',
  'gemini',
  'copilot',
  'kimi',
  'opencode'
] as const

const discoverAdapterNativePlugins = async (params: {
  adapter: string
  cwd: string
  config: Awaited<ReturnType<typeof loadConfigState>>['mergedConfig']
}): Promise<NativeHostPluginDiscoveryResult> => {
  try {
    const target = resolveAdapterRuntimeTarget(params.adapter, {
      config: params.config,
      cwd: params.cwd
    })
    const manager = await loadAdapterNativePluginManager(target.loadSpecifier, { cwd: params.cwd })
    const result = await manager.discover({
      cwd: params.cwd,
      env: process.env
    })
    return {
      plugins: result.plugins,
      diagnostics: result.diagnostics.map(diagnostic => ({
        ...diagnostic,
        adapter: diagnostic.adapter ?? manager.adapter
      }))
    }
  } catch (error) {
    return {
      plugins: [],
      diagnostics: [{
        adapter: params.adapter,
        code: 'native_plugin_discovery_failed',
        level: 'warning',
        message: `Failed to discover ${params.adapter} Home plugins: ${
          error instanceof Error ? error.message : String(error)
        }`
      }]
    }
  }
}

const discoverNativeHostPlugins = async (): Promise<NativeHostPluginDiscoveryResult> => {
  const { mergedConfig, workspaceFolder } = await loadConfigState()
  const results = await Promise.all(
    NATIVE_PLUGIN_ADAPTERS.map(adapter =>
      discoverAdapterNativePlugins({
        adapter,
        config: mergedConfig,
        cwd: workspaceFolder
      })
    )
  )
  return {
    diagnostics: results.flatMap(result => result.diagnostics),
    plugins: results
      .flatMap(result => result.plugins)
      .sort((left: NativeHostPlugin, right: NativeHostPlugin) => (
        left.adapter.localeCompare(right.adapter) ||
        (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name) ||
        left.id.localeCompare(right.id)
      ))
  }
}

const discoverAdapterNativeSkills = async (params: {
  adapter: string
  cwd: string
  config: Awaited<ReturnType<typeof loadConfigState>>['mergedConfig']
}): Promise<NativeHostSkillDiscoveryResult> => {
  try {
    const target = resolveAdapterRuntimeTarget(params.adapter, {
      config: params.config,
      cwd: params.cwd
    })
    const manager = await loadAdapterNativePluginManager(target.loadSpecifier, { cwd: params.cwd })
    if (manager.discoverSkills == null) return { diagnostics: [], skills: [] }
    const result = await manager.discoverSkills({ cwd: params.cwd, env: process.env })
    return {
      diagnostics: result.diagnostics.map(diagnostic => ({
        ...diagnostic,
        adapter: diagnostic.adapter ?? manager.adapter
      })),
      skills: result.skills
    }
  } catch (error) {
    return {
      diagnostics: [{
        adapter: params.adapter,
        code: 'native_skill_discovery_failed',
        level: 'warning',
        message: `Failed to discover ${params.adapter} skills: ${
          error instanceof Error ? error.message : String(error)
        }`
      }],
      skills: []
    }
  }
}

export const listNativeHostSkills = async (): Promise<NativeHostSkillDiscoveryResult> => {
  const { mergedConfig, workspaceFolder } = await loadConfigState()
  const results = await Promise.all(
    NATIVE_PLUGIN_ADAPTERS.map(adapter =>
      discoverAdapterNativeSkills({
        adapter,
        config: mergedConfig,
        cwd: workspaceFolder
      })
    )
  )
  const byId = new Map<string, NativeHostSkill>()
  for (const skill of results.flatMap(result => result.skills)) {
    if (!byId.has(skill.id)) byId.set(skill.id, skill)
  }
  return {
    diagnostics: results.flatMap(result => result.diagnostics),
    skills: [...byId.values()].sort((left, right) => (
      left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    ))
  }
}

const toPublicNativeHostPlugin = (plugin: NativeHostPlugin): NativeHostPlugin => ({
  ...plugin,
  source: {
    displayPath: plugin.source.displayPath,
    kind: plugin.source.kind
  }
})

export const listNativeHostPlugins = async (): Promise<NativeHostPluginDiscoveryResult> => {
  const result = await discoverNativeHostPlugins()
  return {
    ...result,
    plugins: result.plugins.map(toPublicNativeHostPlugin)
  }
}

export const listNativeHostPluginAssets = async (
  id: string
): Promise<NativeHostPluginAssetGroup[] | undefined> => {
  const { plugins } = await discoverNativeHostPlugins()
  const selected = plugins.find(plugin => plugin.id === id)
  if (selected == null) return undefined

  const root = selected.source.internalRoot
  if (root == null || root === '') return []
  return listNativeHostPluginAssetsWithin(root)
}
