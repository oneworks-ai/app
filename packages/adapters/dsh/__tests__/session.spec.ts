import '../src/adapter-config'

import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent } from '@oneworks/types'
import { resolveProjectOoPath } from '@oneworks/utils'

import { createDshSession } from '../src/runtime/session'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-dsh-acp.mjs')

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for DSH fixture events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const createCtx = (cwd: string, overrides: NodeJS.ProcessEnv = {}): AdapterCtx => ({
  ctxId: 'ctx-dsh-test',
  cwd,
  env: {
    HOME: cwd,
    PATH: process.env.PATH,
    DEEPSEEK_API_KEY: 'fixture-key-never-log',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.test/v1',
    NODE_OPTIONS: '--require=/private/oneworks-loader.cjs',
    __ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__: fixturePath,
    __ONEWORKS_PROJECT_REAL_HOME__: cwd,
    ...overrides
  },
  cache: {
    get: async () => undefined,
    set: async () => ({ cachePath: join(cwd, '.oo', 'cache.json') })
  },
  logger: {
    stream: new PassThrough(),
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined
  },
  configs: [{
    adapters: {
      dsh: {
        allowUnrestrictedReadNetwork: true,
        cli: { path: fixturePath, source: 'path' }
      }
    }
  }, undefined]
})

