import './commands/@core/extra-options'

import process from 'node:process'

import { program } from 'commander'

import { getCliDescription, getCliVersion } from '#~/utils.js'

import { normalizeCliArgs } from './cli-argv'
import { registerAccountsCommand } from './commands/accounts'
import { registerAdapterCommand } from './commands/adapter'
import { registerAgentCommand } from './commands/agent'
import { registerBenchmarkCommand } from './commands/benchmark'
import { registerChannelCommand } from './commands/channel'
import { registerClearCommand } from './commands/clear'
import { registerConfigCommand } from './commands/config'
import { registerDaemonCommand } from './commands/daemon'
import { registerKillCommand } from './commands/kill'
import { registerListCommand } from './commands/list'
import { registerMemoryCommand } from './commands/memory'
import { registerPluginCommand } from './commands/plugin'
import {
  getPluginCliCommandRoots,
  loadPluginCliCommandContributions,
  registerPluginCliCommands
} from './commands/plugin-cli'
import { registerReportCommand } from './commands/report'
import { registerRunCommand } from './commands/run'
import { registerSkillsCommand } from './commands/skills'
import { registerStopCommand } from './commands/stop'

program
  .name('oneworks')
  .description(getCliDescription())
  .version(getCliVersion())
  .showHelpAfterError()
  .addHelpText(
    'after',
    `
Examples:
  oneworks 读取 README 并给出改进建议
  oneworks --include-skill oneworks-cli-quickstart 介绍 One Works CLI 的常用命令
  oneworks 帮我创建一个前端评审实体
  oneworks list
  oneworks list --view full
  oneworks config list
  oneworks --resume [sessionId]
  oneworks --fork [sessionId]
  oneworks list --running
`
  )

registerRunCommand(program)
registerAccountsCommand(program)
registerAgentCommand(program)
registerAdapterCommand(program)
registerBenchmarkCommand(program)
registerChannelCommand(program)
registerClearCommand(program)
registerConfigCommand(program)
registerDaemonCommand(program)
registerListCommand(program)
registerPluginCommand(program)
registerReportCommand(program)
registerStopCommand(program)
registerSkillsCommand(program)
registerKillCommand(program)
registerMemoryCommand(program)

const main = async () => {
  const pluginCliCommands = await loadPluginCliCommandContributions().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    if (process.env.__ONEWORKS_CLI_DEBUG__ === 'true') {
      console.error(`[plugin-cli] Failed to load plugin CLI commands: ${message}`)
    }
    return []
  })
  registerPluginCliCommands(program, pluginCliCommands)
  await program.parseAsync(
    normalizeCliArgs(process.argv.slice(2), getPluginCliCommandRoots(pluginCliCommands)),
    { from: 'user' }
  )
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
