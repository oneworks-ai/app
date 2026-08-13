#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

if (process.argv.includes('--version')) {
  process.stdout.write('kiro-cli 9.9.9-test\n')
  process.exit(0)
}
if (process.argv.includes('--help')) {
  process.stdout.write('Fake Kiro ACP help\n')
  process.exit(0)
}
if (process.argv[2] !== 'acp') process.exit(2)

const logPath = process.env.FAKE_KIRO_LOG
const behavior = process.env.FAKE_KIRO_BEHAVIOR ?? 'normal'
const modelContract = process.env.FAKE_KIRO_MODEL_CONTRACT ?? 'advertised'
const effortContract = process.env.FAKE_KIRO_EFFORT_CONTRACT ?? 'advertised'
const permissionContract = process.env.FAKE_KIRO_PERMISSION_CONTRACT ?? 'full'
const sessionModels = modelContract === 'absent'
  ? undefined
  : {
    currentModelId: 'kiro-test',
    availableModels: [
      { modelId: 'kiro-test', name: 'Kiro Test' },
      { modelId: 'kiro-other', name: 'Kiro Other' }
    ]
  }
const sessionConfigOptions = effortContract === 'absent'
  ? undefined
  : [{
    id: 'reasoning_effort',
    ...(effortContract === 'sparse'
      ? {}
      : { options: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }] }),
    currentValue: process.env.FAKE_KIRO_ACTIVE_EFFORT ?? 'medium'
  }]
const permissionOptions = {
  'allow-persistent-only': [
    { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' }
  ],
  'deny-persistent-only': [
    { optionId: 'reject-always', name: 'Always reject', kind: 'reject_always' }
  ],
  'request-only': [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' }
  ],
  full: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    { optionId: 'reject-always', name: 'Always reject', kind: 'reject_always' }
  ]
}[permissionContract] ?? []
const write = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = value => {
  if (!logPath) return
  const safeValue = value.method === 'session/prompt'
    ? {
      jsonrpc: value.jsonrpc,
      id: value.id,
      method: value.method,
      params: {
        sessionId: value.params?.sessionId,
        hasContent: Array.isArray(value.params?.content),
        hasPrompt: value.params?.prompt != null
      }
    }
    : value
  appendFileSync(logPath, `${JSON.stringify(safeValue)}\n`)
}
log({
  type: 'environment',
  credentialMatchesExpected: process.env.KIRO_API_KEY === process.env.KIRO_TEST_EXPECTED_API_KEY,
  credentialProviderPresence: Object.fromEntries([
    'AWS_BEARER_TOKEN_BEDROCK',
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'AWS_CONTAINER_CREDENTIALS_FULL_URI',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
    'AWS_SHARED_CREDENTIALS_FILE',
    'AWS_CONFIG_FILE'
  ].map(name => [name, typeof process.env[name] === 'string' && process.env[name] !== ''])),
  credentialLocatorMatchesExpected: {
    sharedCredentials: process.env.AWS_SHARED_CREDENTIALS_FILE === (
      process.env.FAKE_KIRO_PHASE === 'resume'
        ? '/runtime-only/resume-shared-credentials'
        : '/runtime-only/create-shared-credentials'
    ),
    config: process.env.AWS_CONFIG_FILE === (
      process.env.FAKE_KIRO_PHASE === 'resume'
        ? '/runtime-only/resume-aws-config'
        : '/runtime-only/create-aws-config'
    )
  },
  runtimeMarker: process.env.RESUME_RUNTIME_MARKER
})
const toSnakeCase = value => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
const notifyPair = (params) => {
  const kiroUpdate = { ...params.update }
  const acpUpdate = {
    ...kiroUpdate,
    sessionUpdate: toSnakeCase(kiroUpdate.sessionUpdate)
  }
  if (kiroUpdate.content != null) {
    acpUpdate.prompt = kiroUpdate.content
    delete acpUpdate.content
  }
  write({
    jsonrpc: '2.0',
    method: 'session/notification',
    params: { sessionId: params.sessionId, notification: kiroUpdate }
  })
  write({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { session_id: params.sessionId, update: acpUpdate }
  })
}

