#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import readline from 'node:readline'

if (process.argv[2] === '--version') {
  process.stdout.write('goose 1.46.0\n')
  process.exit(0)
}

if (process.argv[2] !== 'acp') {
  process.stderr.write('expected acp\n')
  process.exit(2)
}

let promptRequestId
const permissionRequestId = 900
const leakValue = process.env.GOOSE_FAKE_LEAK_ENV_NAME
  ? process.env[process.env.GOOSE_FAKE_LEAK_ENV_NAME] ?? ''
  : ''
const leakText = process.env.GOOSE_FAKE_LEAK === '1'
  ? `${leakValue} ${encodeURIComponent(leakValue)} ${
    Buffer.from(leakValue).toString('base64')
  } ${process.env.GOOSE_PATH_ROOT}`
  : ''
const write = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const respond = (id, result) => write({ jsonrpc: '2.0', id, result })
const respondError = (id, message) => write({ jsonrpc: '2.0', id, error: { code: -32000, message } })
const notify = (method, params) => write({ jsonrpc: '2.0', method, params })
const legacyCliLoaderEnv = ['__IS_', 'LOADER_CLI__'].join('')
const legacyHookLoaderEnv = ['__IS_', 'ONEWORKS_HOOK_LOADER__'].join('')
const log = (value) => {
  if (process.env.GOOSE_FAKE_LOG_FILE) {
    appendFileSync(process.env.GOOSE_FAKE_LOG_FILE, `${JSON.stringify(value)}\n`)
  }
}
log({
  nodeRuntimeEnv: {
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    NODE_PATH: process.env.NODE_PATH,
    [legacyCliLoaderEnv]: process.env[legacyCliLoaderEnv],
    [legacyHookLoaderEnv]: process.env[legacyHookLoaderEnv],
    __ONEWORKS_CLI_HELPER_LOADER_ACTIVE__: process.env.__ONEWORKS_CLI_HELPER_LOADER_ACTIVE__,
    __ONEWORKS_HOOK_LOADER_ACTIVE__: process.env.__ONEWORKS_HOOK_LOADER_ACTIVE__,
    __ONEWORKS_PROJECT_REGISTER_LOADER__: process.env.__ONEWORKS_PROJECT_REGISTER_LOADER__
  },
  startup: true,
  routedCredentialPresent: typeof process.env.ONEWORKS_GOOSE_MODEL_API_KEY === 'string' &&
    process.env.ONEWORKS_GOOSE_MODEL_API_KEY.length > 0
})

const runConfiguredMcpChild = (params) => {
  if (process.env.GOOSE_FAKE_RUN_MCP !== '1') return
  const server = params?.mcpServers?.find(candidate => typeof candidate.command === 'string')
  if (server == null) return
  const configuredEnv = Object.fromEntries((server.env ?? []).map(entry => [entry.name, entry.value]))
  const result = spawnSync(server.command, server.args ?? [], {
    env: { ...process.env, ...configuredEnv },
    encoding: 'utf8',
    timeout: 5_000
  })
  log({
    mcpChild: true,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr
  })
}

if (process.env.GOOSE_FAKE_IGNORE_TERM === '1') {
  process.on('SIGTERM', () => log({ signal: 'SIGTERM' }))
}

const finishPrompt = () => {
  notify('session/update', {
    sessionId: 'fake-goose-session',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
      rawOutput: 'fixture result'
    }
  })
  notify('session/update', {
    sessionId: 'fake-goose-session',
    update: {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'assistant-1',
      content: { type: 'text', text: ' world' }
    }
  })
  respond(promptRequestId, {
    stopReason: 'end_turn',
    usage: { totalTokens: 6, inputTokens: 4, outputTokens: 2, thoughtTokens: 0 }
  })
  promptRequestId = undefined
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  log({ method: message.method, id: message.id, params: message.params, result: message.result })
  if (process.env.GOOSE_FAKE_HANG_METHOD && process.env.GOOSE_FAKE_HANG_METHOD === message.method) return
  if (
    process.env.GOOSE_FAKE_STARTUP_ERROR_METHOD &&
    process.env.GOOSE_FAKE_STARTUP_ERROR_METHOD === message.method
  ) {
    respondError(
      message.id,
      `fixture ${message.method} failure ${leakText} request=${JSON.stringify(message.params)}`
    )
    return
  }
  if (message.method === 'initialize') {
    respond(message.id, {
      protocolVersion: message.params.protocolVersion,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true }
      },
      agentInfo: { name: 'goose', title: 'Goose fixture', version: '1.46.0' }
    })
  } else if (message.method === 'session/new') {
    runConfiguredMcpChild(message.params)
    respond(message.id, { sessionId: 'fake-goose-session' })
  } else if (message.method === 'session/load') {
    if (process.env.GOOSE_FAKE_LOAD_ERROR === '1') {
      respondError(message.id, 'session does not exist')
    } else {
      runConfiguredMcpChild(message.params)
      notify('session/update', {
        sessionId: message.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'replayed-message',
          content: { type: 'text', text: 'replayed history' }
        }
      })
      respond(message.id, null)
    }
  } else if (message.method === 'session/set_mode') {
    respond(message.id, null)
  } else if (message.method === '_goose/unstable/session/system-prompt/set') {
    respond(message.id, null)
  } else if (message.method === 'session/prompt') {
    if (process.env.GOOSE_FAKE_EOF_ON_PROMPT === '1') process.exit(0)
    if (process.env.GOOSE_FAKE_EXIT_NONZERO_ON_PROMPT === '1') process.exit(7)
    promptRequestId = message.id
    if (leakText) process.stderr.write(`fixture leak ${leakText}\n`)
    notify('session/update', {
      sessionId: 'fake-goose-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'assistant-1',
        content: { type: 'text', text: leakText ? `Hello ${leakText}` : 'Hello' }
      }
    })
    notify('session/update', {
      sessionId: 'fake-goose-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read fixture',
        name: 'read',
        kind: 'read',
        status: 'pending',
        rawInput: leakText ? { path: 'fixture.txt', token: leakText } : { path: 'fixture.txt' }
      }
    })
    write({
      jsonrpc: '2.0',
      id: permissionRequestId,
      method: 'session/request_permission',
      params: {
        sessionId: 'fake-goose-session',
        toolCall: {
          toolCallId: 'tool-1',
          name: 'read',
          kind: 'read',
          rawInput: leakText ? { path: 'fixture.txt', token: leakText } : { path: 'fixture.txt' }
        },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
        ]
      }
    })
  } else if (message.id === permissionRequestId && message.result != null) {
    if (process.env.GOOSE_FAKE_HOLD_PERMISSION !== '1') finishPrompt()
  } else if (message.method === 'session/cancel') {
    if (promptRequestId != null) {
      respond(promptRequestId, { stopReason: 'cancelled' })
      promptRequestId = undefined
    }
  } else if (message.method === 'session/close') {
    respond(message.id, null)
  } else if (message.id != null) {
    respond(message.id, {})
  }
})
