import process from 'node:process'

import { Option } from 'commander'
import type { Command } from 'commander'

import { runGetCommand, runListCommand, runSetCommand, runUnsetCommand } from './actions'
import {
  CONFIG_LIST_SOURCES,
  CONFIG_READ_SOURCES,
  CONFIG_SET_SOURCES,
  CONFIG_VALUE_TYPES,
  formatErrorMessage
} from './shared'
import type { ConfigGetOptions, ConfigListOptions, ConfigSetOptions, ConfigUnsetOptions } from './shared'

const exitWithError = (error: unknown, json = false): never => {
  const message = formatErrorMessage(error)
  if (json) {
    console.error(JSON.stringify({ ok: false, error: message }, null, 2))
  } else {
    console.error(message)
  }
  process.exit(1)
}

export function registerConfigCommand(program: Command) {
  const configCommand = program
    .command('config')
    .description('Inspect and update workspace config files')

  configCommand
    .command('list [path]')
    .description('List config sections or show a config subtree')
    .addOption(
      new Option('--source <source>', 'List a single source instead of all sources')
        .choices([...CONFIG_LIST_SOURCES])
    )
    .option('--json', 'Print JSON output', false)
    .addHelpText(
      'after',
      `
Examples:
  oneworks config list
  oneworks config list models --json
  oneworks config list adapters.codex --source project
  oneworks config list --source all
`
    )
    .action(async (path: string | undefined, opts: ConfigListOptions) => {
      try {
        await runListCommand(path, opts)
      } catch (error) {
        exitWithError(error, opts.json)
      }
    })

  configCommand
    .command('get [path]')
    .description('Read a config section or a nested config value')
    .addOption(
      new Option('--source <source>', 'Read from a specific config source')
        .choices([...CONFIG_READ_SOURCES])
    )
    .option('--json', 'Print JSON output', false)
    .addHelpText(
      'after',
      `
Examples:
  oneworks config get general.defaultModel
  oneworks config get permissions.allow --source project
  oneworks config get '["models","gpt-4.1","title"]' --source merged --json
`
    )
    .action(async (path: string | undefined, opts: ConfigGetOptions) => {
      try {
        await runGetCommand(path, opts)
      } catch (error) {
        exitWithError(error, opts.json)
      }
    })

  configCommand
    .command('set [path] [value]')
    .description('Update a config section or nested config value')
    .addOption(
      new Option('--source <source>', 'Write to a specific config source')
        .choices([...CONFIG_SET_SOURCES])
    )
    .addOption(
      new Option('--type <type>', 'How to parse the provided value')
        .choices([...CONFIG_VALUE_TYPES])
    )
    .option('--json', 'Print JSON output', false)
    .addHelpText(
      'after',
      `
Examples:
  oneworks config set general.defaultModel gpt-5.4 --type string
  oneworks config set general.permissions '{"allow":["Read"]}' --type json
  echo '{"args":["--port","3000"]}' | oneworks config set mcp.mcpServers.docs --type json --json
`
    )
    .action(async (path: string | undefined, value: string | undefined, opts: ConfigSetOptions) => {
      try {
        await runSetCommand(path, value, opts)
      } catch (error) {
        exitWithError(error, opts.json)
      }
    })

  configCommand
    .command('unset [path]')
    .description('Remove a config section or nested config value')
    .addOption(
      new Option('--source <source>', 'Write to a specific config source')
        .choices([...CONFIG_SET_SOURCES])
    )
    .option('--json', 'Print JSON output', false)
    .addHelpText(
      'after',
      `
Examples:
  oneworks config unset general.defaultModel
  oneworks config unset general.permissions.allow --source project
  oneworks config unset plugins --source user --json
`
    )
    .action(async (path: string | undefined, opts: ConfigUnsetOptions) => {
      try {
        await runUnsetCommand(path, opts)
      } catch (error) {
        exitWithError(error, opts.json)
      }
    })
}
