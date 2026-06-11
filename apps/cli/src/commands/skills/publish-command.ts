import type { Command } from 'commander'

import {
  publishSkillsCli,
  resolveConfiguredSkillRegistries,
  resolveProjectSkillPublishSpec,
  resolveSkillsRegistry
} from '@oneworks/utils'

import { resolveCliWorkspaceCwd } from '#~/workspace.js'

import { exitWithError, loadSkillsConfigState, printResult } from './shared'
import type { SkillsPublishOptions } from './types'

export const registerPublishSkillSubcommand = (skillsCommand: Command) => {
  skillsCommand
    .command('publish <skill>')
    .description('Publish a local project skill, local path, or remote skill spec through the active skills CLI')
    .option('--access <access>', 'Publish access level passed to the skills CLI')
    .option('--group [name]', 'Publish to a specific group; pass bare --group to select interactively')
    .option('--region <region>', 'Publish region passed to the skills CLI')
    .option('--registry <registry>', 'Package registry used to install the managed skills CLI')
    .option('-y, --yes', 'Skip confirmation prompts when the underlying skills CLI supports it', false)
    .option('--json', 'Print JSON output', false)
    .action(async (skill: string, opts: SkillsPublishOptions) => {
      try {
        const workspaceFolder = resolveCliWorkspaceCwd()
        const state = await loadSkillsConfigState(workspaceFolder)
        const resolved = await resolveProjectSkillPublishSpec({
          selector: skill,
          workspaceFolder
        })
        const publishSource = typeof resolved.publish?.source === 'string'
          ? resolved.publish.source
          : resolved.publish?.registry
        const boundRegistry = typeof publishSource === 'string'
          ? resolveConfiguredSkillRegistries(state.mergedConfig).find(entry => entry.source === publishSource)
          : undefined
        if (publishSource != null && boundRegistry == null && opts.registry == null) {
          throw new Error(
            `Configured publish source "${publishSource}" was not found in skillRegistries.`
          )
        }
        const published = await publishSkillsCli({
          access: opts.access ?? resolved.publish?.access ?? boundRegistry?.publish?.access,
          cwd: workspaceFolder,
          group: opts.group ?? resolved.publish?.group ?? boundRegistry?.publish?.group,
          region: opts.region ?? resolved.publish?.region ?? boundRegistry?.publish?.region,
          registry: opts.registry ?? boundRegistry?.registry ?? resolveSkillsRegistry(state.mergedConfig.skills),
          skillSpec: resolved.skillSpec,
          yes: opts.yes
        })

        if (opts.json) {
          printResult({
            action: 'publish',
            boundSource: boundRegistry?.source,
            output: published.output,
            requested: resolved.requested,
            skillSpec: resolved.skillSpec,
            source: resolved.kind,
            workspaceFolder
          }, true)
          return
        }

        const output = published.output.trim()
        if (output !== '') {
          console.log(output)
          return
        }

        printResult({
          action: 'publish',
          ...(boundRegistry != null ? { boundSource: boundRegistry.source } : {}),
          requested: resolved.requested,
          skillSpec: resolved.skillSpec,
          source: resolved.kind,
          workspaceFolder
        })
      } catch (error) {
        exitWithError(error, opts.json)
      }
    })
}
