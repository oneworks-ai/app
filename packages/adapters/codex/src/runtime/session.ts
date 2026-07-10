import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'
import { createStartupProfiler } from '@oneworks/utils'

import { createDirectCodexSession } from './direct'
import { resolveSessionBase } from './session-common'
import { createStreamCodexSession } from './stream'
import { createCodexTranscriptHookWatcher } from './transcript-hooks'

/**
 * Create a codex adapter session, dispatching to `direct` or `stream` mode
 * based on `options.mode` (default: `'stream'`).
 */
export const createCodexSession = async (ctx: AdapterCtx, options: AdapterQueryOptions) => {
  const startupProfiler = createStartupProfiler({
    config: ctx.configState?.mergedConfig,
    cwd: ctx.cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId: options.sessionId
  })
  const sessionBaseStartedAt = startupProfiler.now()
  const base = await resolveSessionBase(ctx, options)
  startupProfiler.mark('codex.session.resolveSessionBase', sessionBaseStartedAt)
  let transcriptHookWatcher: ReturnType<typeof createCodexTranscriptHookWatcher> | undefined
  let didStopTranscriptHookWatcher = false
  const stopTranscriptHookWatcher = () => {
    if (didStopTranscriptHookWatcher) return
    didStopTranscriptHookWatcher = true
    transcriptHookWatcher?.stop()
  }
  const wrappedOnEvent: typeof options.onEvent = (event) => {
    if (event.type === 'exit') {
      stopTranscriptHookWatcher()
    }
    options.onEvent(event)
  }
  transcriptHookWatcher = base.spawnEnv.__ONEWORKS_CODEX_HOOKS_ACTIVE__ === '1'
    ? createCodexTranscriptHookWatcher({
      cwd: ctx.cwd,
      env: ctx.env,
      homeDir: base.spawnEnv.HOME,
      logger: ctx.logger,
      onEvent: options.mode === 'direct' ? wrappedOnEvent : undefined,
      runtime: options.runtime,
      sessionId: options.sessionId
    })
    : undefined

  const transcriptHookWatcherStartedAt = startupProfiler.now()
  transcriptHookWatcher?.start()
  startupProfiler.mark('codex.session.transcriptHookWatcher.start', transcriptHookWatcherStartedAt)

  wrappedOnEvent({
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
  try {
    const nativeSessionStartedAt = startupProfiler.now()
    const session = options.mode === 'direct'
      ? createDirectCodexSession(base, {
        ...options,
        onEvent: wrappedOnEvent
      })
      : await createStreamCodexSession(base, ctx, {
        ...options,
        onEvent: wrappedOnEvent
      })
    startupProfiler.mark('codex.session.createNativeSession', nativeSessionStartedAt)

    return {
      ...session,
      kill: () => {
        stopTranscriptHookWatcher()
        session.kill()
      }
    }
  } catch (error) {
    stopTranscriptHookWatcher()
    throw error
  }
}
