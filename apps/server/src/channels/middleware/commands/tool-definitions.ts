import type { ConfigJsonSchema } from '@oneworks/types'

import type { AnyCommandSpec, CommandArgumentChoice, CommandArgumentSpec } from './command-system'
import { formatUsage } from './command-system'
import { createToolName, formatUsageAncestors } from './tool-path'
import type {
  ChannelCommandToolArgument,
  ChannelCommandToolArgumentChoice,
  ChannelCommandToolDefinition
} from './tool-types'

const mapChoice = (choice: CommandArgumentChoice): ChannelCommandToolArgumentChoice => ({
  value: choice.value,
  titleKey: choice.title,
  descriptionKey: choice.description
})

const getScalarArgumentSchema = (argument: CommandArgumentSpec): ConfigJsonSchema => {
  const schema: ConfigJsonSchema = { type: 'string' }
  if (argument.description != null && argument.description !== '') {
    schema.description = argument.description
  }
  if (argument.choices != null && argument.choices.length > 0) {
    schema.enum = argument.choices.map(choice => choice.value)
  }
  return schema
}

const getArgumentSchema = (argument: CommandArgumentSpec): ConfigJsonSchema =>
  argument.kind === 'variadic'
    ? { type: 'array', items: getScalarArgumentSchema(argument) }
    : getScalarArgumentSchema(argument)

const createInputSchema = (args: readonly CommandArgumentSpec[]): ConfigJsonSchema => {
  const properties: Record<string, ConfigJsonSchema> = {}
  const required: string[] = []
  for (const argument of args) {
    properties[argument.name] = getArgumentSchema(argument)
    if (argument.kind === 'required' || argument.kind === 'rest') {
      required.push(argument.name)
    }
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
}

const mapArgument = (argument: CommandArgumentSpec): ChannelCommandToolArgument => ({
  name: argument.name,
  kind: argument.kind,
  descriptionKey: argument.description,
  choices: argument.choices?.map(mapChoice) ?? []
})

const createCommandToolDefinition = <TContext>(
  command: AnyCommandSpec<TContext>,
  commandPath: readonly string[],
  prefix: string
): ChannelCommandToolDefinition => ({
  name: createToolName(commandPath),
  namespace: 'channel',
  commandPath,
  commandAliases: command.aliases,
  slashUsage: formatUsage(command, formatUsageAncestors(commandPath.slice(0, -1), prefix), prefix),
  descriptionKey: command.descriptionKey,
  permission: command.permission,
  actorAuthority: 'sender',
  source: 'command-spec',
  inputSchema: createInputSchema(command.args),
  arguments: command.args.map(mapArgument)
})

export const listChannelCommandToolDefinitions = <TContext>(
  commands: readonly AnyCommandSpec<TContext>[],
  options: { prefix?: string } = {}
): ChannelCommandToolDefinition[] => {
  const prefix = options.prefix ?? '/'
  const tools: ChannelCommandToolDefinition[] = []

  const visit = (items: readonly AnyCommandSpec<TContext>[], ancestors: readonly string[]) => {
    for (const command of items) {
      const commandPath = [...ancestors, command.name]
      if (command.action != null) {
        tools.push(createCommandToolDefinition(command, commandPath, prefix))
      }
      if (command.subcommands.length > 0) visit(command.subcommands, commandPath)
    }
  }

  visit(commands, [])
  return tools
}
