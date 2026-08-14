/* eslint-disable max-lines -- constrained classifier invocation keeps timeout, parsing, and deny-all setup together. */
import { randomUUID } from 'node:crypto'

import { run } from '@oneworks/task'
import type { AdapterOutputEvent, WorkspaceAssetBundle } from '@oneworks/types'
import { z } from 'zod'

import type { RouterModelInvoker, RouterModelOutput } from './types'

const MAX_CONTEXT_ITEMS = 12
const MAX_CONTEXT_ITEM_LENGTH = 512
const MAX_OUTPUT_LENGTH = 8192
const MAX_PROMPT_LENGTH = 2000
const MAX_TEXT_LENGTH = 4000
const NO_TOOLS_ADAPTERS = new Set(['gemini', 'qwen-code'])

const routerModelOutputSchema = z.object({
  confidence: z.number().finite().min(0).max(1),
  decision: z.enum(['ignore', 'observe', 'create_child', 'defer']),
  mode: z.enum(['reply', 'clarify', 'digest', 'admin', 'background']).optional(),
  reason: z.string().trim().min(1).max(240)
}).strict()

const EMPTY_ASSET_BUNDLE = (cwd: string): WorkspaceAssetBundle => ({
  cwd,
  assets: [],
  channelLinks: [],
  defaultExcludeMcpServers: [],
  defaultIncludeMcpServers: [],
  entities: [],
  hookPlugins: [],
  mcpServers: {},
  opencodeOverlayAssets: [],
  pluginInstances: [],
  rules: [],
  skills: [],
  specs: [],
  workspaces: []
})

const clean = (value: string, maxLength: number) =>
  Array.from(value, character => (character.codePointAt(0) ?? 0) <= 0x1F ? ' ' : character)
    .join('')
    .slice(0, maxLength)

const buildSystemPrompt = () =>
  [
    'You are an ingress classifier. Return exactly one JSON object and no markdown.',
    'Allowed keys: decision, reason, confidence, mode.',
    'decision must be ignore, observe, create_child, or defer.',
    'Never return entity, permission, tool, session, account, user, identifier, or reply content.',
    'You have no tools and must not request tools or actions.'
  ].join('\n')

const parseOutput = (events: AdapterOutputEvent[]) =>
  events
    .filter((event): event is Extract<AdapterOutputEvent, { type: 'message' }> => event.type === 'message')
    .flatMap(event =>
      typeof event.data.content === 'string'
        ? [event.data.content]
        : event.data.content
          .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
          .map(item => item.text)
    )
    .join('\n')

interface RouterDeadline {
  expiresAt: number
  timeoutMs: number
}

const createDeadline = (timeoutMs: number): RouterDeadline => ({
  expiresAt: performance.now() + timeoutMs,
  timeoutMs
})

