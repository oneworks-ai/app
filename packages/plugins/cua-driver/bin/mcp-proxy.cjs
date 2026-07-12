#!/usr/bin/env node
/* eslint-disable max-lines -- the transport keeps JSON-RPC routing and its safety boundary together. */
const { spawn } = require('node:child_process')
const { resolve } = require('node:path')
const process = require('node:process')

const {
  createSessionCursorController,
  pointerActionTools,
  sessionCursorStartToolDefinition,
  sessionCursorStartToolResult,
  sessionCursorToolDefinition,
  sessionCursorToolResult
} = require('./cursor-runtime.cjs')
const {
  createWorkflowService,
  workflowToolDefinitions,
  workflowToolNames
} = require('./workflow-runtime.cjs')

const sessionCursorToolDefinitions = [
  sessionCursorToolDefinition,
  sessionCursorStartToolDefinition
]
const sessionCursorToolNames = new Set(sessionCursorToolDefinitions.map(tool => tool.name))

const allowedTools = new Set([
  'click',
  'double_click',
  'get_agent_cursor_state',
  'get_config',
  'get_screen_size',
  'get_window_state',
  'launch_app',
  'list_apps',
  'list_windows',
  'press_key',
  'right_click',
  'screenshot',
  'scroll',
  'set_value',
  'type_text',
  'zoom'
])

function requestKey(id) {
  return id == null ? undefined : JSON.stringify(id)
}

function isMessage(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data == null ? {} : { data })
    }
  }
}

function parseJsonLine(line) {
  try {
    return { ok: true, value: JSON.parse(line) }
  } catch {
    return { ok: false, error: errorResponse(null, -32700, 'Malformed JSON received by the OneWorks CUA MCP proxy.') }
  }
}

function parseRecoveryFromOutput(output) {
  const permissionLine = output
    .split(/\r?\n/)
    .find(line => line.includes('[cua-driver] permission-required:'))
  if (permissionLine != null) {
    return {
      kind: 'macos-permissions',
      missingPermissions: permissionLine
        .slice(permissionLine.indexOf(':') + 1)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      settingsPath: 'System Settings → Privacy & Security',
      retryOriginalTask: true
    }
  }
  return { kind: 'runtime-retry', retryOriginalTask: true }
}

function initializeFailureResponse(id, diagnosticOutput) {
  const recovery = parseRecoveryFromOutput(diagnosticOutput)
  return errorResponse(
    id,
    -32001,
    recovery.kind === 'macos-permissions'
      ? 'Computer control needs macOS permission before it can continue.'
      : 'Computer control could not start. Retry the original task.',
    recovery
  )
}

function toolCallPolicyError(toolName, toolArguments) {
  if (
    typeof toolName === 'string' &&
    (workflowToolNames.has(toolName) || sessionCursorToolNames.has(toolName))
  ) return
  if (typeof toolName !== 'string' || !allowedTools.has(toolName)) {
    return `Tool ${
      typeof toolName === 'string' ? toolName : '(unknown)'
    } is not exposed by the OneWorks CUA safety profile.`
  }
  if (toolName === 'press_key' && toolArguments?.window_id != null) {
    return 'press_key with window_id is not exposed because it can activate the target application.'
  }
}

function transformClientMessage(message, pendingToolLists) {
  if (!isMessage(message)) {
    return {
      respond: errorResponse(
        null,
        -32600,
        'JSON-RPC batch and non-object requests are not accepted by the OneWorks CUA MCP proxy.'
      )
    }
  }
  if (message?.method === 'tools/list') {
    const key = requestKey(message.id)
    if (key != null) pendingToolLists.add(key)
  }
  if (message?.method !== 'tools/call') return { forward: message }

  const toolName = message.params?.name
  if (
    typeof toolName === 'string' &&
    (workflowToolNames.has(toolName) || sessionCursorToolNames.has(toolName))
  ) {
    return {
      localCall: {
        arguments: isMessage(message.params?.arguments) ? message.params.arguments : {},
        id: message.id ?? null,
        jsonrpc: typeof message.jsonrpc === 'string' ? message.jsonrpc : '2.0',
        name: toolName
      }
    }
  }
  const policyError = toolCallPolicyError(toolName, message.params?.arguments)
  if (policyError == null) {
    if (pointerActionTools.has(toolName)) {
      return {
        styledCall: {
          arguments: isMessage(message.params?.arguments) ? message.params.arguments : {},
          id: message.id ?? null,
          jsonrpc: typeof message.jsonrpc === 'string' ? message.jsonrpc : '2.0',
          name: toolName
        }
      }
    }
    return { forward: message }
  }
  return {
    respond: {
      jsonrpc: typeof message?.jsonrpc === 'string' ? message.jsonrpc : '2.0',
      id: message?.id ?? null,
      error: {
        code: -32601,
        message: policyError
      }
    }
  }
}