describe('dsh ACP session', () => {
  let workspace: string | undefined

  afterEach(async () => {
    if (workspace != null) await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  })

  it('maps the official ACP text and permission baseline with a sanitized child environment', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-session-'))
    await chmod(fixturePath, 0o755)
    const events: AdapterOutputEvent[] = []
    const session = await createDshSession(createCtx(workspace), {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      model: 'deepseek-v4-pro',
      effort: 'high',
      permissionMode: 'default',
      sessionId: 'dsh-session-1',
      description: 'Implement the fixture.',
      onEvent: event => events.push(event)
    })

    await waitFor(() => events.some(event => event.type === 'interaction_request'))
    const interaction = events.find(event => event.type === 'interaction_request')
    expect(interaction?.type === 'interaction_request' && interaction.data.payload.options).toEqual([
      expect.objectContaining({ value: 'allow_once' }),
      expect.objectContaining({ value: 'deny_once' }),
      expect.objectContaining({ value: expect.stringMatching(/^dsh-native-option:/u) })
    ])
    await session.respondInteraction?.(
      interaction?.type === 'interaction_request' ? interaction.data.id : '',
      'allow_session'
    )
    await waitFor(() => events.some(event => event.type === 'stop'))

    const textEvent = events.find(event => (
      event.type === 'message' && event.data.role === 'assistant' && typeof event.data.content === 'string'
    ))
    expect(events.filter(event => (
      event.type === 'message' && event.data.role === 'assistant' && typeof event.data.content === 'string'
    ))).toHaveLength(1)
    expect(textEvent?.type === 'message' && textEvent.data.id).toMatch(/^dsh-message:/u)
    const payload = JSON.parse(
      textEvent?.type === 'message' && typeof textEvent.data.content === 'string' ? textEvent.data.content : '{}'
    ) as Record<string, unknown>
    expect(payload).toMatchObject({
      apiKeyEcho: '<redacted>',
      baseUrlEcho: '<redacted>',
      hasApiKey: true,
      prompt: 'Implement the fixture.',
      permission: { outcome: 'selected', optionId: 'native-allow-once' }
    })
    expect(payload).not.toHaveProperty('nodeOptions')
    expect(payload.dshHome).toBe('<DSH_SESSION_ROOT>/home')
    expect(payload.processCwd).toBe('<DSH_SESSION_ROOT>')
    expect(payload.processCwd).not.toBe(workspace)
    expect(payload.composition).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-acp-demo',
      '@deepseek-ai/dsh-llm-deepseek',
      '@deepseek-ai/dsh-sandbox-policy',
      '@deepseek-ai/dsh-tool-fs'
    ]))
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'init', data: expect.objectContaining({ adapter: 'dsh' }) }),
      expect.objectContaining({ type: 'stop' })
    ]))
    expect(JSON.stringify(events)).not.toContain('fixture-key-never-log')

    session.emit({ type: 'message', content: [{ type: 'text', text: 'Continue the fixture.' }] })
    await waitFor(() => events.filter(event => event.type === 'interaction_request').length === 2)
    const secondInteraction = events.filter(event => event.type === 'interaction_request')[1]
    await session.respondInteraction?.(
      secondInteraction?.type === 'interaction_request' ? secondInteraction.data.id : '',
      'allow_once'
    )
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)
    const assistantTexts = events.filter((event): event is Extract<AdapterOutputEvent, { type: 'message' }> => (
      event.type === 'message' && event.data.role === 'assistant' && typeof event.data.content === 'string'
    ))
    expect(assistantTexts).toHaveLength(2)
    expect(JSON.parse(assistantTexts[1]?.data.content as string)).toMatchObject({
      prompt: 'Continue the fixture.',
      permission: { outcome: 'selected', optionId: 'native-allow-once' }
    })
    expect(assistantTexts[1]?.data.id).not.toBe(assistantTexts[0]?.data.id)
    const turnCountBeforeStop = assistantTexts.length
    session.stop?.()
    session.emit({ type: 'message', content: [{ type: 'text', text: 'Must not run after stop.' }] })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(events.filter(event => (
      event.type === 'message' && event.data.role === 'assistant' && typeof event.data.content === 'string'
    ))).toHaveLength(turnCountBeforeStop)
  })

  it('fails closed before spawn when the API key is unavailable', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-missing-key-'))
    const ctx = createCtx(workspace)
    delete ctx.env.DEEPSEEK_API_KEY
    await expect(createDshSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'dsh-session-missing-key',
      onEvent: () => undefined
    })).rejects.toThrow('DSH requires DEEPSEEK_API_KEY')
  })

  it('terminates a child that stays alive without completing ACP startup', async () => {
    if (process.platform === 'win32') return
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-startup-timeout-'))
    const hangingBinary = join(workspace, 'hanging-dsh')
    await writeFile(hangingBinary, '#!/bin/sh\nsleep 30\n')
    await chmod(hangingBinary, 0o755)
    const ctx = createCtx(workspace)
    ctx.env.__ONEWORKS_PROJECT_ADAPTER_DSH_CLI_PATH__ = hangingBinary
    ctx.configs = [{
      adapters: {
        dsh: {
          allowUnrestrictedReadNetwork: true,
          cli: { path: hangingBinary, source: 'path' },
          startupTimeoutMs: 100
        }
      }
    }, undefined]
    await expect(createDshSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'dsh-session-startup-timeout',
      onEvent: () => undefined
    })).rejects.toThrow('startup timed out')
  })

  it('requires an explicit acknowledgement of the upstream read and network boundary', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-boundary-'))
    const ctx = createCtx(workspace)
    ctx.configs = [{ adapters: { dsh: { cli: { path: fixturePath, source: 'path' } } } }, undefined]
    await expect(createDshSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'dsh-session-boundary',
      onEvent: () => undefined
    })).rejects.toThrow('does not confine host file reads or network access')
  })

  it('rejects unsafe session identifiers before creating runtime files', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-path-'))
    await expect(createDshSession(createCtx(workspace), {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: '../escape',
      onEvent: () => undefined
    })).rejects.toThrow('opaque path segment')
  })

  it('rejects unknown model selectors instead of silently changing provider routing', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-model-'))
    await expect(createDshSession(createCtx(workspace), {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      model: 'custom-service,unknown-model',
      sessionId: 'dsh-session-model',
      onEvent: () => undefined
    })).rejects.toThrow('select deepseek-v4-flash or deepseek-v4-pro')
  })

  it('fails closed on permission requests when dontAsk is selected', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-dont-ask-'))
    const events: AdapterOutputEvent[] = []
    const session = await createDshSession(createCtx(workspace), {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      permissionMode: 'dontAsk',
      sessionId: 'dsh-session-dont-ask',
      description: 'Do not ask.',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'stop'))
    expect(events.some(event => event.type === 'interaction_request')).toBe(false)
    const text = events.find(event => event.type === 'message' && event.data.role === 'assistant')
    expect(JSON.parse(text?.type === 'message' ? text.data.content as string : '{}')).toMatchObject({
      permission: { outcome: 'cancelled' }
    })
    session.stop?.()
  })

  it('forwards an explicitly selected current native persistent option without token collision', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-native-option-'))
    const events: AdapterOutputEvent[] = []
    const session = await createDshSession(createCtx(workspace), {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'dsh-session-native-option',
      description: 'Use the native option.',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'interaction_request'))
    const interaction = events.find(event => event.type === 'interaction_request')
    const nativeValue = interaction?.type === 'interaction_request'
      ? interaction.data.payload.options?.find(option => option.label === 'Allow persistently')?.value
      : undefined
    expect(nativeValue).toMatch(/^dsh-native-option:/u)
    await session.respondInteraction?.(
      interaction?.type === 'interaction_request' ? interaction.data.id : '',
      nativeValue!
    )
    await waitFor(() => events.some(event => event.type === 'stop'))
    const text = events.find(event => event.type === 'message' && event.data.role === 'assistant')
    expect(JSON.parse(text?.type === 'message' ? text.data.content as string : '{}')).toMatchObject({
      permission: { outcome: 'selected', optionId: 'native-allow-always' }
    })
    session.stop?.()
  })

  it('rejects resume before creating a new native session', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-resume-'))
    await expect(createDshSession(createCtx(workspace), {
      type: 'resume',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'dsh-session-resume',
      onEvent: () => undefined
    })).rejects.toThrow('fresh automation sessions only')
  })

  it('rejects image data without forwarding it as text', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-image-'))
    const events: AdapterOutputEvent[] = []
    const session = await createDshSession(createCtx(workspace), {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId: 'dsh-session-image',
      onEvent: event => events.push(event)
    })
    const imageUrl = 'data:image/png;base64,private-image-payload'
    session.emit({ type: 'message', content: [{ type: 'image', url: imageUrl }] })
    await waitFor(() => events.some(event => event.type === 'stop'))

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ code: 'dsh_media_unsupported', fatal: false })
      })
    ]))
    expect(JSON.stringify(events)).not.toContain(imageUrl)
    expect(events.some(event => event.type === 'interaction_request')).toBe(false)
    session.stop?.()
  })

  it('writes a private JSON-compatible composition without persisting the API key', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ow-dsh-config-'))
    const ctx = createCtx(workspace)
    const sessionId = 'dsh-session-config'
    const session = await createDshSession(ctx, {
      type: 'create',
      runtime: 'server',
      mode: 'stream',
      sessionId,
      onEvent: () => undefined
    })
    const sessionCacheRoot = resolveProjectOoPath(
      workspace,
      ctx.env,
      'caches',
      ctx.ctxId,
      sessionId,
      'adapter-dsh'
    )
    const runtimeDirs = await readdir(sessionCacheRoot)
    const matchingRuntimeDirs = runtimeDirs.filter(name => name.startsWith('runtime-'))
    expect(matchingRuntimeDirs).toHaveLength(1)
    const configPath = join(sessionCacheRoot, matchingRuntimeDirs[0]!, 'cordis.yml')
    const config = await readFile(configPath, 'utf8')
    expect(() => JSON.parse(config)).not.toThrow()
    expect(config).not.toContain('fixture-key-never-log')
    session.stop?.()
  })
})