const reader = createInterface({ input: process.stdin })
let pendingPrompt
const finishPendingPrompt = (reason = 'end_turn') => {
  if (!pendingPrompt) return
  notifyPair({
    sessionId: pendingPrompt.sessionId,
    update: { sessionUpdate: 'TurnEnd' }
  })
  write({ jsonrpc: '2.0', id: pendingPrompt.id, result: { stopReason: reason } })
  pendingPrompt = undefined
}
reader.on('line', (line) => {
  const message = JSON.parse(line)
  log(message)
  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { additionalDirectories: {} }
        },
        agentInfo: { name: 'kiro-cli', version: '9.9.9-test' }
      }
    })
    return
  }
  if (message.method === 'session/new') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        sessionId: 'kiro-native-1',
        ...(sessionModels == null ? {} : { models: sessionModels }),
        ...(sessionConfigOptions == null ? {} : { configOptions: sessionConfigOptions })
      }
    })
    if (behavior === 'exit_idle') setTimeout(() => process.exit(0), 20)
    return
  }
  if (message.method === 'session/load') {
    notifyPair({
      sessionId: message.params.sessionId,
      update: {
        sessionUpdate: 'AgentMessageChunk',
        messageId: 'replay-1',
        content: { type: 'text', text: 'REPLAYED CONTENT' }
      }
    })
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        sessionId: message.params.sessionId,
        ...(sessionModels == null ? {} : { models: sessionModels }),
        ...(sessionConfigOptions == null ? {} : { configOptions: sessionConfigOptions })
      }
    })
    return
  }
  if (message.method === 'session/set_model') {
    if (process.env.FAKE_KIRO_SET_MODEL_ERROR === '1') {
      write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'model rejected' } })
      return
    }
    if (process.env.FAKE_KIRO_SET_MODEL_EMPTY === '1') {
      write({ jsonrpc: '2.0', id: message.id, result: {} })
      return
    }
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        sessionId: message.params.sessionId,
        models: {
          ...sessionModels,
          currentModelId: process.env.FAKE_KIRO_SET_MODEL_ACTIVE ?? message.params.modelId
        }
      }
    })
    return
  }
  if (message.method === 'session/set_config_option') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: process.env.FAKE_KIRO_EFFORT_SETTER_EMPTY === '1'
        ? {}
        : {
          configOptions: [{
            id: message.params.configId,
            options: [{ value: message.params.value }],
            currentValue: process.env.FAKE_KIRO_SET_EFFORT_ACTIVE ?? message.params.value
          }]
        }
    })
    return
  }
  if (message.method === 'session/prompt') {
    if (!Array.isArray(message.params?.content) || message.params.prompt != null) {
      write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'expected Kiro content wire' } })
      return
    }
    if (behavior === 'failure_notification') {
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          session_id: message.params.sessionId,
          update: {
            sessionUpdate: 'unexpected_failure_state',
            prompt: { type: 'text', text: 'private failure payload' }
          }
        }
      })
      return
    }
    if (behavior === 'terminal_late_events') {
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          session_id: message.params.sessionId,
          update: { sessionUpdate: 'terminal_failure' }
        }
      })
      write({
        jsonrpc: '2.0',
        id: 'late-permission',
        method: 'session/request_permission',
        params: {
          sessionId: message.params.sessionId,
          options: [{ optionId: 'allow-once', kind: 'allow_once' }],
          toolCall: { title: 'late_write', kind: 'edit' }
        }
      })
      write({
        jsonrpc: '2.0',
        id: 'late-ask',
        method: 'session/request_input',
        params: { sessionId: message.params.sessionId, question: 'late question' }
      })
      write({
        jsonrpc: '2.0',
        method: 'session/notification',
        params: {
          sessionId: message.params.sessionId,
          notification: { sessionUpdate: 'ConfigOptionUpdate', currentValue: 'late-config' }
        }
      })
      return
    }
    if (behavior === 'exit_during_prompt') process.exit(9)
    if (behavior === 'prompt_inflight') {
      pendingPrompt = { id: message.id, sessionId: message.params.sessionId }
      return
    }
    if (behavior === 'permission') {
      pendingPrompt = { id: message.id, sessionId: message.params.sessionId }
      write({
        jsonrpc: '2.0',
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId: message.params.sessionId,
          toolCall: {
            toolCallId: 'tool-permission-1',
            title: 'write_file',
            kind: 'edit',
            rawInput: { path: 'safe.txt' }
          },
          options: permissionOptions
        }
      })
      return
    }
    notifyPair({
      sessionId: message.params.sessionId,
      update: {
        sessionUpdate: 'ToolCall',
        toolCallId: 'tool-1',
        title: 'read_file',
        rawInput: { path: 'README.md' },
        status: 'in_progress'
      }
    })
    notifyPair({
      sessionId: message.params.sessionId,
      update: {
        sessionUpdate: 'ToolCallUpdate',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: 'contents'
      }
    })
    notifyPair({
      sessionId: message.params.sessionId,
      update: {
        sessionUpdate: 'AgentMessageChunk',
        messageId: 'answer-1',
        content: { type: 'text', text: 'Hello from Kiro' }
      }
    })
    notifyPair({
      sessionId: message.params.sessionId,
      update: { sessionUpdate: 'TurnEnd' }
    })
    write({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })
    return
  }
  if (message.id === 'permission-1' && message.result != null) {
    const selected = message.result?.outcome?.optionId
    finishPendingPrompt(selected?.startsWith('reject') ? 'refused' : 'end_turn')
    return
  }
  if (message.method === 'session/cancel') {
    finishPendingPrompt('cancelled')
  }
})