function transformServerMessage(message, pendingToolLists) {
  if (!isMessage(message)) throw new TypeError('The Cua Driver MCP server emitted a non-object JSON-RPC message.')
  const key = requestKey(message?.id)
  if (key == null || !pendingToolLists.delete(key)) return message
  if (!Array.isArray(message?.result?.tools)) return message
  return {
    ...message,
    result: {
      ...message.result,
      tools: [
        ...message.result.tools.filter(tool => allowedTools.has(tool?.name)),
        ...workflowToolDefinitions,
        ...sessionCursorToolDefinitions
      ]
    }
  }
}

function createLineReader(onLine) {
  let buffered = ''
  return {
    push(chunk) {
      buffered += chunk.toString('utf8')
      while (true) {
        const newline = buffered.indexOf('\n')
        if (newline < 0) break
        const line = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        onLine(line)
      }
    },
    end() {
      if (buffered !== '') onLine(buffered)
      buffered = ''
    }
  }
}

function writeJson(stream, message) {
  stream.write(`${JSON.stringify(message)}\n`)
}

function createSerialTaskQueue() {
  let tail = Promise.resolve()
  return (task) => {
    const result = tail.then(task, task)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

function main() {
  const wrapperPath = resolve(__dirname, 'cua-driver.cjs')
  const child = spawn(process.execPath, [wrapperPath, 'mcp'], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pendingToolLists = new Set()
  let pendingInitializeId
  let initializeCompleted = false
  let stopping = false
  let diagnosticOutput = ''
  let internalCallSequence = 0
  const pendingDriverCalls = new Map()
  const callDriverTool = (name, args) =>
    new Promise((resolveCall, rejectCall) => {
      const id = `oneworks-workflow-${internalCallSequence += 1}`
      const key = requestKey(id)
      const timeout = setTimeout(() => {
        pendingDriverCalls.delete(key)
        const error = new Error(`Cua Driver tool ${name} timed out.`)
        error.code = 'DRIVER_TOOL_TIMEOUT'
        rejectCall(error)
      }, 65000)
      pendingDriverCalls.set(key, {
        reject(error) {
          clearTimeout(timeout)
          rejectCall(error)
        },
        resolve(value) {
          clearTimeout(timeout)
          resolveCall(value)
        }
      })
      writeJson(child.stdin, {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args }
      })
    })
  const sessionId = process.env.__ONEWORKS_PROJECT_SESSION_ID__ ??
    process.env.__ONEWORKS_CODEX_TASK_SESSION_ID__ ??
    `process-${process.pid}`
  const cursorController = createSessionCursorController({
    callTool: callDriverTool,
    defaultColor: process.env.ONEWORKS_CUA_DEFAULT_CURSOR_COLOR,
    sessionId,
    strategy: process.env.ONEWORKS_CUA_CURSOR_STRATEGY
  })
  const workflowService = createWorkflowService({
    callTool: (name, args, actionStyle) => cursorController.callTool(name, args, actionStyle)
  })
  const enqueueSessionOperation = createSerialTaskQueue()
  const stopForProtocolError = (response) => {
    if (stopping) return
    stopping = true
    writeJson(process.stdout, response)
    process.stdin.pause()
    child.stdin.end()
    child.kill('SIGTERM')
  }
  const clientReader = createLineReader((line) => {
    if (line.trim() === '' || stopping) return
    const parsed = parseJsonLine(line)
    if (!parsed.ok) return stopForProtocolError(parsed.error)
    if (isMessage(parsed.value) && parsed.value.method === 'initialize') {
      pendingInitializeId = parsed.value.id
    }
    const transformed = transformClientMessage(parsed.value, pendingToolLists)
    if (transformed.respond != null) return writeJson(process.stdout, transformed.respond)
    if (transformed.localCall != null) {
      const call = transformed.localCall
      const executeLocalCall = async () => {
        if (sessionCursorToolNames.has(call.name)) {
          try {
            const isStartCall = call.name === sessionCursorStartToolDefinition.name
            const state = isStartCall
              ? cursorController.setStartPosition(call.arguments)
              : cursorController.setColor(call.arguments.color)
            return isStartCall
              ? sessionCursorStartToolResult(state)
              : sessionCursorToolResult(state)
          } catch (error) {
            error.rpcCode = -32602
            throw error
          }
        }
        return await workflowService.call(call.name, call.arguments)
      }
      const shouldSerialize = sessionCursorToolNames.has(call.name)
      const operation = shouldSerialize
        ? enqueueSessionOperation(executeLocalCall)
        : executeLocalCall()
      operation.then(result => {
        writeJson(process.stdout, {
          jsonrpc: call.jsonrpc,
          id: call.id,
          result
        })
      }).catch(error => {
        writeJson(
          process.stdout,
          errorResponse(
            call.id,
            error.rpcCode ?? -32603,
            error.message
          )
        )
      })
      return
    }
    if (transformed.styledCall != null) {
      const call = transformed.styledCall
      enqueueSessionOperation(
        () => cursorController.callTool(call.name, call.arguments)
      ).then(result => {
        writeJson(process.stdout, {
          jsonrpc: call.jsonrpc,
          id: call.id,
          result
        })
      }).catch(error => {
        writeJson(process.stdout, errorResponse(call.id, -32603, error.message))
      })
      return
    }
    writeJson(child.stdin, transformed.forward)
  })
  const serverReader = createLineReader((line) => {
    if (line.trim() === '' || stopping) return
    const parsed = parseJsonLine(line)
    if (!parsed.ok) {
      return stopForProtocolError(errorResponse(
        pendingInitializeId,
        -32603,
        'The computer-control service emitted invalid MCP output.',
        parseRecoveryFromOutput(diagnosticOutput)
      ))
    }
    const internalKey = requestKey(parsed.value?.id)
    const pendingDriverCall = internalKey == null ? undefined : pendingDriverCalls.get(internalKey)
    if (pendingDriverCall != null) {
      pendingDriverCalls.delete(internalKey)
      if (parsed.value?.error != null) {
        const error = new Error(parsed.value.error.message ?? 'Cua Driver tool call failed.')
        error.code = parsed.value.error.code ?? 'DRIVER_TOOL_FAILED'
        pendingDriverCall.reject(error)
      } else pendingDriverCall.resolve(parsed.value?.result)
      return
    }
    let transformed
    try {
      transformed = transformServerMessage(parsed.value, pendingToolLists)
    } catch (error) {
      return stopForProtocolError(errorResponse(
        pendingInitializeId,
        -32603,
        error.message,
        parseRecoveryFromOutput(diagnosticOutput)
      ))
    }
    if (
      pendingInitializeId !== undefined &&
      requestKey(transformed.id) === requestKey(pendingInitializeId)
    ) initializeCompleted = true
    writeJson(process.stdout, transformed)
  })

  process.stdin.on('data', chunk => clientReader.push(chunk))
  process.stdin.on('end', () => {
    clientReader.end()
    child.stdin.end()
  })
  child.stdout.on('data', chunk => serverReader.push(chunk))
  child.stdout.on('end', () => serverReader.end())
  child.stderr.on('data', chunk => {
    const text = chunk.toString('utf8')
    diagnosticOutput = `${diagnosticOutput}${text}`.slice(-64 * 1024)
    process.stderr.write(text)
  })
  child.once('error', (error) => {
    process.stdin.pause()
    console.error(`[cua-driver] MCP proxy failed: ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    for (const pending of pendingDriverCalls.values()) {
      pending.reject(new Error('Cua Driver stopped before the workflow step completed.'))
    }
    pendingDriverCalls.clear()
    process.stdin.pause()
    if (!stopping && !initializeCompleted && pendingInitializeId != null) {
      writeJson(process.stdout, initializeFailureResponse(pendingInitializeId, diagnosticOutput))
    }
    if (signal != null) process.exitCode = 1
    else process.exitCode = code ?? 1
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      stopping = true
      process.stdin.pause()
      child.kill(signal)
    })
  }
}

module.exports = {
  allowedTools,
  createSerialTaskQueue,
  initializeFailureResponse,
  parseJsonLine,
  parseRecoveryFromOutput,
  toolCallPolicyError,
  transformClientMessage,
  transformServerMessage,
  sessionCursorStartToolDefinition,
  sessionCursorToolDefinition,
  sessionCursorToolDefinitions,
  sessionCursorToolNames,
  workflowToolDefinitions,
  workflowToolNames
}

if (require.main === module) main()
