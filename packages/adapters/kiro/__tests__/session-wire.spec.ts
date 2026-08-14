import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent } from '@oneworks/types'

import { createStreamKiroSession } from '../src/runtime/session'

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-kiro-cli.mjs')
let tempRoot = ''

const waitFor = async (condition: () => boolean | Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
  throw new Error('Timed out waiting for fake Kiro lifecycle event.')
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
    ctxId: 'ctx-kiro-test',
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
  tempRoot = await mkdtemp(join(tmpdir(), 'oneworks-kiro-test-'))
  await chmod(fixturePath, 0o755)
})

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('kiro ACP wire lifecycle', () => {
  it('uses Kiro content wire and de-duplicates mirrored notification/update events', async () => {
    const projectRoot = join(tempRoot, 'create-project')
    const logPath = join(tempRoot, 'create.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const cache = new Map<string, unknown>()
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(createContext({ cache, logPath, projectRoot }), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-create',
      description: 'Say hello',
      model: 'kiro-test',
      effort: 'high',
      assetPlan: {
        adapter: 'kiro',
        diagnostics: [],
        mcpServers: {
          local: { command: 'node', args: ['local.mjs'] },
          remote: { type: 'http', url: 'https://example.test/mcp' },
          events: { type: 'sse', url: 'https://example.test/events', headers: {} }
        },
        overlays: []
      },
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.some(event => event.type === 'stop'))
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(events.filter(event => event.type === 'operation' && event.data.type === 'operation_started')).toHaveLength(
      1
    )
    expect(events.filter(event => event.type === 'message')).toHaveLength(3)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ content: 'Hello from Kiro' })
    }))
    expect(cache.get('adapter.kiro.session')).toEqual({
      kiroSessionId: 'kiro-native-1',
      title: 'OneWorks:session-create'
    })

    const records = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const prompt = records.find(record => record.method === 'session/prompt')
    expect(prompt.params).toEqual({
      sessionId: 'kiro-native-1',
      hasContent: true,
      hasPrompt: false
    })
    expect(await readFile(logPath, 'utf8')).not.toContain('Say hello')
    expect(records.map(record => record.method)).toContain('session/set_model')
    expect(records.map(record => record.method)).toContain('session/set_config_option')
    const sessionNew = records.find(record => record.method === 'session/new')
    expect(sessionNew.params.mcpServers).toEqual([
      expect.objectContaining({ name: 'local', command: 'node' })
    ])
    expect(sessionNew.params.mcpServers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'remote' }),
      expect.objectContaining({ name: 'events' })
    ]))
    const initEvent = events.find(event => event.type === 'init')
    expect(initEvent?.type === 'init' ? initEvent.data.model : undefined).toBe('kiro-test')
    expect(initEvent?.type === 'init' ? initEvent.data.assetDiagnostics : []).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: 'runtime-mcp:remote',
        status: 'skipped',
        reason: expect.stringContaining('verified Kiro ACP supports only stdio')
      }),
      expect.objectContaining({
        assetId: 'runtime-mcp:events',
        status: 'skipped',
        reason: expect.stringContaining('verified Kiro ACP supports only stdio')
      })
    ]))
    expect(initEvent?.type === 'init' ? initEvent.data.assetDiagnostics : []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'runtime-mcp:remote', status: 'translated' }),
      expect.objectContaining({ assetId: 'runtime-mcp:events', status: 'translated' })
    ]))
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('loads the cached native id without projecting replayed history', async () => {
    const projectRoot = join(tempRoot, 'resume-project')
    const logPath = join(tempRoot, 'resume.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const cache = new Map<string, unknown>([[
      'adapter.kiro.session',
      { kiroSessionId: 'kiro-native-existing', title: 'Existing' }
    ]])
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(createContext({ cache, logPath, projectRoot }), {
      type: 'resume',
      runtime: 'server',
      sessionId: 'session-resume',
      description: 'Continue',
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.some(event => event.type === 'stop'))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ content: expect.stringContaining('REPLAYED') })
    }))
    const records = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(records).toContainEqual(expect.objectContaining({
      method: 'session/load',
      params: expect.objectContaining({ sessionId: 'kiro-native-existing' })
    }))
    const initEvent = events.find(event => event.type === 'init')
    expect(initEvent?.type === 'init' ? initEvent.data.model : undefined).toBe('kiro-test')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('turns an unexpected ACP EOF into one fatal error and one exit', async () => {
    const projectRoot = join(tempRoot, 'exit-project')
    const logPath = join(tempRoot, 'exit.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({
        behavior: 'exit_during_prompt',
        logPath,
        projectRoot
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-exit',
        description: 'Exit now',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error' && event.data.fatal !== false)).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    session.stop?.()
  })

  it('fails an unknown failure-shaped notification once without exposing its payload', async () => {
    const projectRoot = join(tempRoot, 'failure-notification-project')
    const logPath = join(tempRoot, 'failure-notification.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({
        behavior: 'failure_notification',
        logPath,
        projectRoot
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-failure-notification',
        description: 'Trigger sanitized failure',
        onEvent: event => events.push(event)
      }
    )
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'error' && event.data.fatal !== false)).toHaveLength(1)
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toContain('private failure payload')
    expect(await readFile(logPath, 'utf8')).not.toContain('Trigger sanitized failure')
    session.stop?.()
  })

  it('settles prompt cancellation exactly once while a turn is in flight', async () => {
    const projectRoot = join(tempRoot, 'cancel-project')
    const logPath = join(tempRoot, 'cancel.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({
        behavior: 'prompt_inflight',
        logPath,
        projectRoot
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-cancel',
        onEvent: event => events.push(event)
      }
    )
    session.emit({ type: 'message', content: [{ type: 'text', text: 'secret prompt must not be logged' }] })
    await waitFor(async () => (await readFile(logPath, 'utf8')).includes('session/prompt'))
    session.emit({ type: 'interrupt' })
    await waitFor(() => events.some(event => event.type === 'stop'))
    await waitFor(async () => (await readFile(logPath, 'utf8')).includes('session/cancel'))
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    const trace = await readFile(logPath, 'utf8')
    expect(trace).toContain('session/cancel')
    expect(trace).not.toContain('secret prompt')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
    expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
  })

  it('correlates permission deny and cancellation responses without leaking prompt content', async () => {
    for (const decision of ['deny_once', 'cancel'] as const) {
      const projectRoot = join(tempRoot, `permission-${decision}`)
      const logPath = join(tempRoot, `permission-${decision}.jsonl`)
      await mkdir(projectRoot, { recursive: true })
      const events: AdapterOutputEvent[] = []
      const session = await createStreamKiroSession(
        createContext({
          behavior: 'permission',
          logPath,
          projectRoot
        }),
        {
          type: 'create',
          runtime: 'server',
          sessionId: `session-${decision}`,
          onEvent: event => events.push(event)
        }
      )
      session.emit({ type: 'message', content: [{ type: 'text', text: `private-${decision}` }] })
      await waitFor(() => events.some(event => event.type === 'interaction_request'))
      const interaction = events.find(event => event.type === 'interaction_request')
      if (interaction?.type !== 'interaction_request') throw new Error('Expected permission request')
      if (decision === 'cancel') session.emit({ type: 'interrupt' })
      else session.respondInteraction?.(interaction.data.id, decision)
      await waitFor(() => events.some(event => event.type === 'stop'))
      await waitFor(async () => (await readFile(logPath, 'utf8')).includes('"id":"permission-1"'))
      const trace = await readFile(logPath, 'utf8')
      expect(trace).toContain('"id":"permission-1"')
      expect(trace).not.toContain(`private-${decision}`)
      expect(trace).toContain(decision === 'cancel' ? '"outcome":"cancelled"' : '"optionId":"reject-once"')
      session.stop?.()
      await waitFor(() => events.some(event => event.type === 'exit'))
      expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
      expect(events.filter(event => event.type === 'exit')).toHaveLength(1)
    }
  })

  it('runs dontAsk permissioned tools with request-scoped allow and no interaction', async () => {
    const projectRoot = join(tempRoot, 'permission-dont-ask')
    const logPath = join(tempRoot, 'permission-dont-ask.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({ behavior: 'permission', logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-dont-ask',
        permissionMode: 'dontAsk',
        description: 'Run the permissioned tool',
        onEvent: event => events.push(event)
      }
    )

    await waitFor(() => events.some(event => event.type === 'stop'))
    const trace = await readFile(logPath, 'utf8')
    expect(events.filter(event => event.type === 'interaction_request')).toHaveLength(0)
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    expect(trace).toContain('"id":"permission-1"')
    expect(trace).toContain('"optionId":"allow-once"')
    expect(trace).not.toContain('"optionId":"allow-always"')
    expect(trace).not.toContain('"optionId":"reject-once"')
    expect(trace).not.toContain('Run the permissioned tool')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('fails closed for non-default models absent from the advertised session collection', async () => {
    for (
      const testCase of [
        { name: 'absent collection', env: { FAKE_KIRO_MODEL_CONTRACT: 'absent' } },
        { name: 'unavailable ID', env: {} }
      ]
    ) {
      const projectRoot = join(tempRoot, `model-${testCase.name.replaceAll(' ', '-')}`)
      const logPath = join(projectRoot, 'wire.jsonl')
      await mkdir(projectRoot, { recursive: true })
      const events: AdapterOutputEvent[] = []
      await expect(createStreamKiroSession(
        createContext({ env: testCase.env, logPath, projectRoot }),
        {
          type: 'create',
          runtime: 'server',
          sessionId: `session-${testCase.name}`,
          model: 'external-service,not-a-kiro-model',
          onEvent: event => events.push(event)
        }
      )).rejects.toThrow('only Default or an exact advertised native model is valid')
      expect(events.filter(event => event.type === 'init')).toHaveLength(0)
      expect(await readFile(logPath, 'utf8')).not.toContain('session/set_model')
    }
  })

  it('allows only Default when models are absent and reports that state truthfully', async () => {
    const projectRoot = join(tempRoot, 'model-default-only')
    const logPath = join(projectRoot, 'wire.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({ env: { FAKE_KIRO_MODEL_CONTRACT: 'absent' }, logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-model-default-only',
        model: 'default',
        onEvent: event => events.push(event)
      }
    )
    const initEvent = events.find(event => event.type === 'init')
    expect(initEvent?.type === 'init' ? initEvent.data.model : undefined).toBe('default')
    expect(await readFile(logPath, 'utf8')).not.toContain('session/set_model')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('applies an exact advertised native model and reports the model returned by Kiro', async () => {
    const projectRoot = join(tempRoot, 'model-advertised')
    const logPath = join(projectRoot, 'wire.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({ env: { FAKE_KIRO_SET_MODEL_ACTIVE: 'kiro-returned-model' }, logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-model-advertised',
        model: 'kiro-other',
        onEvent: event => events.push(event)
      }
    )
    const initEvent = events.find(event => event.type === 'init')
    expect(initEvent?.type === 'init' ? initEvent.data.model : undefined).toBe('kiro-returned-model')
    expect(await readFile(logPath, 'utf8')).toContain('session/set_model')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('treats a successful empty setter response as application of the advertised requested model', async () => {
    const projectRoot = join(tempRoot, 'model-empty-success')
    const logPath = join(projectRoot, 'wire.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    const session = await createStreamKiroSession(
      createContext({ env: { FAKE_KIRO_SET_MODEL_EMPTY: '1' }, logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-model-empty-success',
        model: 'kiro-other',
        onEvent: event => events.push(event)
      }
    )
    const initEvent = events.find(event => event.type === 'init')
    expect(initEvent?.type === 'init' ? initEvent.data.model : undefined).toBe('kiro-other')
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('does not emit a requested model when Kiro rejects the native setter', async () => {
    const projectRoot = join(tempRoot, 'model-rejected')
    const logPath = join(projectRoot, 'wire.jsonl')
    await mkdir(projectRoot, { recursive: true })
    const events: AdapterOutputEvent[] = []
    await expect(createStreamKiroSession(
      createContext({ env: { FAKE_KIRO_SET_MODEL_ERROR: '1' }, logPath, projectRoot }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-model-rejected',
        model: 'kiro-test',
        onEvent: event => events.push(event)
      }
    )).rejects.toThrow('model rejected')
    expect(events.filter(event => event.type === 'init')).toHaveLength(0)
  })

  it('uses loaded model state and rejects a resume model when load advertises no collection', async () => {
    for (const modelContract of ['advertised', 'absent'] as const) {
      const projectRoot = join(tempRoot, `resume-model-${modelContract}`)
      const logPath = join(projectRoot, 'wire.jsonl')
      await mkdir(projectRoot, { recursive: true })
      const cache = new Map<string, unknown>([[
        'adapter.kiro.session',
        { kiroSessionId: `kiro-native-${modelContract}`, title: 'Existing' }
      ]])
      const events: AdapterOutputEvent[] = []
      const promise = createStreamKiroSession(
        createContext({ cache, env: { FAKE_KIRO_MODEL_CONTRACT: modelContract }, logPath, projectRoot }),
        {
          type: 'resume',
          runtime: 'server',
          sessionId: `session-resume-model-${modelContract}`,
          model: 'kiro-test',
          onEvent: event => events.push(event)
        }
      )
      if (modelContract === 'absent') {
        await expect(promise).rejects.toThrow('only Default or an exact advertised native model is valid')
        expect(events.filter(event => event.type === 'init')).toHaveLength(0)
      } else {
        const session = await promise
        const initEvent = events.find(event => event.type === 'init')
        expect(initEvent?.type === 'init' ? initEvent.data.model : undefined).toBe('kiro-test')
        session.stop?.()
        await waitFor(() => events.some(event => event.type === 'exit'))
      }
    }
  })
})
