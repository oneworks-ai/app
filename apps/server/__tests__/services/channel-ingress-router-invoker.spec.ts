import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

import { createRouterModelInvoker, invokeStructuredNoToolsJson } from '#~/services/channel-ingress-router/invoker.js'

import type {} from '../../../../packages/adapters/claude-code/src/adapter-config.js'
import type {} from '../../../../packages/adapters/codex/src/adapter-config.js'
import type {} from '../../../../packages/adapters/copilot/src/adapter-config.js'
import type {} from '../../../../packages/adapters/cursor/src/adapter-config.js'
import type {} from '../../../../packages/adapters/gemini/src/adapter-config.js'
import type {} from '../../../../packages/adapters/grok/src/adapter-config.js'
import type {} from '../../../../packages/adapters/kimi/src/adapter-config.js'
import type {} from '../../../../packages/adapters/opencode/src/adapter-config.js'
import type {} from '../../../../packages/adapters/pi/src/adapter-config.js'
import type {} from '../../../../packages/adapters/qwen-code/src/adapter-config.js'
import { createQwenCodeSession } from '../../../../packages/adapters/qwen-code/src/runtime/session.js'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('@oneworks/task', () => ({ run }))

const input = { adapter: 'gemini', context: [], model: 'gemini-2.5', text: 'hello' }
const tempDirs: string[] = []

