#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'

const args = process.argv.slice(2)
if (process.env.CLINE_FAKE_ARGS_PATH) {
  await appendFile(process.env.CLINE_FAKE_ARGS_PATH, `${JSON.stringify(args)}\n`)
}
if (process.env.CLINE_FAKE_PREPARE_PATH) {
  const configFlagIndex = args.indexOf('--config')
  const dataFlagIndex = args.indexOf('--data-dir')
  const hooksFlagIndex = args.indexOf('--hooks-dir')
  const providerFlagIndex = args.indexOf('--provider')
  const configDir = configFlagIndex < 0 ? undefined : args[configFlagIndex + 1]
  await appendFile(
    process.env.CLINE_FAKE_PREPARE_PATH,
    `${
      JSON.stringify({
        configDir,
        dataDir: dataFlagIndex < 0 ? undefined : args[dataFlagIndex + 1],
        home: process.env.HOME,
        hooksDir: hooksFlagIndex < 0 ? undefined : args[hooksFlagIndex + 1],
        provider: providerFlagIndex < 0 ? undefined : args[providerFlagIndex + 1],
        undocumentedProviderEnv: {
          model: process.env.CLINE_MODEL,
          provider: process.env.CLINE_PROVIDER,
          settingsPath: process.env.CLINE_PROVIDER_SETTINGS_PATH
        },
        skillEntries: configDir ? await readdir(`${configDir}/skills`).catch(() => []) : [],
        systemRule: configDir ? await readFile(`${configDir}/rules/oneworks-system.md`, 'utf8').catch(() => '') : ''
      })
    }\n`
  )
}
if (process.env.CLINE_FAKE_CAPTURE_PATH) {
  const credentialKeys = [
    'ANTHROPIC_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_PROFILE',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SHARED_CREDENTIALS_FILE',
    'CLINE_API_KEY',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'OPENAI_API_KEY'
  ]
  await writeFile(
    process.env.CLINE_FAKE_CAPTURE_PATH,
    JSON.stringify(Object.fromEntries(
      credentialKeys.flatMap(key => process.env[key] == null ? [] : [[key, process.env[key]]])
    ))
  )
}
if (args.includes('--json')) {
  let prompt = ''
  for await (const chunk of process.stdin) prompt += chunk.toString()
  if (process.env.CLINE_FAKE_STDIN_PATH) await writeFile(process.env.CLINE_FAKE_STDIN_PATH, prompt)
  if (process.env.CLINE_FAKE_MODE === 'fresh-unresponsive') {
    process.on('SIGTERM', () => undefined)
    setInterval(() => undefined, 1_000)
    await new Promise(() => undefined)
  }
  if (process.env.CLINE_FAKE_MODE === 'fresh-nonzero') {
    process.stderr.write(`fresh diagnostic prompt=${prompt} secret=FRESH_SECRET_FIXTURE\n`)
    process.exit(8)
  }
  const responseText = prompt.length > 100_000 ? `fresh-bytes:${Buffer.byteLength(prompt)}` : `fresh:${prompt}`
  if (process.env.CLINE_FAKE_MODE === 'fresh-run-result-only') {
    process.stdout.write(`${JSON.stringify({ type: 'run_result', text: responseText })}\n`)
    process.exit(0)
  }
  if (process.env.CLINE_FAKE_MODE === 'fresh-mismatch') {
    process.stdout.write(`${
      JSON.stringify({
        type: 'agent_event',
        event: { type: 'content_start', contentType: 'text', text: 'streamed' }
      })
    }\n`)
    process.stdout.write(`${JSON.stringify({ type: 'run_result', text: 'different final' })}\n`)
    process.exit(0)
  }
  if (process.env.CLINE_FAKE_MODE === 'fresh-fragmented') {
    const midpoint = Math.max(1, Math.floor(responseText.length / 2))
    for (const text of [responseText.slice(0, midpoint), responseText.slice(midpoint)]) {
      process.stdout.write(`${
        JSON.stringify({
          type: 'agent_event',
          event: { type: 'content_start', contentType: 'text', text }
        })
      }\n`)
    }
    process.stdout.write(`${JSON.stringify({ type: 'run_result', text: responseText })}\n`)
    process.exit(0)
  }
  if (process.env.CLINE_FAKE_MODE === 'fresh-interleaved') {
    process.stdout.write(`${
      JSON.stringify({
        type: 'agent_event',
        event: { type: 'content_start', contentType: 'text', text: 'before' }
      })
    }\n`)
    process.stdout.write(`${
      JSON.stringify({
        type: 'agent_event',
        event: {
          type: 'content_start',
          contentType: 'tool',
          toolUseId: 'fresh-tool',
          toolName: 'read',
          input: { path: 'README.md' }
        }
      })
    }\n`)
    process.stdout.write(`${
      JSON.stringify({
        type: 'agent_event',
        event: { type: 'content_end', contentType: 'tool', output: 'tool output' }
      })
    }\n`)
    process.stdout.write(`${
      JSON.stringify({
        type: 'agent_event',
        event: { type: 'content_start', contentType: 'text', text: 'after' }
      })
    }\n`)
    process.stdout.write(`${JSON.stringify({ type: 'run_result', text: 'beforeafter' })}\n`)
    process.exit(0)
  }
  process.stdout.write(`${
    JSON.stringify({
      type: 'agent_event',
      event: { type: 'content_start', contentType: 'text', text: responseText }
    })
  }\n`)
  process.stdout.write(`${JSON.stringify({ type: 'run_result', text: '' })}\n`)
  process.exit(0)
}

