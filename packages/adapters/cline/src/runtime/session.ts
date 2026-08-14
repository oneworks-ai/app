/* eslint-disable max-lines -- Cline's private ACP startup, auth, turn, and terminal states must settle together. */
import { spawn } from 'node:child_process'

import { ClientSideConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AuthMethod, InitializeResponse } from '@agentclientprotocol/sdk'
import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import { CLINE_ACP_PROTOCOL_VERSION, CLINE_CLI_VERSION, isClineNativeResumeVersion } from '../paths'
import { CLINE_AMBIGUOUS_EMPTY_TURN_MESSAGE, ClineAcpProjector, isNormalClineEmptyTurn } from './client'
import { createFreshJsonClineSession } from './fresh-json'
import { mapContentToClinePrompt } from './input'
import { prepareClineSession } from './prepare'
import { createClineAcpTransport } from './protocol/transport'
import { ClineRedactor } from './redaction'

const DEFAULT_CLINE_TOOLS = [
  'read_files',
  'search_files',
  'list_files',
  'write_to_file',
  'replace_in_file',
  'run_commands',
  'browser_action',
  'skills',
  'new_task'
]

const VERIFIED_AUTH_METHODS = new Map([
  ['cline', 'Sign in with Cline'],
  ['cline-pass', 'Sign in with ClinePass'],
  ['openai-codex', 'Sign in with ChatGPT Subscription']
])

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (error != null && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message : undefined
    const details = record.data ?? record.error ?? record.details
    if (message != null && details != null) {
      try {
        return `${message}: ${typeof details === 'string' ? details : JSON.stringify(details)}`
      } catch {
        return message
      }
    }
    if (message != null) return message
    try {
      return JSON.stringify(error)
    } catch {
      return 'Cline ACP returned an unreadable error.'
    }
  }
  return String(error)
}
const delay = (timeoutMs: number) => new Promise(resolve => setTimeout(resolve, timeoutMs))

const withTimeout = async <T>(promise: Promise<T>, label: string, timeoutMs = 20_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs)
    })
  ]).finally(() => clearTimeout(timer))
}

export const waitForClineAuthentication = async <T>(
  promise: Promise<T>,
  timeoutMs?: number
): Promise<T> =>
  timeoutMs == null
    ? await promise
    : await withTimeout(promise, 'Cline ACP authenticate', timeoutMs)

export interface ClineAcpGateResult {
  compatible: boolean
  reason?: string
  version?: string
}

export const checkClineAcpGate = (initialize: InitializeResponse): ClineAcpGateResult => {
  const version = initialize.agentInfo?.version
  if (initialize.protocolVersion !== CLINE_ACP_PROTOCOL_VERSION || PROTOCOL_VERSION !== CLINE_ACP_PROTOCOL_VERSION) {
    return { compatible: false, reason: 'Cline ACP protocolVersion is not 1.', version }
  }
  if (initialize.agentInfo?.name !== 'cline') {
    return { compatible: false, reason: 'ACP agentInfo.name is not cline.', version }
  }
  if (initialize.agentCapabilities?.loadSession !== true) {
    return { compatible: false, reason: 'Cline ACP does not advertise loadSession.', version }
  }
  if (!isClineNativeResumeVersion(version)) {
    return {
      compatible: false,
      reason: `Cline ${version ?? 'unknown'} is outside the verified native-resume version ${CLINE_CLI_VERSION}.`,
      version
    }
  }
  return { compatible: true, version }
}

const validateAuthMethods = (authMethods: AuthMethod[]) => {
  const seen = new Set<string>()
  for (const method of authMethods) {
    const record = method as AuthMethod & { type?: string }
    if (seen.has(method.id)) throw new Error(`Cline ACP advertised duplicate authentication method "${method.id}".`)
    seen.add(method.id)
    if (record.type != null && record.type !== 'agent') {
      throw new Error(`Cline ACP authentication method "${method.id}" uses unsupported type "${record.type}".`)
    }
    const verifiedName = VERIFIED_AUTH_METHODS.get(method.id)
    if (verifiedName == null || method.name !== verifiedName) {
      throw new Error(`Cline ACP advertised unverified authentication method "${method.id}".`)
    }
  }
}

interface PendingAuthChoice {
  id: string
  resolve: (methodId?: string) => void
}

