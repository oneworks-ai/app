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
import { registerKillCommand } from './commands/kill'
import { registerListCommand } from './commands/list'
import { registerMemoryCommand } from './commands/memory'
import { registerPluginCommand } from './commands/plugin'
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
registerListCommand(program)
registerPluginCommand(program)
registerReportCommand(program)
registerStopCommand(program)
registerSkillsCommand(program)
registerKillCommand(program)
registerMemoryCommand(program)

program.parse(normalizeCliArgs(process.argv.slice(2)), { from: 'user' })
