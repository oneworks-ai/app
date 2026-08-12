/* eslint-disable max-lines -- account-attempt coordination keeps session stickiness and cleanup atomic. */
import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions } from '@oneworks/types'
import { createStartupProfiler } from '@oneworks/utils'

import {
  classifyCodexAccountPoolFailure,
  markCodexAccountPoolFailure,
  resolveCodexAccountPoolCandidates
} from './accounts'
import type { CodexAccountPoolCandidate } from './accounts'
import { createDirectCodexSession } from './direct'
import { releaseCodexProxyMeta } from './proxy'
import { resolveSessionBase } from './session-common'
import type { CodexSessionBase } from './session-common'
import { createStreamCodexSession } from './stream'
import { createCodexTranscriptHookWatcher } from './transcript-hooks'

interface ActiveCodexSession {
  kill: () => void
  emit: (event: AdapterEvent) => void
  pid?: number
  respondInteraction?: (interactionId: string, data: string | string[]) => void
}

const commitsInitialTurn = (event: AdapterOutputEvent) => (
  event.type === 'message' ||
  event.type === 'interaction_request' ||
  event.type === 'stop' ||
  event.type === 'error' ||
  event.type === 'exit'
)

const buildInitEvent = (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  base: CodexSessionBase
): AdapterOutputEvent => ({
  type: 'init',
  data: {
    uuid: options.sessionId,
    model: base.resolvedModel ?? options.model ?? 'default',
    account: base.resolvedAccount,
    effort: base.effectiveEffort,
    fastMode: options.fastMode,
    version: 'unknown',
    tools: [],
    slashCommands: [],
    cwd: ctx.cwd,
    agents: [],
    assetDiagnostics: options.assetPlan?.diagnostics
  }
})

/**
 * Creates a Codex session. Automatic account selection is session-sticky: only
 * a new stream session may retry another account, and only before its first
 * assistant/tool/approval/terminal event is committed.
 */