export interface ClineRuntimeDependencies {
  authenticationTimeoutMs?: number
  controlTimeoutMs?: number
  gracefulCloseMs?: number
  termCloseMs?: number
}

export const createClineSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  dependencies: ClineRuntimeDependencies = {}
): Promise<AdapterSession> => {
  const prepared = await prepareClineSession(ctx, options)
  const authenticationTimeoutMs = dependencies.authenticationTimeoutMs ?? prepared.authTimeoutMs
  const controlTimeoutMs = dependencies.controlTimeoutMs ?? 20_000
  const gracefulCloseMs = dependencies.gracefulCloseMs ?? 500
  const termCloseMs = dependencies.termCloseMs ?? 1_000
  const redactor = new ClineRedactor(ctx.env)
  redactor.addDiagnosticValue(options.description)
  redactor.addDiagnosticValue(options.systemPrompt)
  const proc = spawn(prepared.binaryPath, prepared.args, {
    cwd: ctx.cwd,
    env: prepared.spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let activeAuthenticationOperationId: string | undefined
  let activeTurn = false
  let delegatedSession: AdapterSession | undefined
  let explicitlyClosing = false
  let pendingAuthChoice: PendingAuthChoice | undefined
  let processClosed = false
  let projector: ClineAcpProjector | undefined
  let ready = false
  let sessionId: string | undefined
  let stderr = ''
  let terminalFailureStarted = false
  let terminalSettled = false
  let transport: ReturnType<typeof createClineAcpTransport> | undefined
  const pendingEvents: AdapterEvent[] = []
  let promptQueue = Promise.resolve()
  let resolveStartupYield: () => void = () => undefined
  let resolveTerminal: () => void = () => undefined
  const startupYield = new Promise<void>(resolve => {
    resolveStartupYield = resolve
  })
  const terminal = new Promise<void>(resolve => {
    resolveTerminal = resolve
  })

  proc.stderr?.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-65_536)
  })
  const processExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    proc.once('close', (code, signal) => {
      processClosed = true
      resolve({ code, signal })
    })
  })
  const spawnError = new Promise<never>((_resolve, reject) => proc.once('error', reject))
  void spawnError.catch(() => undefined)
  const processSpawned = new Promise<void>(resolve => proc.once('spawn', resolve))

  const emitOutput = (event: AdapterOutputEvent) => options.onEvent(redactor.redactEvent(event))
  const settleAuthenticationOperation = (type: 'operation_completed' | 'operation_failed', message: string) => {
    if (activeAuthenticationOperationId == null) return
    const operationId = activeAuthenticationOperationId
    activeAuthenticationOperationId = undefined
    emitOutput({
      type: 'operation',
      data: {
        adapter: 'cline',
        message,
        operationId,
        status: type === 'operation_completed' ? 'completed' : 'failed',
        title: 'Cline authentication',
        type
      }
    })
  }
  const emitExitOnce = (exitCode: number, rawStderr?: string) => {
    if (terminalSettled) return
    terminalSettled = true
    emitOutput({
      type: 'exit',
      data: {
        exitCode,
        ...(rawStderr?.trim() ? { stderr: redactor.redactDiagnostic(rawStderr) } : {})
      }
    })
    resolveTerminal()
    // Startup requests race transport/process failure. Whichever observer emits
    // the terminal event must also release the query caller; otherwise an EOF
    // can settle the event stream while createClineSession waits forever.
    resolveStartupYield()
  }
  const settleInteractions = () => {
    projector?.settlePendingPermissions()
    pendingAuthChoice?.resolve()
    pendingAuthChoice = undefined
    settleAuthenticationOperation('operation_failed', 'Cline authentication was cancelled.')
  }
  const waitForExitFor = async (timeoutMs: number) =>
    await Promise.race([
      processExit.then(() => true),
      delay(timeoutMs).then(() => false)
    ])
  const terminateProcess = async (immediate = false) => {
    if (processClosed) return
    explicitlyClosing = true
    settleInteractions()
    transport?.closeInput()
    if (transport == null && proc.stdin != null && !proc.stdin.destroyed && !proc.stdin.writableEnded) {
      proc.stdin.end()
    }
    if (immediate) {
      proc.kill('SIGKILL')
      await processExit
      return
    }
    if (await waitForExitFor(gracefulCloseMs)) return
    proc.kill('SIGTERM')
    if (await waitForExitFor(termCloseMs)) return
    proc.kill('SIGKILL')
    await processExit
  }
  const failTerminal = (message: string, code = 'cline_acp_failure') => {
    if (terminalSettled || terminalFailureStarted) return
    terminalFailureStarted = true
    const safeMessage = redactor.redactDiagnostic(message)
    emitOutput({ type: 'error', data: { message: safeMessage, code, fatal: true } })
    void terminateProcess().finally(() => emitExitOnce(1, stderr))
  }

  const requestAuthenticationChoice = async (authMethods: AuthMethod[]) => {
    const interactionId = `cline-auth:${uuid()}`
    const choice = new Promise<string | undefined>((resolve) => {
      pendingAuthChoice = { id: interactionId, resolve }
      emitOutput({
        type: 'interaction_request',
        data: {
          id: interactionId,
          payload: {
            sessionId: options.sessionId,
            kind: 'question',
            question: 'Cline requires authorization before this session can start. Choose a verified method.',
            options: authMethods.map(method => ({
              label: method.name,
              value: method.id,
              description: `Authenticate with ${method.name}`
            }))
          }
        }
      })
      // The caller needs the session handle to answer this startup interaction.
      resolveStartupYield()
    })
    const selected = authenticationTimeoutMs == null
      ? await choice
      : await withTimeout(choice, 'Cline ACP authentication choice', authenticationTimeoutMs)
    pendingAuthChoice = undefined
    if (selected == null) throw new Error('Cline ACP authentication was cancelled before session creation.')
    return selected
  }

  const handleInput = (event: AdapterEvent) => {
    if (terminalSettled || explicitlyClosing) return
    if (delegatedSession != null) {
      delegatedSession.emit(event)
      return
    }
    if (!ready) {
      pendingEvents.push(event)
      return
    }
    if (event.type === 'message') enqueue(event)
    else if (event.type === 'interrupt') cancelTurn()
    else stopSession()
  }

  let connection: ClientSideConnection | undefined
  let raceTransport: (<T>(request: Promise<T>) => Promise<T>) | undefined
  const runTurn = async (event: Extract<AdapterEvent, { type: 'message' }>) => {
    if (terminalSettled || explicitlyClosing || sessionId == null || connection == null || raceTransport == null) return
    const prompt = await mapContentToClinePrompt(event.content)
    if (prompt.length === 0) return
    for (const block of prompt) {
      if (block.type === 'text' && block.text.trim()) redactor.addDiagnosticValue(block.text)
    }
    activeTurn = true
    projector!.startTurn()
    try {
      const response = await raceTransport(connection.prompt({ sessionId, prompt }))
      const turn = projector!.finishTurn(response)
      activeTurn = false
      if (
        turn.stopReason === 'end_turn' && turn.deliverableCount === 0 &&
        !isNormalClineEmptyTurn(turn.stopReason)
      ) {
        failTerminal(CLINE_AMBIGUOUS_EMPTY_TURN_MESSAGE, 'cline_ambiguous_empty_turn')
        return
      }
      if (turn.stopReason === 'cancelled') {
        emitOutput({ type: 'stop' })
        return
      }
      if (turn.stopReason !== 'end_turn') {
        failTerminal(`Cline ACP stopped the turn with reason ${turn.stopReason}.`, `cline_${turn.stopReason}`)
        return
      }
      emitOutput({ type: 'stop' })
    } catch (error) {
      activeTurn = false
      if (terminalSettled || explicitlyClosing) return
      failTerminal(getErrorMessage(error), 'cline_prompt_failure')
    }
  }
  const enqueue = (event: Extract<AdapterEvent, { type: 'message' }>) => {
    promptQueue = promptQueue.catch(() => undefined).then(() => runTurn(event))
  }
  const cancelTurn = () => {
    if (sessionId == null || terminalSettled || explicitlyClosing || connection == null || raceTransport == null) return
    projector?.settlePendingPermissions()
    if (activeTurn) {
      void raceTransport(connection.cancel({ sessionId })).catch(error => {
        if (!terminalSettled && !explicitlyClosing) failTerminal(getErrorMessage(error), 'cline_cancel_failure')
      })
    }
  }
  const stopSession = () => {
    if (terminalSettled || explicitlyClosing) return
    explicitlyClosing = true
    settleInteractions()
    void (async () => {
      if (activeTurn && connection != null && raceTransport != null && sessionId != null) {
        await Promise.race([
          raceTransport(connection.cancel({ sessionId })).catch(() => undefined),
          delay(Math.min(controlTimeoutMs, 500))
        ])
      }
      await terminateProcess()
      emitExitOnce(0, stderr)
    })()
  }

  const session: AdapterSession = {
    kill: () => {
      if (terminalSettled || explicitlyClosing) return
      explicitlyClosing = true
      settleInteractions()
      delegatedSession?.kill()
      if (delegatedSession == null) {
        void terminateProcess(true).finally(() => emitExitOnce(1, stderr))
      }
    },
    stop: () => {
      if (delegatedSession?.stop != null) {
        delegatedSession.stop()
        return
      }
      stopSession()
    },
    emit: handleInput,
    respondInteraction: (interactionId, data) => {
      if (pendingAuthChoice?.id === interactionId) {
        const selected = Array.isArray(data) ? data[0] : data
        const resolve = pendingAuthChoice.resolve
        pendingAuthChoice = undefined
        resolve(typeof selected === 'string' && VERIFIED_AUTH_METHODS.has(selected) ? selected : undefined)
        return
      }
      if (delegatedSession?.respondInteraction != null) {
        return delegatedSession.respondInteraction(interactionId, data)
      }
      projector?.respond(interactionId, data)
    },
    get pid() {
      return delegatedSession?.pid ?? proc.pid
    }
  }

  void (async () => {
    try {
      await Promise.race([processSpawned, spawnError])
      if (proc.stdin == null || proc.stdout == null) throw new Error('Cline ACP stdio was not created.')
      projector = new ClineAcpProjector(options, emitOutput)
      transport = createClineAcpTransport(proc)
      connection = new ClientSideConnection(() => projector!.client, transport.stream)
      raceTransport = <T>(request: Promise<T>) => Promise.race([request, transport!.failure, spawnError])
      const initialize = await withTimeout(
        raceTransport(connection.initialize({
          protocolVersion: CLINE_ACP_PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          clientInfo: { name: 'oneworks-cline-adapter', version: '1.0.0' }
        })),
        'Cline ACP initialize',
        controlTimeoutMs
      )
      const gate = checkClineAcpGate(initialize)
      if (!gate.compatible) {
        await terminateProcess()
        // Closing the rejected ACP child is not itself a request to close the
        // adapter lifecycle; the next branch either fails or starts fresh JSON.
        explicitlyClosing = false
        if (prepared.source === 'managed') {
          throw new Error(`Managed Cline ACP compatibility gate failed: ${gate.reason}`)
        }
        emitOutput({
          type: 'error',
          data: {
            message: `${gate.reason} Native resume is disabled; this session uses fresh-only Cline --json.`,
            code: 'cline_fresh_only_fallback',
            fatal: false
          }
        })
        const fresh = createFreshJsonClineSession(
          prepared,
          { ...options, description: undefined },
          emitOutput,
          redactor
        )
        delegatedSession = fresh
        emitOutput({
          type: 'init',
          data: {
            uuid: options.sessionId,
            adapter: 'cline',
            model: options.model ?? 'default',
            effort: options.effort,
            version: gate.version ?? 'unknown',
            tools: DEFAULT_CLINE_TOOLS,
            slashCommands: [],
            cwd: ctx.cwd,
            agents: ['cline'],
            assetDiagnostics: options.assetPlan?.diagnostics
          }
        })
        if (options.description?.trim()) {
          fresh.emit({ type: 'message', content: [{ type: 'text', text: options.description }] })
        }
        for (const event of pendingEvents.splice(0)) fresh.emit(event)
        resolveStartupYield()
        return
      }

      const authMethods = initialize.authMethods ?? []
      validateAuthMethods(authMethods)
      const cached = options.type === 'resume' ? await ctx.cache.get('adapter.cline.session') : undefined
      let authenticatedMethodId: string | undefined
      if (prepared.credentialMode !== 'cline-api-key' && authMethods.length > 0) {
        const methodId = prepared.authMethod ?? cached?.authenticatedMethodId ??
          await requestAuthenticationChoice(authMethods)
        if (!authMethods.some(method => method.id === methodId)) {
          throw new Error(`Configured Cline ACP authentication method "${methodId}" was not advertised.`)
        }
        activeAuthenticationOperationId = `cline-authenticate:${uuid()}`
        emitOutput({
          type: 'operation',
          data: {
            adapter: 'cline',
            message: 'Complete the selected Cline authorization flow. You can stop the task to cancel.',
            operationId: activeAuthenticationOperationId,
            status: 'waiting_for_user',
            title: 'Cline authentication',
            type: 'operation_started'
          }
        })
        // Configured and cached methods do not emit a choice interaction. Yield
        // the handle before the human-owned OAuth wait so stop/kill remains usable.
        resolveStartupYield()
        try {
          await waitForClineAuthentication(
            raceTransport(connection.authenticate({ methodId })),
            authenticationTimeoutMs
          )
          settleAuthenticationOperation('operation_completed', 'Cline authentication completed.')
        } catch (error) {
          settleAuthenticationOperation('operation_failed', getErrorMessage(error))
          throw error
        }
        authenticatedMethodId = methodId
      } else if (prepared.credentialMode === 'cline-api-key' && prepared.authMethod != null) {
        throw new Error('Cline API-key process credentials and ACP authMethod cannot be used together.')
      } else if (prepared.authMethod != null) {
        throw new Error(
          `Configured Cline ACP authentication method "${prepared.authMethod}" was not advertised.`
        )
      } else if (prepared.credentialMode === 'native-provider') {
        throw new Error(
          'Selected Cline native provider credentials require a verified ACP authentication method, but none was advertised.'
        )
      }

      if (options.type === 'resume' && cached?.nativeSessionId != null) {
        projector.startReplay()
        try {
          await withTimeout(
            raceTransport(connection.loadSession({
              sessionId: cached.nativeSessionId,
              cwd: ctx.cwd,
              mcpServers: []
            })),
            'Cline ACP loadSession',
            controlTimeoutMs
          )
          sessionId = cached.nativeSessionId
        } finally {
          projector.finishReplay()
        }
      } else {
        if (options.type === 'resume') {
          emitOutput({
            type: 'error',
            data: {
              message: 'No cached native Cline session id was available; starting a fresh native ACP session.',
              code: 'cline_resume_id_missing',
              fatal: false
            }
          })
        }
        const created = await withTimeout(
          raceTransport(connection.newSession({ cwd: ctx.cwd, mcpServers: [] })),
          'Cline ACP newSession',
          controlTimeoutMs
        )
        sessionId = created.sessionId
      }
      await ctx.cache.set('adapter.cline.session', {
        ...(authenticatedMethodId == null ? {} : { authenticatedMethodId }),
        nativeSessionId: sessionId,
        protocolVersion: initialize.protocolVersion,
        version: initialize.agentInfo?.version
      })

      emitOutput({
        type: 'init',
        data: {
          uuid: options.sessionId,
          adapter: 'cline',
          model: options.model ?? 'default',
          effort: options.effort,
          version: initialize.agentInfo?.version ?? CLINE_CLI_VERSION,
          tools: DEFAULT_CLINE_TOOLS,
          slashCommands: [],
          cwd: ctx.cwd,
          agents: ['cline'],
          assetDiagnostics: options.assetPlan?.diagnostics
        }
      })
      if (options.appendSystemPrompt === false && options.systemPrompt?.trim()) {
        emitOutput({
          type: 'error',
          data: {
            message:
              'Cline applies the One Works system prompt as an additional native rule; rule replacement is unsupported.',
            code: 'cline_system_prompt_append_only',
            fatal: false
          }
        })
      }
      ready = true
      resolveStartupYield()
      if (options.description?.trim()) {
        enqueue({ type: 'message', content: [{ type: 'text', text: options.description }] })
      }
      for (const event of pendingEvents.splice(0)) handleInput(event)
    } catch (error) {
      if (terminalSettled || explicitlyClosing) return
      failTerminal(getErrorMessage(error), 'cline_acp_startup')
      await terminal
      resolveStartupYield()
    }
  })()

  void processExit.then(({ code }) => {
    if (terminalSettled || explicitlyClosing) return
    settleInteractions()
    const message = activeTurn
      ? 'Cline ACP reached EOF before the active turn settled.'
      : `Cline ACP exited unexpectedly with code ${code ?? 'unknown'}.`
    if (!terminalFailureStarted) {
      terminalFailureStarted = true
      emitOutput({ type: 'error', data: { message, code: 'cline_acp_eof', fatal: true } })
    }
    emitExitOnce(code && code !== 0 ? code : 1, stderr)
  })

  await startupYield
  return session
}