const mode = process.env.CLINE_FAKE_MODE ?? 'normal'
const version = process.env.CLINE_FAKE_VERSION ?? '3.0.54'
const authMode = process.env.CLINE_FAKE_AUTH ?? 'none'
if (mode === 'exit-before-initialize') process.exit(0)
const verifiedAuthMethods = [
  { id: 'cline', name: 'Sign in with Cline' },
  { id: 'cline-pass', name: 'Sign in with ClinePass' },
  { id: 'openai-codex', name: 'Sign in with ChatGPT Subscription' }
]
let authenticated = authMode === 'none' || process.env.CLINE_API_KEY != null
if (mode === 'acp-unresponsive') {
  process.on('SIGTERM', () => undefined)
  setInterval(() => undefined, 1_000)
}
let cancelPrompt
let connection
const agent = {
  async initialize() {
    if (mode === 'initialize-reject') throw new Error('fake initialize rejected')
    if (mode === 'exit-during-initialize') process.exit(6)
    const authMethods = authMode === 'none'
      ? []
      : authMode === 'unknown'
      ? [{ id: 'future-auth', name: 'Future Auth' }]
      : authMode === 'duplicate'
      ? [verifiedAuthMethods[0], verifiedAuthMethods[0]]
      : authMode === 'unsupported-type'
      ? [{ ...verifiedAuthMethods[0], type: 'terminal' }]
      : verifiedAuthMethods
    return {
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      agentInfo: { name: 'cline', version },
      authMethods
    }
  },
  async newSession() {
    if (!authenticated) throw new Error('auth_required: authenticate before newSession')
    if (mode === 'exit-during-new') process.exit(7)
    if (process.env.CLINE_FAKE_LIFECYCLE_PATH) {
      await appendFile(process.env.CLINE_FAKE_LIFECYCLE_PATH, 'new:cline-native-fixture-1\n')
    }
    return { sessionId: 'cline-native-fixture-1' }
  },
  async loadSession(params) {
    if (!authenticated) throw new Error('auth_required: authenticate before loadSession')
    if (mode === 'exit-during-load') process.exit(8)
    if (process.env.CLINE_FAKE_LIFECYCLE_PATH) {
      await appendFile(process.env.CLINE_FAKE_LIFECYCLE_PATH, `load:${params.sessionId}\n`)
    }
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'replay-message-1',
        content: { type: 'text', text: 'replayed-text' }
      }
    })
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'replay-tool',
        title: 'Replay image',
        kind: 'read',
        status: 'completed',
        rawInput: {},
        rawOutput: '[image]'
      }
    })
    return {}
  },
  async prompt(params) {
    const text = params.prompt.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (mode === 'eof-on-prompt') process.exit(0)
    if (mode === 'nonzero-on-prompt') {
      process.stderr.write(`provider diagnostic repeated prompt: ${text}\n`)
      process.exit(7)
    }
    if (text.includes('EMPTY')) return { stopReason: 'end_turn' }
    if (text.includes('SECRET_ACP')) {
      const secret = 'AWS_SECRET_FIXTURE_LONG'
      process.stderr.write(`provider=${secret} encoded=${encodeURIComponent(secret)} token=sk-secretfixture12345678\n`)
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'session_info_update', title: `title:${secret}` }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `text:${secret}` } }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'secret-tool',
          title: 'Secret tool',
          kind: 'read',
          status: 'completed',
          rawInput: { apiKey: secret },
          rawOutput: Buffer.from(secret).toString('base64')
        }
      })
      throw new Error(`provider error ${secret} sk-secretfixture12345678`)
    }
    if (text.includes('CHUNKS')) {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first **' } }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'chunk-tool',
          title: 'Chunk tool',
          kind: 'read',
          status: 'completed',
          rawInput: {},
          rawOutput: 'chunk-result'
        }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private thought' } }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'bold**\n```ts\n' } }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'const ok = true\n```' } }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '' } }
      })
      return { stopReason: 'end_turn' }
    }
    if (text.includes('REPLAY_ID')) {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'replay-message-1',
          content: { type: 'text', text: 'replayed-text' }
        }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'live-message-1',
          content: { type: 'text', text: 'live-text' }
        }
      })
      return { stopReason: 'end_turn' }
    }
    if (text.includes('SAME_PUNCT')) {
      for (const messageId of ['punctuation-a', 'punctuation-b']) {
        await connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId,
            content: { type: 'text', text: '!' }
          }
        })
      }
      return { stopReason: 'end_turn' }
    }
    if (text.includes('USAGE')) {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'usage_update', used: 100, size: 1_000 }
      })
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'usage_update', used: 200, size: 1_000 }
      })
    }
    if (text.includes('CANCEL')) {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'session_info_update', title: 'cancel-ready' }
      })
      return await new Promise(resolve => {
        cancelPrompt = () => resolve({ stopReason: 'cancelled' })
      })
    }
    if (text.includes('ACP_HANG')) {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: { sessionUpdate: 'session_info_update', title: 'acp-hang-ready' }
      })
      return await new Promise(() => undefined)
    }
    const toolKind = text.includes('EDIT') ? 'edit' : 'read'
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `reply:${text}` } }
    })
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: `tool-${text}`,
        title: 'Read fixture',
        kind: toolKind,
        status: 'pending',
        rawInput: { path: 'README.md' }
      }
    })
    const permissionRequest = connection.requestPermission({
      sessionId: params.sessionId,
      toolCall: { toolCallId: `tool-${text}`, title: 'Read fixture', kind: toolKind },
      options: [
        { optionId: 'allow-once-fixture', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'allow-always-fixture', kind: 'allow_always', name: 'Allow always' },
        { optionId: 'reject-once-fixture', kind: 'reject_once', name: 'Reject once' }
      ].filter(option => mode !== 'no-allow-once' || option.kind !== 'allow_once')
    })
    if (mode === 'pending-permission-exit') {
      setTimeout(() => process.exit(9), 25)
    }
    const permission = await permissionRequest
    if (process.env.CLINE_FAKE_PERMISSION_PATH) {
      await appendFile(process.env.CLINE_FAKE_PERMISSION_PATH, `${JSON.stringify(permission)}\n`)
    }
    if (permission.outcome.outcome === 'cancelled') return { stopReason: 'cancelled' }
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: `tool-${text}`,
        status: 'completed',
        rawOutput: 'fixture-result'
      }
    })
    return { stopReason: 'end_turn' }
  },
  async cancel() {
    if (mode === 'acp-unresponsive') return await new Promise(() => undefined)
    cancelPrompt?.()
    cancelPrompt = undefined
  },
  async authenticate(params) {
    if (process.env.CLINE_FAKE_LIFECYCLE_PATH) {
      await appendFile(process.env.CLINE_FAKE_LIFECYCLE_PATH, `auth:${params.methodId}\n`)
    }
    const delayMs = Number.parseInt(process.env.CLINE_FAKE_AUTH_DELAY_MS ?? '0', 10)
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
    if (authMode === 'exit') process.exit(9)
    if (authMode === 'fail') throw new Error('fake auth failed sk-authsecret1234567890')
    if (authMode === 'timeout') return await new Promise(() => undefined)
    if (!verifiedAuthMethods.some(method => method.id === params.methodId)) {
      throw new Error(`unknown auth method ${params.methodId}`)
    }
    authenticated = true
    return {}
  }
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
connection = new AgentSideConnection(() => agent, stream)
await connection.closed
