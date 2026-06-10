import process from 'node:process'

import { buildConfigJsonVariables, loadConfig, mergeConfigs } from '@oneworks/config'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils'
import type { Command } from 'commander'

import { resolveCliWorkspaceCwd } from '#~/workspace.js'
import { createAdapterOption, normalizeCliAdapterOptionValue } from './@core/adapter-option'
import { addAdapterPlugin } from './@core/plugin-install'

const normalizeManagedPluginAdapter = (adapter: string) => adapter === 'claude-code' ? 'claude' : adapter

export const resolvePluginCommandAdapter = async (
  explicitAdapter: string | undefined,
  cwd: string = process.cwd()
) => {
  const normalizedExplicitAdapter = explicitAdapter == null
    ? undefined
    : normalizeCliAdapterOptionValue(explicitAdapter)
  if (normalizedExplicitAdapter) return normalizeManagedPluginAdapter(normalizedExplicitAdapter)

  const env = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: cwd })
  const [projectConfig, userConfig] = await loadConfig({
    cwd,
    env,
    jsonVariables: buildConfigJsonVariables(cwd, env)
  })
  return normalizeManagedPluginAdapter(
    mergeConfigs(projectConfig, userConfig)?.defaultAdapter ?? 'claude'
  )
}

export function registerPluginCommand(program: Command) {
  const pluginCommand = program
    .command('plugin')
    .description('Install and manage adapter-native plugins')
    .addOption(createAdapterOption('Plugin adapter type'))

  pluginCommand
    .command('add <source>')
    .description('Install an adapter-native plugin from local sources, package registries, or configured marketplaces')
    .option('--force', 'Replace the existing installed plugin if it already exists', false)
    .option('--scope <scope>', 'Override the One Works scope used for converted assets')
    .action(async (source: string, opts: { force?: boolean; scope?: string }, command: Command) => {
      try {
        const parentOptions = command.parent?.opts() as { adapter?: string } | undefined
        const cwd = resolveCliWorkspaceCwd()
        const env = mergeProcessEnvWithProjectEnv(undefined, { workspaceFolder: cwd })
        const adapter = await resolvePluginCommandAdapter(parentOptions?.adapter, cwd)
        await addAdapterPlugin(adapter, {
          cwd,
          env,
          source,
          force: opts.force,
          scope: opts.scope
        })
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}
