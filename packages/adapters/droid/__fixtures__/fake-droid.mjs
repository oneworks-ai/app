#!NODE_EXECUTABLE_PLACEHOLDER
/* eslint-disable max-lines -- one fake peer owns the full JSON-RPC lifecycle fixture. */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'

const API = '1.0.0'
const PROTOCOL = '1.151.0'
const nativeSessionId = 'factory-native-session-1'
const credentialShaped = 'factory_live_credentialshaped123456789'
const statePath = join(process.env.HOME, '.factory', 'sessions', '-fixture-project', `${nativeSessionId}.jsonl`)
let buffer = ''
let messageRequests = 0
let turn = 0

if (process.env.FAKE_DROID_ECHO_AUTH_STDERR === '1') {
  process.stderr.write(`auth=${process.env.FACTORY_API_KEY}\n`)
}

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const base = type => ({
  jsonrpc: '2.0',
  type,
  factoryApiVersion: API,
  factoryProtocolVersion: PROTOCOL
})
const record = async value => {
  if (process.env.FAKE_DROID_LOG) {
    await appendFile(
      process.env.FAKE_DROID_LOG,
      `${
        JSON.stringify({
          ...value,
          processCwd: process.cwd(),
          hookRuntime: process.env.__ONEWORKS_DROID_HOOK_RUNTIME__,
          hookSessionId: process.env.__ONEWORKS_DROID_TASK_SESSION_ID__
        })
      }\n`
    )
  }
}
const response = (request, result) => send({ ...base('response'), id: request.id, result })
const errorResponse = (request, error) => send({ ...base('response'), id: request.id, error })
const requestPermission = () =>
  send({
    ...base('request'),
    id: 'fake-permission-1',
    method: 'droid.request_permission',
    params: {
      toolUses: [{ toolUse: { type: 'tool_use', id: 'pending-tool', name: 'Write', input: {} } }],
      options: [{ label: 'Proceed once', value: 'proceed_once' }, { label: 'Cancel', value: 'cancel' }]
    }
  })
const askUser = () =>
  send({
    ...base('request'),
    id: 'fake-ask-user-1',
    method: 'droid.ask_user',
    params: {
      toolCallId: 'fake-ask-user-tool-1',
      questions: [{
        index: 1,
        topic: 'Targets',
        question: 'Which targets?',
        options: ['runtime', 'history'],
        multiSelect: true
      }]
    }
  })
const notification = value =>
  send({
    ...base('notification'),
    method: 'droid.session_notification',
    params: { sessionId: nativeSessionId, notification: value }
  })

const initialize = async (request) => {
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(
    statePath,
    `${
      [
        JSON.stringify({
          type: 'session_start',
          sessionId: nativeSessionId,
          title: 'Fake Droid',
          cwd: request.params.cwd
        }),
        JSON.stringify({
          id: 'seed-user',
          role: 'user',
          content: [{ type: 'text', text: 'seed' }],
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      ].join('\n')
    }\n`
  )
  response(request, {
    sessionId: nativeSessionId,
    session: {
      messages: [],
      title: process.env.FAKE_DROID_SECRET_TITLE === '1'
        ? `SNAPSHOT_USEFUL ${process.env.FACTORY_API_KEY} ${credentialShaped}`
        : 'Fake Droid'
    },
    settings: { modelId: 'fake-model', reasoningEffort: 'high' }
  })
}

const load = async (request) => {
  if (process.env.FAKE_DROID_FAIL_LOAD === '1') {
    errorResponse(request, { code: -32004, message: 'native session not found' })
    return
  }
  await readFile(statePath, 'utf8')
  if (request.params.sessionId !== nativeSessionId) throw new Error('unexpected native session id')
  response(request, {
    sessionId: process.env.FAKE_DROID_MISMATCH_LOAD === '1' ? 'different-native-session' : nativeSessionId,
    session: {
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'TURN_1_OK' }],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }],
      title: 'Fake Droid resumed'
    },
    settings: { modelId: 'fake-model', reasoningEffort: 'high' }
  })
}