describe('channel ingress router invoker', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('fails closed for unsupported adapters and invalid or extra JSON fields', async () => {
    const invoker = createRouterModelInvoker({ cwd: '/tmp' })
    await expect(invoker.invoke({ ...input, adapter: 'codex' })).resolves.toMatchObject({
      code: 'unsupported',
      ok: false
    })
    run.mockImplementation(async (_options, query) => {
      query.onEvent({
        type: 'message',
        data: { content: '{"decision":"observe","reason":"x","confidence":1,"entity":"bad"}' }
      })
      query.onEvent({ type: 'exit', data: { exitCode: 0 } })
      return { session: { kill: vi.fn() } }
    })
    await expect(invoker.invoke(input)).resolves.toMatchObject({ code: 'invalid_output', ok: false })
  })

  it('accepts exactly the four valid decision states', async () => {
    for (const decision of ['ignore', 'observe', 'create_child', 'defer'] as const) {
      run.mockImplementationOnce(async (_options, query) => {
        query.onEvent({
          type: 'message',
          data: { content: JSON.stringify({ confidence: 0.75, decision, reason: 'valid route' }) }
        })
        query.onEvent({ type: 'exit', data: { exitCode: 0 } })
        return { session: { kill: vi.fn(), flushHooks: vi.fn().mockResolvedValue(undefined) } }
      })
      await expect(createRouterModelInvoker({ cwd: '/tmp' }).invoke(input)).resolves.toMatchObject({
        ok: true,
        output: { decision }
      })
    }
  })

  it('projects Qwen channel ingress into deny-all core and subagent native tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-qwen-ingress-'))
    tempDirs.push(root)
    const cwd = join(root, 'workspace')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-qwen-ingress.mjs')
    await Promise.all([mkdir(cwd, { recursive: true }), mkdir(realHome, { recursive: true })])
    await writeFile(
      binaryPath,
      [
        `#!${process.execPath}`,
        `import { readFile } from 'node:fs/promises'`,
        `import { join } from 'node:path'`,
        `for await (const _chunk of process.stdin) {}`,
        `const args = process.argv.slice(2)`,
        `const settings = JSON.parse(await readFile(join(process.env.QWEN_HOME, 'settings.json'), 'utf8'))`,
        `const expectedExclude = ['existing', 'agent', 'list_agents', 'send_message', 'wait_agent']`,
        `const extensionsIndex = args.indexOf('--extensions')`,
        `if (JSON.stringify(settings.tools?.core) !== '[]' || JSON.stringify(settings.tools?.exclude) !== JSON.stringify(expectedExclude) || settings.tools?.custom !== true || Object.keys(settings.mcpServers ?? {}).length !== 0 || extensionsIndex < 0 || args[extensionsIndex + 1] !== 'none') {`,
        `  console.error('native tool denial was not preserved')`,
        `  process.exit(52)`,
        `}`,
        `console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'qwen-ingress-native' }))`,
        `console.log(JSON.stringify({ type: 'assistant', session_id: 'qwen-ingress-native', message: { id: 'qwen-ingress-output', content: [{ type: 'text', text: JSON.stringify({ confidence: 1, decision: 'ignore', reason: 'no native tools' }) }] } }))`,
        `console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'qwen-ingress-native', is_error: false }))`
      ].join('\n')
    )
    await chmod(binaryPath, 0o755)
    const ctx: AdapterCtx = {
      ctxId: 'ctx-qwen-ingress-test',
      cwd,
      env: {
        __ONEWORKS_PROJECT_ADAPTER_QWEN_CODE_CLI_PATH__: binaryPath,
        __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: join(root, 'project-home'),
        __ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__: '0',
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      cache: {
        get: async () => undefined,
        set: async () => ({ cachePath: '' })
      },
      logger: {
        stream: new PassThrough(),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined
      },
      configs: [{
        adapters: {
          'qwen-code': {
            disableExtensions: false,
            disableSubagents: true,
            settingsContent: {
              tools: { core: ['read_file'], exclude: ['existing'], custom: true }
            }
          }
        }
      }, undefined]
    }
    run.mockImplementation(async (_options, query: AdapterQueryOptions) => {
      expect(query).toEqual(expect.objectContaining({
        executionProfile: 'structured_no_tools',
        tools: { exclude: ['*'], include: [] },
        useDefaultOneworksMcpServer: false
      }))
      return { session: await createQwenCodeSession(ctx, query) }
    })

    await expect(
      createRouterModelInvoker({ cwd, timeoutMs: 15_000 }).invoke({
        adapter: 'qwen-code',
        context: [],
        model: 'default',
        text: 'classify without tools'
      })
    ).resolves.toMatchObject({ ok: true, output: { decision: 'ignore' } })
  }, 20_000)

  it('rejects oversized output and late-kills sessions after startup timeout', async () => {
    const lateKill = vi.fn()
    run.mockImplementation(async (_options, query) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      query.onEvent({ type: 'exit', data: { exitCode: 0 } })
      return { session: { kill: lateKill, flushHooks: vi.fn().mockResolvedValue(undefined) } }
    })
    const invoker = createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 1 })
    await expect(invoker.invoke(input)).resolves.toMatchObject({ code: 'timeout', ok: false })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(lateKill).toHaveBeenCalledOnce()

    run.mockImplementation(async (_options, query) => {
      query.onEvent({ type: 'message', data: { content: 'x'.repeat(9000) } })
      query.onEvent({ type: 'exit', data: { exitCode: 0 } })
      return { session: { kill: vi.fn() } }
    })
    await expect(createRouterModelInvoker({ cwd: '/tmp' }).invoke(input)).resolves.toMatchObject({
      code: 'invalid_output',
      ok: false
    })
  })

  it('kills and flushes an active session when completion times out', async () => {
    const kill = vi.fn()
    const flushHooks = vi.fn().mockResolvedValue(undefined)
    run.mockImplementation(async () => ({ session: { kill, flushHooks } }))

    await expect(createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 1 }).invoke(input)).resolves.toMatchObject({
      code: 'timeout',
      ok: false
    })
    expect(kill).toHaveBeenCalledOnce()
    expect(flushHooks).toHaveBeenCalledOnce()
  })

  it.each(['gemini', 'qwen-code'])(
    'enforces one aggregate startup+completion budget for the %s router lifecycle',
    async (adapter) => {
      vi.useFakeTimers()
      let monotonicNow = 0
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
      const kill = vi.fn()
      const flushHooks = vi.fn().mockResolvedValue(undefined)
      run.mockImplementation((_options, query) =>
        new Promise(resolve => {
          setTimeout(() => {
            resolve({ session: { kill, flushHooks } })
            setTimeout(() => {
              query.onEvent({
                type: 'message',
                data: { content: '{"confidence":1,"decision":"ignore","reason":"late"}' }
              })
              query.onEvent({ type: 'exit', data: { exitCode: 0 } })
            }, 60)
          }, 60)
        })
      )

      try {
        const result = createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 100 }).invoke({
          ...input,
          adapter
        })
        monotonicNow = 60
        await vi.advanceTimersByTimeAsync(60)
        monotonicNow = 101
        await vi.advanceTimersByTimeAsync(41)
        await expect(result).resolves.toMatchObject({ code: 'timeout', ok: false })
        expect(kill).toHaveBeenCalledOnce()
        expect(flushHooks).toHaveBeenCalledOnce()
      } finally {
        nowSpy.mockRestore()
        vi.clearAllTimers()
        vi.useRealTimers()
      }
    }
  )

  it('shares the same aggregate deadline in invokeStructuredNoToolsJson', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    const kill = vi.fn()
    const flushHooks = vi.fn().mockResolvedValue(undefined)
    run.mockImplementation((_options, query) =>
      new Promise(resolve => {
        setTimeout(() => {
          resolve({ session: { kill, flushHooks } })
          setTimeout(() => {
            query.onEvent({ type: 'message', data: { content: '{"ok":true}' } })
            query.onEvent({ type: 'exit', data: { exitCode: 0 } })
          }, 60)
        }, 60)
      })
    )

    try {
      const result = invokeStructuredNoToolsJson({
        adapter: 'qwen-code',
        cwd: '/tmp',
        model: 'default',
        systemPrompt: 'return json',
        text: 'classify',
        timeoutMs: 100
      })
      monotonicNow = 60
      await vi.advanceTimersByTimeAsync(60)
      monotonicNow = 101
      await vi.advanceTimersByTimeAsync(41)
      await expect(result).resolves.toMatchObject({ code: 'timeout', ok: false })
      expect(kill).toHaveBeenCalledOnce()
      expect(flushHooks).toHaveBeenCalledOnce()
    } finally {
      nowSpy.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('accepts an exact-budget lifecycle, fails startup errors, and preserves successful cleanup state', async () => {
    vi.useFakeTimers()
    let monotonicNow = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    const kill = vi.fn()
    const flushHooks = vi.fn().mockResolvedValue(undefined)
    run.mockImplementationOnce((_options, query) =>
      new Promise(resolve => {
        setTimeout(() => {
          resolve({ session: { kill, flushHooks } })
          setTimeout(() => {
            query.onEvent({
              type: 'message',
              data: { content: '{"confidence":1,"decision":"observe","reason":"boundary"}' }
            })
            query.onEvent({ type: 'exit', data: { exitCode: 0 } })
          }, 50)
        }, 50)
      })
    )

    try {
      const boundary = createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 100 }).invoke(input)
      monotonicNow = 50
      await vi.advanceTimersByTimeAsync(50)
      monotonicNow = 100
      await vi.advanceTimersByTimeAsync(50)
      await expect(boundary).resolves.toMatchObject({ ok: true, output: { decision: 'observe' } })
      expect(kill).not.toHaveBeenCalled()
      expect(flushHooks).not.toHaveBeenCalled()

      run.mockRejectedValueOnce(new Error('startup failed'))
      await expect(createRouterModelInvoker({ cwd: '/tmp', timeoutMs: 100 }).invoke(input)).resolves.toMatchObject({
        code: 'failed',
        error: 'startup failed',
        ok: false
      })
    } finally {
      nowSpy.mockRestore()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})
