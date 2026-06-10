import { Buffer } from 'node:buffer'
import type { Readable, Writable } from 'node:stream'

import type { RuntimeSessionResultEnvelope } from '@oneworks/runtime-protocol'

import { executeRuntimeProtocolCommand } from './protocol'
import type { ExecuteRuntimeProtocolCommandOptions } from './protocol'
import type { RunInputFormat, RunOutputFormat } from './types'

export interface RuntimeProtocolStdioOptions extends ExecuteRuntimeProtocolCommandOptions {
  inputFormat: RunInputFormat
  outputFormat: RunOutputFormat
  stdin: Readable
  stdout: Writable
}

const readStreamText = async (stream: Readable) => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const parseJsonlCommands = (text: string) =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as unknown)

const parseCommands = (text: string, format: RunInputFormat) => {
  const trimmed = text.trim()
  if (trimmed === '') return []
  if (format === 'stream-json') return parseJsonlCommands(trimmed)
  if (format !== 'json') {
    throw new Error(`Runtime protocol input does not support --input-format ${format}.`)
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch (error) {
    if (trimmed.includes('\n')) return parseJsonlCommands(trimmed)
    throw error
  }
}

const writeResults = (
  results: RuntimeSessionResultEnvelope[],
  outputFormat: RunOutputFormat,
  stdout: Writable
) => {
  if (outputFormat === 'stream-json') {
    for (const result of results) stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  if (outputFormat !== 'json') {
    throw new Error('Runtime protocol mode requires --output-format json or stream-json.')
  }

  stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`)
}

export const runRuntimeProtocolStdio = async (options: RuntimeProtocolStdioOptions) => {
  const commands = parseCommands(await readStreamText(options.stdin), options.inputFormat)
  const results = []
  for (const command of commands) {
    results.push(await executeRuntimeProtocolCommand(command, options))
  }
  writeResults(results, options.outputFormat, options.stdout)
}
