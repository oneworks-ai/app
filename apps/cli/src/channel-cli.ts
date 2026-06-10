import process from 'node:process'

import { Command } from 'commander'

import { getCliVersion } from '#~/utils.js'

import { registerChannelSubcommands } from './commands/channel'

const program = new Command()

program
  .name('oneworks channel')
  .description('Send messages through OneWorks channels from agent sessions')
  .version(getCliVersion())
  .showHelpAfterError()

registerChannelSubcommands(program)

program.parse(process.argv)
