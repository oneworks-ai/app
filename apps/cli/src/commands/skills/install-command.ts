import type { Command } from 'commander'

import { resolveSkillsRegistry } from '@oneworks/utils'

import { resolveCliWorkspaceCwd } from '#~/workspace.js'

import { resolveInstallTargets } from './install'
import { createSkillsProgress } from './progress'
import { exitWithError, loadSkillsConfigState, printResult } from './shared'
import { syncProjectSkills } from './sync'
import type { SkillsInstallOptions } from './types'

export const registerInstallSkillSubcommands = (skillsCommand: Command) => {
  skillsCommand
    .command('install [skills...]')
    .description('Install explicit project skills or all configured skills when no arguments are provided')
    .option('--source <source>', 'Remote skills CLI source path for a single explicit skill')
    .option('--version <version>', 'Remote skill version passed to the skills CLI for a single explicit skill')
    .option('--rename <name>', 'Local skill name after install for a single explicit skill')
    .option('--registry <registry>', 'Package registry used to install the managed skills CLI')
    .option('--force', 'Replace existing installed skills', false)
    .option('--json', 'Print JSON output', false)
    .action(async (skills: string[], opts: SkillsInstallOptions) => {
      const progress = createSkillsProgress({ enabled: !opts.json })
      try {
        const workspaceFolder = resolveCliWorkspaceCwd()
        const state = await loadSkillsConfigState(workspaceFolder)
        const defaultRegistry = opts.registry ?? resolveSkillsRegistry(state.mergedConfig.skills)
        const targets = await resolveInstallTargets({
          args: skills,
          options: opts,
          workspaceFolder
        })
        const result = await syncProjectSkills({
          force: opts.force,
          registry: defaultRegistry,
          progress,
          state,
          targets,
          workspaceFolder
        })
        progress.finish(`Installed ${result.installed.length} skills`)

        printResult({
          action: 'install',
          installed: result.installed.map(item => ({
            dirName: item.dirName,
            installDir: item.installDir,
            name: item.name,
            ref: item.ref,
            skipped: item.skipped
          })),
          workspaceFolder
        }, opts.json)
      } catch (error) {
        progress.fail()
        exitWithError(error, opts.json)
      }
    })

  skillsCommand
    .command('update [skills...]')
    .description('Force refresh explicit project skills or all configured skills when no arguments are provided')
    .option('--source <source>', 'Remote skills CLI source path for a single explicit skill')
    .option('--version <version>', 'Remote skill version passed to the skills CLI for a single explicit skill')
    .option('--rename <name>', 'Local skill name after install for a single explicit skill')
    .option('--registry <registry>', 'Package registry used to install the managed skills CLI')
    .option('--json', 'Print JSON output', false)
    .action(async (skills: string[], opts: Omit<SkillsInstallOptions, 'force'>) => {
      const progress = createSkillsProgress({ enabled: !opts.json })
      try {
        const workspaceFolder = resolveCliWorkspaceCwd()
        const state = await loadSkillsConfigState(workspaceFolder)
        const defaultRegistry = opts.registry ?? resolveSkillsRegistry(state.mergedConfig.skills)
        const targets = await resolveInstallTargets({
          args: skills,
          options: opts,
          workspaceFolder
        })
        const result = await syncProjectSkills({
          force: true,
          registry: defaultRegistry,
          progress,
          state,
          targets,
          workspaceFolder
        })
        progress.finish(`Updated ${result.installed.length} skills`)

        printResult({
          action: 'update',
          installed: result.installed.map(item => ({
            dirName: item.dirName,
            installDir: item.installDir,
            name: item.name,
            ref: item.ref
          })),
          workspaceFolder
        }, opts.json)
      } catch (error) {
        progress.fail()
        exitWithError(error, opts.json)
      }
    })
}