export const createCodexSession = async (ctx: AdapterCtx, options: AdapterQueryOptions) => {
  const startupProfiler = createStartupProfiler({
    config: ctx.configState?.mergedConfig,
    cwd: ctx.cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId: options.sessionId
  })
  const modelHealthKey = options.model
  const pool = options.account == null && options.type === 'create'
    ? await resolveCodexAccountPoolCandidates(ctx, modelHealthKey)
    : { enabled: false, candidates: [] as CodexAccountPoolCandidate[], cooldownMs: 0 }
  if (pool.enabled && pool.candidates.length === 0) {
    const retryHint = pool.retryAt == null ? '' : ` Earliest retry: ${new Date(pool.retryAt).toISOString()}.`
    throw new Error(`No healthy Codex account is available in the automatic account pool.${retryHint}`)
  }

  const candidates: Array<CodexAccountPoolCandidate | undefined> = pool.enabled
    ? pool.candidates
    : [undefined]
  const supportsFailover = pool.enabled && options.mode !== 'direct' && options.description?.trim() !== ''
  let activeSession: ActiveCodexSession | undefined
  let activeCleanup: (() => void) | undefined
  let killed = false
  let attemptGeneration = 0

  const reportAsyncFailure = (error: unknown) => {
    if (killed) return
    const message = error instanceof Error ? error.message : String(error)
    options.onEvent({
      type: 'error',
      data: { message, details: error, fatal: true }
    })
    options.onEvent({ type: 'exit', data: { exitCode: 1, stderr: message } })
  }

  const startFromCandidate = async (startIndex: number): Promise<void> => {
    if (killed) return
    let lastError: unknown
    for (let candidateIndex = startIndex; candidateIndex < candidates.length; candidateIndex += 1) {
      if (killed) return
      const candidate = candidates[candidateIndex]
      const generation = ++attemptGeneration
      const attemptOptions: AdapterQueryOptions = {
        ...options,
        ...(candidate == null ? {} : { account: candidate.key })
      }
      const sessionBaseStartedAt = startupProfiler.now()
      let base: CodexSessionBase
      try {
        base = await resolveSessionBase(ctx, attemptOptions)
      } catch (error) {
        lastError = error
        const classification = candidate == null
          ? undefined
          : classifyCodexAccountPoolFailure(error, pool.cooldownMs)
        if (candidate == null || classification == null) throw error
        await markCodexAccountPoolFailure({
          ctx,
          candidate,
          model: modelHealthKey,
          ...classification
        })
        if (candidateIndex >= candidates.length - 1) throw error
        continue
      }
      startupProfiler.mark('codex.session.resolveSessionBase', sessionBaseStartedAt)

      let didCleanup = false
      let transcriptHookWatcher: ReturnType<typeof createCodexTranscriptHookWatcher> | undefined
      const cleanup = () => {
        if (didCleanup) return
        didCleanup = true
        transcriptHookWatcher?.stop()
        for (const routeId of base.proxyRouteTokens) releaseCodexProxyMeta(routeId)
      }
      if (killed || generation !== attemptGeneration) {
        cleanup()
        return
      }
      let initEmitted = false
      let bufferedEvents: AdapterOutputEvent[] = []
      const emitInitAndBufferedEvents = () => {
        if (initEmitted) return
        initEmitted = true
        options.onEvent(buildInitEvent(ctx, attemptOptions, base))
        for (const event of bufferedEvents) options.onEvent(event)
        bufferedEvents = []
      }
      const wrappedOnEvent: typeof options.onEvent = (event) => {
        if (generation !== attemptGeneration) return
        if (event.type === 'exit') cleanup()
        if (!initEmitted) {
          if (!supportsFailover || !commitsInitialTurn(event)) {
            bufferedEvents.push(event)
            return
          }
          emitInitAndBufferedEvents()
        }
        options.onEvent(event)
      }

      transcriptHookWatcher = attemptOptions.mode === 'direct' &&
          base.spawnEnv.__ONEWORKS_CODEX_HOOKS_ACTIVE__ === '1'
        ? createCodexTranscriptHookWatcher({
          cwd: ctx.cwd,
          env: ctx.env,
          homeDir: base.spawnEnv.HOME,
          logger: ctx.logger,
          onEvent: wrappedOnEvent,
          runtime: attemptOptions.runtime,
          sessionId: attemptOptions.sessionId
        })
        : undefined
      transcriptHookWatcher?.start()

      let recoveryScheduled = false
      const handleRecoverableInitialFailure = (error: Error) => {
        if (!supportsFailover || candidate == null || killed) return false
        const classification = classifyCodexAccountPoolFailure(error, pool.cooldownMs)
        if (classification == null) return false
        if (recoveryScheduled) return true
        recoveryScheduled = true
        const hasNextCandidate = candidateIndex < candidates.length - 1
        if (!hasNextCandidate) {
          void markCodexAccountPoolFailure({
            ctx,
            candidate,
            model: modelHealthKey,
            ...classification
          }).catch(reportAsyncFailure)
          return false
        }
        attemptGeneration += 1
        cleanup()
        bufferedEvents = []
        activeSession = undefined
        void markCodexAccountPoolFailure({
          ctx,
          candidate,
          model: modelHealthKey,
          ...classification
        }).then(() => startFromCandidate(candidateIndex + 1)).catch(reportAsyncFailure)
        return true
      }

      try {
        const nativeSessionStartedAt = startupProfiler.now()
        const session: ActiveCodexSession = attemptOptions.mode === 'direct'
          ? createDirectCodexSession(base, { ...attemptOptions, onEvent: wrappedOnEvent })
          : await createStreamCodexSession(base, ctx, {
            ...attemptOptions,
            onEvent: wrappedOnEvent,
            deferInitialFailure: supportsFailover,
            onRecoverableInitialAccountFailure: handleRecoverableInitialFailure
          })
        startupProfiler.mark('codex.session.createNativeSession', nativeSessionStartedAt)
        if (generation !== attemptGeneration) {
          session.kill()
          cleanup()
          return
        }
        activeSession = session
        activeCleanup = cleanup
        if (!supportsFailover) emitInitAndBufferedEvents()
        return
      } catch (error) {
        if (!supportsFailover) emitInitAndBufferedEvents()
        cleanup()
        bufferedEvents = []
        lastError = error
        const classification = candidate == null
          ? undefined
          : classifyCodexAccountPoolFailure(error, pool.cooldownMs)
        if (!supportsFailover || candidate == null || classification == null) {
          throw error
        }
        await markCodexAccountPoolFailure({
          ctx,
          candidate,
          model: modelHealthKey,
          ...classification
        })
        if (candidateIndex >= candidates.length - 1) throw error
      }
    }
    throw lastError ?? new Error('No Codex account attempt succeeded.')
  }

  await startFromCandidate(0)

  return {
    kill: () => {
      killed = true
      activeSession?.kill()
      activeCleanup?.()
    },
    emit: (event: AdapterEvent) => activeSession?.emit(event),
    respondInteraction: (interactionId: string, data: string | string[]) => {
      activeSession?.respondInteraction?.(interactionId, data)
    },
    get pid() {
      return activeSession?.pid
    }
  }
}
