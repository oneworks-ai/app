import { Buffer } from 'node:buffer'
import process from 'node:process'

import type { Command } from 'commander'

import { DEFAULT_MEMORY_PATH } from './memory/shared'
import type { MemoryAction, MemoryCommandOptions, MemoryCommandResult } from './memory/shared'
import { listMemory, readMemory, writeMemory } from './memory/store'

export type { MemoryAction, MemoryCommandOptions, MemoryCommandResult, MemoryScope } from './memory/shared'

export const runMemoryCommand = async (
  action: MemoryAction,
  options: MemoryCommandOptions = {}
): Promise<MemoryCommandResult> => {
  if (action === 'list') {
    return { output: await listMemory(options) }
  }
  if (action === 'get') {
    return { output: await readMemory(options) }
  }
  return { output: await writeMemory(action, options) }
}

const readStdin = async () => {
  if (process.stdin.isTTY) return ''

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const joinContent = async (parts: string[]) => {
  const value = parts.join(' ')
  if (value !== '') return value
  return await readStdin()
}

const printResult = (output: string) => {
  if (output === '') return
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
}

const addCommonOptions = (command: Command, options: { defaultPath?: boolean } = {}) => {
  const withPath = options.defaultPath === false
    ? command.option('-p, --path <path>', 'Memory file path under the selected id')
    : command.option('-p, --path <path>', 'Memory file path under the selected id', DEFAULT_MEMORY_PATH)
  return withPath
    .option('-c, --channel <channel>', 'Channel type or channel ref, for example wechat')
    .option('-f, --filter <id>', 'Memory id to target or filter')
    .option('-s, --scope <scope>', 'Memory scope: global, channel, session, or user', 'channel')
}

const run = async (action: MemoryAction, opts: MemoryCommandOptions) => {
  const result = await runMemoryCommand(action, opts)
  printResult(result.output)
}

export const registerMemorySubcommands = (command: Command) => {
  addCommonOptions(command.command('set'))
    .description('Overwrite a memory file')
    .argument('[content...]', 'Content to write. Reads stdin when omitted.')
    .action(async (content: string[], options: MemoryCommandOptions) => {
      await run('set', { ...options, content: await joinContent(content) })
    })

  addCommonOptions(command.command('patch'))
    .description('Append content to a memory file')
    .argument('[content...]', 'Content to append. Reads stdin when omitted.')
    .action(async (content: string[], options: MemoryCommandOptions) => {
      await run('patch', { ...options, content: await joinContent(content) })
    })

  addCommonOptions(command.command('get'))
    .description('Print a memory file')
    .action(async (options: MemoryCommandOptions) => {
      await run('get', options)
    })

  addCommonOptions(command.command('list'), { defaultPath: false })
    .description('List available memory files')
    .action(async (options: MemoryCommandOptions) => {
      await run('list', options)
    })

  return command
}

export const registerMemoryCommand = (program: Command) => {
  registerMemorySubcommands(
    program
      .command('mem')
      .description('Read and write OneWorks memory from agent sessions')
  )
}