const raceWithDeadline = async <T>(
  promise: Promise<T>,
  deadline: RouterDeadline,
  phase: string
): Promise<T> => {
  const remainingMs = deadline.expiresAt - performance.now()
  if (remainingMs <= 0) throw new Error(`Router ${phase} timed out after ${deadline.timeoutMs}ms total`)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Router ${phase} timed out after ${deadline.timeoutMs}ms total`)),
          remainingMs
        )
      })
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}

/** Shared constrained runner for classifiers. It always uses the deny-all tool profile. */
export const invokeStructuredNoToolsJson = async (input: {
  adapter: string
  cwd: string
  model: string
  systemPrompt: string
  text: string
  timeoutMs?: number
}) => {
  const startedAt = Date.now()
  if (!NO_TOOLS_ADAPTERS.has(input.adapter)) {
    return {
      ok: false as const,
      code: 'unsupported' as const,
      error: `Adapter ${input.adapter} cannot prove deny-all tools`,
      latencyMs: 0
    }
  }
  const events: AdapterOutputEvent[] = []
  let resolveCompletion: (() => void) | undefined
  let rejectCompletion: ((error: Error) => void) | undefined
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  let session: Awaited<ReturnType<typeof run>>['session'] | undefined
  let cancelled = false
  const timeoutMs = input.timeoutMs ?? 5000
  const deadline = createDeadline(timeoutMs)
  try {
    const started = run({ adapter: input.adapter, cwd: input.cwd }, {
      assetBundle: EMPTY_ASSET_BUNDLE(input.cwd),
      description: JSON.stringify({ text: clean(input.text, MAX_TEXT_LENGTH) }),
      executionProfile: 'structured_no_tools',
      mcpServers: { include: [] },
      mode: 'direct',
      model: input.model,
      onEvent: event => {
        events.push(event)
        if (event.type === 'error' && event.data.fatal !== false) rejectCompletion?.(new Error(event.data.message))
        if (event.type === 'exit') {
          event.data.exitCode === 0
            ? resolveCompletion?.()
            : rejectCompletion?.(new Error(event.data.stderr ?? 'Structured reviewer exited unsuccessfully'))
        }
      },
      permissionMode: 'dontAsk',
      runtime: 'cli',
      sessionId: `structured-review-${randomUUID()}`,
      skills: { include: [] },
      systemPrompt: clean(input.systemPrompt, MAX_PROMPT_LENGTH),
      tools: { exclude: ['*'], include: [] },
      type: 'create',
      useDefaultOneworksMcpServer: false
    })
    void started.then(async result => {
      if (!cancelled) return
      result.session.kill()
      await result.session.flushHooks?.().catch(() => undefined)
    }).catch(() => undefined)
    session = await raceWithDeadline(started, deadline, 'startup').then(result => result.session)
    await raceWithDeadline(completion, deadline, 'completion')
    const output = parseOutput(events)
    if (output.length > MAX_OUTPUT_LENGTH) {
      return {
        ok: false as const,
        code: 'invalid_output' as const,
        error: 'Structured reviewer output exceeded maximum length',
        latencyMs: Date.now() - startedAt
      }
    }
    try {
      return { ok: true as const, output: JSON.parse(output) as unknown, latencyMs: Date.now() - startedAt }
    } catch {
      return {
        ok: false as const,
        code: 'invalid_output' as const,
        error: 'Structured reviewer output was not JSON',
        latencyMs: Date.now() - startedAt
      }
    }
  } catch (error) {
    cancelled = true
    session?.kill()
    await session?.flushHooks?.().catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false as const,
      code: /timed out/i.test(message) ? 'timeout' as const : 'failed' as const,
      error: message,
      latencyMs: Date.now() - startedAt
    }
  }
}

export const createRouterModelInvoker = (options: { cwd: string; timeoutMs?: number }): RouterModelInvoker => ({
  async invoke(input) {
    const startedAt = Date.now()
    if (!NO_TOOLS_ADAPTERS.has(input.adapter)) {
      return {
        ok: false,
        code: 'unsupported',
        error: `Adapter ${input.adapter} cannot prove deny-all tools`,
        latencyMs: 0
      }
    }
    const events: AdapterOutputEvent[] = []
    let resolveCompletion: (() => void) | undefined
    let rejectCompletion: ((error: Error) => void) | undefined
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })
    let session: Awaited<ReturnType<typeof run>>['session'] | undefined
    let cancelled = false
    const timeoutMs = options.timeoutMs ?? 5000
    const deadline = createDeadline(timeoutMs)
    const context = input.context.slice(0, MAX_CONTEXT_ITEMS).map(item => clean(item, MAX_CONTEXT_ITEM_LENGTH))
    const prompt = input.prompt == null ? undefined : clean(input.prompt, MAX_PROMPT_LENGTH)
    const text = clean(input.text, MAX_TEXT_LENGTH)
    try {
      const started = run({ adapter: input.adapter, cwd: options.cwd }, {
        assetBundle: EMPTY_ASSET_BUNDLE(options.cwd),
        description: JSON.stringify({ context, prompt, text }),
        executionProfile: 'structured_no_tools',
        mcpServers: { include: [] },
        mode: 'direct',
        model: input.model,
        onEvent: event => {
          events.push(event)
          if (event.type === 'error' && event.data.fatal !== false) rejectCompletion?.(new Error(event.data.message))
          if (event.type === 'exit') {
            event.data.exitCode === 0
              ? resolveCompletion?.()
              : rejectCompletion?.(new Error(event.data.stderr ?? 'Router model exited unsuccessfully'))
          }
        },
        permissionMode: 'dontAsk',
        runtime: 'cli',
        sessionId: `ingress-router-${randomUUID()}`,
        skills: { include: [] },
        systemPrompt: buildSystemPrompt(),
        tools: { exclude: ['*'], include: [] },
        type: 'create',
        useDefaultOneworksMcpServer: false
      })
      // `run` currently has no AbortSignal. If startup wins the timeout race later,
      // this continuation immediately tears down that late session instead of leaking it.
      void started.then(async result => {
        if (!cancelled) return
        result.session.kill()
        await result.session.flushHooks?.().catch(() => undefined)
      }).catch(() => undefined)
      session = await raceWithDeadline(started, deadline, 'startup').then(result => result.session)
      await raceWithDeadline(completion, deadline, 'completion')
      const output = parseOutput(events)
      if (output.length > MAX_OUTPUT_LENGTH) {
        return {
          ok: false,
          code: 'invalid_output',
          error: 'Router output exceeded maximum length',
          latencyMs: Date.now() - startedAt
        }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(output)
      } catch {
        return {
          ok: false,
          code: 'invalid_output',
          error: 'Router output was not JSON',
          latencyMs: Date.now() - startedAt
        }
      }
      const validated = routerModelOutputSchema.safeParse(parsed)
      if (!validated.success) {
        return {
          ok: false,
          code: 'invalid_output',
          error: 'Router output did not match schema',
          latencyMs: Date.now() - startedAt
        }
      }
      return { ok: true, output: validated.data satisfies RouterModelOutput, latencyMs: Date.now() - startedAt }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      cancelled = true
      session?.kill()
      await session?.flushHooks?.().catch(() => undefined)
      return {
        ok: false,
        code: /timed out/i.test(message) ? 'timeout' : 'failed',
        error: message,
        latencyMs: Date.now() - startedAt
      }
    }
  }
})
