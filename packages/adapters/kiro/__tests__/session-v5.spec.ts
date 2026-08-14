import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent } from '@oneworks/types'

import { createKiroSession, createStreamKiroSession } from '../src/runtime/session'

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-kiro-cli.mjs')
let tempRoot = ''

const waitFor = async (condition: () => boolean | Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
  throw new Error('Timed out waiting for fake Kiro V5 lifecycle event.')
}

const createContext = (params: {
  cache?: Map<string, unknown>
  behavior?: string
  env?: AdapterCtx['env']
  logPath: string
  projectRoot: string
}): AdapterCtx => {
  const cache = params.cache ?? new Map<string, unknown>()
  return {
    ctxId: 'ctx-kiro-v5-test',
    cwd: params.projectRoot,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_KIRO_CLI_PATH__: fixturePath,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(params.projectRoot, '.oneworks-projects'),
      FAKE_KIRO_LOG: params.logPath,
      FAKE_KIRO_BEHAVIOR: params.behavior,
      ...params.env
    },
    cache: {
      get: async key => cache.get(key) as never,
      set: async (key, value) => {
        cache.set(key, value)
        return { cachePath: '' }
      }
    },
    configs: [],
    logger: {
      stream: new PassThrough(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    }
  }
}

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'oneworks-kiro-v5-test-'))
  await chmod(fixturePath, 0o755)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('kiro V5 session lifecycle', () => {
  it('returns create/resume sessions before an initial default/plan permission response', async () => {
    const cache = new Map<string, unknown>()
    for (
      const testCase of [
        { type: 'create' as const, permissionMode: 'default' as const },
        { type: 'resume' as const, permissionMode: 'plan' as const }
      ]
    ) {
      const projectRoot = join(tempRoot, `initial-${testCase.type}-${testCase.permissionMode}`)
      const logPath = join(projectRoot, 'wire.jsonl')
      await mkdir(projectRoot, { recursive: true })
      const events: AdapterOutputEvent[] = []
      const session = await createStreamKiroSession(
        createContext({ behavior: 'permission', cache, logPath, projectRoot }),
        {
          type: testCase.type,
          runtime: 'server',
          sessionId: `session-initial-${testCase.type}`,
          permissionMode: testCase.permissionMode,
          description: `initial ${testCase.type} permissioned turn`,
          onEvent: event => events.push(event)
        }
      )

      expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
      await waitFor(() => events.some(event => event.type === 'interaction_request'))
      const interaction = events.find(event => event.type === 'interaction_request')
      if (interaction?.type !== 'interaction_request') throw new Error('Expected initial permission request')
      await session.respondInteraction?.(interaction.data.id, 'allow_once')
      await waitFor(() => events.some(event => event.type === 'stop'))

      const trace = await readFile(logPath, 'utf8')
      expect(trace).toContain('"id":"permission-1"')
      expect(trace).toContain('"optionId":"allow-once"')
      expect(trace).not.toContain(`initial ${testCase.type} permissioned turn`)
      expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
      session.stop?.()
      await waitFor(() => events.some(event => event.type === 'exit'))
    }
  })

  it('rejects late permission/input RPCs and ignores notifications after terminal failure', async () => {
    const projectRoot = join(tempRoot, 'terminal-late-events')
    const logPath = join(projectRoot, 'wire.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({ behavior: 'terminal_late_events', logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-terminal-late',
        description: 'trigger terminal ordering',
        onEvent: event => events.push(event)
      }
    )

    await waitFor(() => events.some(event => event.type === 'exit'))
    await waitFor(async () => (await readFile(logPath, 'utf8')).includes('late-ask'))
    const records = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(events.filter(event => event.type === 'error' && event.data.fatal !== false)).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(events.filter(event => event.type === 'session_update')).toHaveLength(0)
    expect(records.filter(record => record.id === 'late-permission')).toEqual([
      expect.objectContaining({ result: { outcome: { outcome: 'cancelled' } } })
    ])
    expect(records.filter(record => record.id === 'late-ask')).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: -32000 }) })
    ])
    session.stop?.()
  })

  it('keeps stop and cancel idempotent after the child has already exited', async () => {
    const projectRoot = join(tempRoot, 'exit-idle-project')
    const logPath = join(tempRoot, 'exit-idle.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({ behavior: 'exit_idle', logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-exit-idle',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'exit'))
    session.emit({ type: 'interrupt' })
    session.stop?.()
    session.kill()
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(events.filter(event => event.type === 'error')).toHaveLength(0)
  })

  it.each([
    {
      name: 'absent option collection',
      env: { FAKE_KIRO_EFFORT_CONTRACT: 'absent' },
      expectedEffort: undefined,
      expectedCode: 'kiro_effort_unavailable'
    },
    {
      name: 'sparse option collection',
      env: { FAKE_KIRO_EFFORT_CONTRACT: 'sparse' },
      expectedEffort: 'medium',
      expectedCode: 'kiro_effort_unavailable'
    },
    {
      name: 'setter-confirmed active state',
      env: { FAKE_KIRO_SET_EFFORT_ACTIVE: 'low' },
      expectedEffort: 'low',
      expectedCode: undefined
    },
    {
      name: 'empty setter response',
      env: { FAKE_KIRO_EFFORT_SETTER_EMPTY: '1' },
      expectedEffort: 'medium',
      expectedCode: 'kiro_effort_unconfirmed'
    }
  ])('reports truthful effort for $name', async ({ env, expectedCode, expectedEffort }) => {
    const projectRoot = join(tempRoot, `effort-${env.FAKE_KIRO_EFFORT_CONTRACT ?? 'setter'}`)
    const logPath = join(projectRoot, `${env.FAKE_KIRO_SET_EFFORT_ACTIVE ?? 'state'}.jsonl`)
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(createContext({ env, logPath, projectRoot }), {
      type: 'create',
      runtime: 'server',
      sessionId: `session-effort-${expectedEffort ?? 'unknown'}`,
      effort: 'high',
      onEvent: event => events.push(event)
    })

    const initEvent = events.find(event => event.type === 'init')
    expect(initEvent?.type === 'init' ? initEvent.data.effort : undefined).toBe(expectedEffort)
    expect(events.find(event => event.type === 'error')?.data.code).toBe(expectedCode)
    const trace = await readFile(logPath, 'utf8')
    expect(trace.includes('session/set_config_option')).toBe(expectedCode !== 'kiro_effort_unavailable')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('reports loaded native effort and never echoes an unverified direct request', async () => {
    const projectRoot = join(tempRoot, 'effort-load-direct')
    await mkdir(projectRoot, { recursive: true })
    const cache = new Map<string, unknown>([[
      'adapter.kiro.session',
      { kiroSessionId: 'kiro-native-effort', title: 'Existing' }
    ]])
    const streamEvents: AdapterOutputEvent[] = []
    const stream = await createStreamKiroSession(
      createContext({
        cache,
        env: { FAKE_KIRO_ACTIVE_EFFORT: 'xhigh' },
        logPath: join(projectRoot, 'load.jsonl'),
        projectRoot
      }),
      {
        type: 'resume',
        runtime: 'server',
        sessionId: 'session-effort-load',
        onEvent: event => streamEvents.push(event)
      }
    )
    const streamInit = streamEvents.find(event => event.type === 'init')
    expect(streamInit?.type === 'init' ? streamInit.data.effort : undefined).toBe('xhigh')
    stream.stop?.()
    await waitFor(() => streamEvents.some(event => event.type === 'exit'))

    const directEvents: AdapterOutputEvent[] = []
    const direct = await createKiroSession(
      createContext({
        logPath: join(projectRoot, 'direct.jsonl'),
        projectRoot
      }),
      {
        type: 'create',
        mode: 'direct',
        runtime: 'server',
        sessionId: 'session-effort-direct',
        effort: 'high',
        onEvent: event => directEvents.push(event)
      }
    )
    const directInit = directEvents.find(event => event.type === 'init')
    expect(directInit?.type === 'init' ? directInit.data.effort : undefined).toBeUndefined()
    await waitFor(() => directEvents.some(event => event.type === 'exit'))
    direct.stop?.()
  })
})
