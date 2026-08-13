#!/usr/bin/env node
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const main = async () => {
  const args = process.argv.slice(2)
  const readArg = (name) => {
    const exactIndex = args.indexOf(name)
    if (exactIndex >= 0) return args[exactIndex + 1]
    const prefix = `${name}=`
    return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
  }
  const projectDir = readArg('--project')
  if (projectDir) {
    await appendFile(
      join(projectDir, '.fake-junie-calls.jsonl'),
      `${
        JSON.stringify({
          args,
          env: {
            DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
            HOME: process.env.HOME,
            JUNIE_DATA: process.env.JUNIE_DATA,
            XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
            XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
            XDG_DATA_HOME: process.env.XDG_DATA_HOME,
            XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
            keys: Object.keys(process.env).sort()
          },
          authPresence: Object.fromEntries([
            'JUNIE_API_KEY',
            'JUNIE_OPENAI_API_KEY',
            'OPENAI_API_KEY',
            'JUNIE_ANTHROPIC_API_KEY',
            'ANTHROPIC_API_KEY',
            'JUNIE_GOOGLE_API_KEY',
            'GOOGLE_API_KEY',
            'JUNIE_GROK_API_KEY',
            'GROK_API_KEY',
            'JUNIE_OPENROUTER_API_KEY',
            'OPENROUTER_API_KEY',
            'JUNIE_LITELLM_API_KEY',
            'LITELLM_API_KEY',
            'JUNIE_LITELLM_URL',
            'AWS_SECRET_ACCESS_KEY',
            'AZURE_OPENAI_API_KEY',
            'GITHUB_TOKEN',
            'INTERNAL_SECRET'
          ].map(key => [key, process.env[key] != null]))
        })
      }\n`
    )
  }

  if (args.includes('--version')) {
    process.stdout.write('Junie version: 26.8.10 (2651.4)\n')
    process.exit(0)
  }

  const task = readArg('--task') ?? ''
  const scenario = task.startsWith('scenario:') ? task.slice('scenario:'.length) : 'success'
  const resumedSessionId = readArg('--session-id')
  const sessionId = scenario === 'resume-mismatch'
    ? 'session-fake-mismatch'
    : resumedSessionId ?? 'session-fake-native'
  const records = [
    { type: 'session', timestamp: 1786608000000, sessionId },
    { type: 'step', timestamp: 1786608000100, name: 'Read', details: 'README.md', output: 'ok' },
    { type: 'eap-future-decoration', timestamp: 1786608000200, message: 'synthetic' },
    { type: 'system', timestamp: 1786608000300, message: 'fake progress' },
    { type: 'result', timestamp: 1786608000400, result: 'fake response', changes: [], errorCode: [] }
  ]

  const writeInArbitraryChunks = async (text) => {
    const sizes = [1, 11, 2, 37, 5, 19, 3, 4_096]
    let offset = 0
    let index = 0
    while (offset < text.length) {
      const size = sizes[index % sizes.length]
      process.stdout.write(text.slice(offset, offset + size))
      offset += size
      index += 1
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  if (readArg('--output-format') === 'text') process.exit(0)
  if (scenario === 'spawn-hang') {
    process.stdout.write(`${JSON.stringify(records[0])}\n`)
    process.on('SIGINT', () => process.exit(130))
    setInterval(() => undefined, 1_000)
  } else if (scenario === 'truncated') {
    process.stdout.write(`${JSON.stringify(records[0])}\n{"type":"step","output":"cut`)
  } else if (scenario === 'truncated-result') {
    process.stdout.write(`${JSON.stringify(records[0])}\n{"type":"result","result":"cut"`)
  } else if (scenario === 'nonzero') {
    process.stdout.write(`${JSON.stringify(records[0])}\n`)
    process.stderr.write('synthetic non-zero failure\n')
    process.exit(7)
  } else if (scenario === 'result-nonzero') {
    await writeInArbitraryChunks(
      `${
        records.filter(record => record.type !== 'eap-future-decoration').map(record => JSON.stringify(record)).join(
          '\n'
        )
      }\n`
    )
    process.stderr.write('synthetic failure after result\n')
    process.exit(7)
  } else if (scenario === 'duplicate-terminal') {
    await writeInArbitraryChunks(`${records.concat(records.at(-1)).map(record => JSON.stringify(record)).join('\n')}\n`)
  } else if (scenario === 'result-late-invalid') {
    await writeInArbitraryChunks(`${
      records.concat({ type: 'result', result: 'late malformed result', errorCode: null })
        .map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'result-missing-result') {
    await writeInArbitraryChunks(`${
      [records[0], { type: 'result', changes: [], errorCode: [] }]
        .map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'result-missing-error-code') {
    await writeInArbitraryChunks(`${
      [records[0], { type: 'result', result: 'malformed', changes: [] }]
        .map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'result-invalid-error-code') {
    await writeInArbitraryChunks(`${
      [records[0], { type: 'result', result: 'malformed', changes: [], errorCode: 'bad' }]
        .map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'result-invalid-usage') {
    await writeInArbitraryChunks(
      `${
        [records[0], { type: 'result', result: 'malformed', changes: [], errorCode: [{ model: 'm' }] }]
          .map(record => JSON.stringify(record)).join('\n')
      }\n`
    )
  } else if (scenario === 'session-only' || scenario === 'create-failure-after-session') {
    process.stdout.write(`${JSON.stringify(records[0])}\n`)
  } else if (scenario === 'error-after-session') {
    await writeInArbitraryChunks(`${
      [
        records[0],
        { type: 'error', timestamp: 1786608000100, message: 'synthetic protocol error' }
      ].map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'empty-stream') {
    // Intentionally produce no stdout records.
  } else if (scenario === 'step-only') {
    process.stdout.write(`${JSON.stringify(records[1])}\n`)
  } else if (scenario === 'assistant-eof' || scenario === 'missing-result') {
    await writeInArbitraryChunks(
      `${[records[0], records[1], records[3]].map(record => JSON.stringify(record)).join('\n')}\n`
    )
  } else if (scenario === 'result-late-ordinary') {
    await writeInArbitraryChunks(`${
      records.concat({
        type: 'system',
        timestamp: 1786608000500,
        message: 'must be ignored after result'
      }).map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'late-unknown-terminal') {
    await writeInArbitraryChunks(`${
      records.filter(record => record.type !== 'eap-future-decoration').concat({
        type: 'FutureAgentFailureEvent',
        timestamp: 1786608000500,
        message: 'late synthetic failure'
      }).map(record => JSON.stringify(record)).join('\n')
    }\n`)
  } else if (scenario === 'result-without-session') {
    process.stdout.write(`${JSON.stringify(records.at(-1))}\n`)
  } else if (scenario === 'resume-mismatch') {
    await writeInArbitraryChunks(`${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  } else {
    await writeInArbitraryChunks(`${records.map(record => JSON.stringify(record)).join('\n')}\n`)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
