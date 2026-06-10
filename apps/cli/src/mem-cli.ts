import process from 'node:process'

import { Command } from 'commander'

import { getCliVersion } from '#~/utils.js'

import { registerMemorySubcommands } from './commands/memory'

const program = new Command()

program
  .name('oneworks mem')
  .description('Read and write OneWorks channel memory from agent sessions')
  .version(getCliVersion())
  .showHelpAfterError()

registerMemorySubcommands(program)

program.parse(process.argv)