const emitTurn = (turnNumber) => {
  const messageId = `assistant-${turnNumber}`
  const toolId = `tool-${turnNumber}`
  notification({ type: 'assistant_text_delta', messageId, blockIndex: 0, textDelta: `TURN_${turnNumber}_OK` })
  notification({ type: 'assistant_text_complete', messageId, blockIndex: 0 })
  notification({
    type: 'create_message',
    message: {
      id: messageId,
      role: 'assistant',
      content: [{ type: 'text', text: `TURN_${turnNumber}_OK` }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  })
  notification({
    type: 'tool_call',
    toolUse: { type: 'tool_use', id: toolId, name: 'Read', input: { path: 'README.md' } }
  })
  notification({ type: 'tool_result', messageId, toolUseId: toolId, content: 'ok', isError: false })
  notification({
    type: 'session_token_usage_changed',
    sessionId: nativeSessionId,
    tokenUsage: { inputTokens: 4, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 1, thinkingTokens: 0 }
  })
  const terminal = {
    type: 'agent_turn_completed',
    reason: 'completed',
    turnId: `turn-${turnNumber}`,
    tokenUsage: { inputTokens: 4, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 1, thinkingTokens: 0 }
  }
  notification(terminal)
  notification(terminal)
}

const completeTurn = (request) => {
  turn += 1
  response(request, {})
  emitTurn(turn)
}

const queuedTurns = []

const handle = async (request) => {
  await record(request)
  if (request.type === 'response' && request.id === 'fake-ask-user-1') {
    const answer = request.result?.answers?.[0]
    const expected = process.env.FAKE_DROID_EXPECT_ASK_USER_ANSWER ?? 'runtime, history, custom target'
    if (
      request.error != null ||
      request.result?.cancelled === true ||
      request.result?.answers?.length !== 1 ||
      answer?.index !== 1 ||
      answer?.question !== 'Which targets?' ||
      answer?.answer !== expected
    ) {
      process.stderr.write(`unexpected ask_user response: ${JSON.stringify(request)}\n`)
      process.exit(3)
      return
    }
    emitTurn(1)
  } else if (request.method === 'droid.initialize_session') await initialize(request)
  else if (request.method === 'droid.load_session') await load(request)
  else if (request.method === 'droid.add_user_message') {
    messageRequests += 1
    if (
      process.env.FAKE_DROID_RPC_ERROR_ON_MESSAGE === '1' ||
      messageRequests === Number(process.env.FAKE_DROID_FAIL_MESSAGE_NUMBER)
    ) {
      errorResponse(request, {
        code: -32_001,
        message: `PEER_RPC_USEFUL ${process.env.FACTORY_API_KEY}`,
        data: { token: credentialShaped }
      })
    } else if (process.env.FAKE_DROID_MALFORMED_ON_MESSAGE === '1') {
      process.stdout.write(
        `{"context":"MALFORMED_USEFUL ${process.env.FACTORY_TOKEN}","token":"${credentialShaped}"`
      )
      setTimeout(() => process.exit(17), 10)
    } else if (process.env.FAKE_DROID_PERMISSION_ON_MESSAGE === '1') requestPermission()
    else if (process.env.FAKE_DROID_ASK_USER_ON_MESSAGE === '1') {
      response(request, {})
      askUser()
    } else if (Number(process.env.FAKE_DROID_QUEUE_TURNS) > 0) {
      turn += 1
      queuedTurns.push(turn)
      response(request, {})
      if (queuedTurns.length >= Number(process.env.FAKE_DROID_QUEUE_TURNS)) {
        queuedTurns.splice(0).forEach(emitTurn)
      }
    } else completeTurn(request)
  } else if (request.method === 'droid.interrupt_session') {
    if (process.env.FAKE_DROID_INTERRUPT_ERROR === '1') {
      errorResponse(request, {
        code: -32_003,
        message: `INTERRUPT_USEFUL ${process.env.FACTORY_TOKEN}`,
        data: { token: credentialShaped }
      })
    } else response(request, {})
  } else if (request.method === 'droid.close_session') {
    if (process.env.FAKE_DROID_CLOSE_ERROR === '1') {
      process.stderr.write(
        `CLOSE_STDERR_USEFUL ${process.env.FACTORY_API_KEY} Authorization: Bearer ${credentialShaped}\n`
      )
      errorResponse(request, {
        code: -32_002,
        message: `CLOSE_REASON_USEFUL ${process.env.FACTORY_TOKEN}`,
        data: { api_key: credentialShaped }
      })
    } else {
      response(request, {})
      setTimeout(() => process.exit(0), 10)
    }
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim()) {
      void handle(JSON.parse(line)).catch((error) => {
        process.stderr.write(String(error))
        process.exit(2)
      })
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
