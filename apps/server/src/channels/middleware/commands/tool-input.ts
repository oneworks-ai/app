import type { AnyCommandSpec, CommandArgumentChoice, CommandArgumentSpec } from './command-system'
import { formatUsage } from './command-system'
import { createToolName, formatCommandPath, formatUsageAncestors } from './tool-path'
import type { ChannelCommandToolInputParseResult } from './tool-types'

type ChannelCommandToolInputParseFailure = Extract<
  ChannelCommandToolInputParseResult<never>,
  { readonly ok: false }
>

const findCommandByToolName = <TContext>(
  commands: readonly AnyCommandSpec<TContext>[],
  toolName: string
): { command: AnyCommandSpec<TContext>; commandPath: readonly string[] } | undefined => {
  const visit = (
    items: readonly AnyCommandSpec<TContext>[],
    ancestors: readonly string[]
  ): { command: AnyCommandSpec<TContext>; commandPath: readonly string[] } | undefined => {
    for (const command of items) {
      const commandPath = [...ancestors, command.name]
      if (command.action != null && createToolName(commandPath) === toolName) {
        return { command, commandPath }
      }
      const childMatch = visit(command.subcommands, commandPath)
      if (childMatch != null) return childMatch
    }
    return undefined
  }
  return visit(commands, [])
}

const isInputRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const formatChoiceSummary = (choices: readonly CommandArgumentChoice[]) =>
  choices.map(choice => choice.value).join(', ')

const parseStringArgumentValue = (
  argument: CommandArgumentSpec,
  value: unknown
): { ok: true; rawValue: string; value: unknown } | { ok: false; message: string } => {
  if (typeof value !== 'string') {
    return { ok: false, message: `Argument "${argument.name}" must be a string.` }
  }

  if (argument.choices != null && argument.choices.length > 0) {
    const matched = argument.choices.find(choice => choice.value === value)
    if (matched == null) {
      return {
        ok: false,
        message: `Invalid value for "${argument.name}": ${value}. Supported: ${formatChoiceSummary(argument.choices)}`
      }
    }
    return { ok: true, rawValue: value, value: matched.value }
  }

  try {
    return { ok: true, rawValue: value, value: argument.parse(value) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

const stringifyToolRawValue = (value: unknown) =>
  typeof value === 'string'
    ? value
    : JSON.stringify(value)

const parseToolArgumentValue = (
  argument: CommandArgumentSpec,
  value: unknown
): { ok: true; rawValue: string; value: unknown } | { ok: false; message: string } => {
  if (argument.parseToolInput == null) return parseStringArgumentValue(argument, value)
  try {
    return {
      ok: true,
      rawValue: stringifyToolRawValue(value),
      value: argument.parseToolInput(value)
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

const parseVariadicArgument = (
  argument: CommandArgumentSpec,
  rawInputValue: unknown,
  usage: string
): { ok: true; rawArgs: string[]; values: unknown[] } | ChannelCommandToolInputParseFailure => {
  if (!Array.isArray(rawInputValue)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `Argument "${argument.name}" must be an array.`,
      usage
    }
  }

  const rawArgs: string[] = []
  const values: unknown[] = []
  for (const item of rawInputValue) {
    const parsed = parseStringArgumentValue(argument, item)
    if (!parsed.ok) {
      return { ok: false, code: 'invalid-argument', message: parsed.message, usage }
    }
    rawArgs.push(parsed.rawValue)
    values.push(parsed.value)
  }
  return { ok: true, rawArgs, values }
}

export const parseChannelCommandToolInput = <TContext>(
  commands: readonly AnyCommandSpec<TContext>[],
  toolName: string,
  input: unknown = {},
  options: { prefix?: string } = {}
): ChannelCommandToolInputParseResult<TContext> => {
  const prefix = options.prefix ?? '/'
  const match = findCommandByToolName(commands, toolName)
  if (match == null) {
    return { ok: false, code: 'unknown-tool', message: `Unknown channel command tool: ${toolName}` }
  }

  const { command, commandPath } = match
  const commandArgs = command.args as readonly CommandArgumentSpec[]
  const usage = formatUsage(command, formatUsageAncestors(commandPath.slice(0, -1), prefix), prefix)
  if (!isInputRecord(input)) {
    return { ok: false, code: 'invalid-input', message: 'Channel command tool input must be an object.', usage }
  }

  const knownArguments = new Set(commandArgs.map(argument => argument.name))
  const unknownArguments = Object.keys(input).filter(name => !knownArguments.has(name))
  if (unknownArguments.length > 0) {
    return {
      ok: false,
      code: 'invalid-input',
      message: `Unknown argument(s): ${unknownArguments.join(', ')}`,
      usage
    }
  }

  const args: unknown[] = []
  const rawArgs: string[] = []
  for (const argument of commandArgs) {
    const rawInputValue = input[argument.name]
    if (argument.kind === 'variadic') {
      if (rawInputValue == null) {
        args.push([])
        continue
      }
      const parsed = parseVariadicArgument(argument, rawInputValue, usage)
      if (!parsed.ok) return parsed
      rawArgs.push(...parsed.rawArgs)
      args.push(parsed.values)
      continue
    }

    if (rawInputValue == null) {
      if (argument.kind === 'optional') {
        args.push(undefined)
        continue
      }
      return { ok: false, code: 'missing-argument', message: `Missing argument: ${argument.name}`, usage }
    }

    const parsed = parseToolArgumentValue(argument, rawInputValue)
    if (!parsed.ok) return { ok: false, code: 'invalid-argument', message: parsed.message, usage }
    rawArgs.push(parsed.rawValue)
    args.push(parsed.value)
  }

  return {
    ok: true,
    command,
    args,
    rawArgs,
    commandPath: formatCommandPath(commandPath, prefix),
    usage
  }
}
