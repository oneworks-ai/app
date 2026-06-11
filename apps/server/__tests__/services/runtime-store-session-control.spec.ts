import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createServerRuntimeSession } from '#~/services/runtime-store/session-control.js'

const mocks = vi.hoisted(() => ({
  watchRuntimeStoreRoot: vi.fn()
}))

vi.mock('#~/services/runtime-store/watcher.js', () => ({
  watchRuntimeStoreRoot: mocks.watchRuntimeStoreRoot
}))

describe('runtime store session control', () => {
  it('creates ordinary web sessions as runtime-store engine sessions', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'ow-web-runtime-session-'))
    const result = await createServerRuntimeSession({
      adapter: 'codex',
      cwd: workspace,
      message: 'Implement the web task',
      model: 'mock,codex',
      promptName: 'client',
      promptType: 'workspace',
      sessionId: 'sess-web',
      systemPrompt: '历史上下文',
      title: 'Web task'
    })

    const meta = JSON.parse(await readFile(path.join(result.storePath, 'meta.json'), 'utf8')) as Record<string, unknown>
    const commands = (await readFile(path.join(result.storePath, 'commands.jsonl'), 'utf8')).trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
    const state = JSON.parse(await readFile(path.join(result.storePath, 'state.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const systemPrompt = await readFile(path.join(result.storePath, 'system-prompt.txt'), 'utf8')

    expect(meta).toMatchObject({
      sessionId: 'sess-web',
      title: 'Web task',
      cwd: workspace,
      adapter: 'codex',
      model: 'mock,codex',
      promptType: 'workspace',
      promptName: 'client',
      systemPrompt: '历史上下文',
      needsEngineConsumer: true
    })
    expect(commands[0]).toMatchObject({
      sessionId: 'sess-web',
      type: 'start',
      source: 'web',
      content: 'Implement the web task',
      messageDelivery: 'initial_prompt',
      taskType: 'workspace',
      name: 'client',
      systemPrompt: '历史上下文'
    })
    expect(state).toMatchObject({
      sessionId: 'sess-web',
      status: 'starting',
      needsEngineConsumer: true
    })
    expect(systemPrompt).toBe('历史上下文')
    expect(mocks.watchRuntimeStoreRoot).toHaveBeenCalledWith(result.runtimeRoot)
  })

  it('keeps structured initial content on bridge delivery', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'ow-web-runtime-session-structured-'))
    const result = await createServerRuntimeSession({
      cwd: workspace,
      content: [{ type: 'file', path: '/tmp/spec.md' }],
      message: 'Context file: /tmp/spec.md',
      sessionId: 'sess-web-file',
      title: 'Web file task'
    })

    const commands = (await readFile(path.join(result.storePath, 'commands.jsonl'), 'utf8')).trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)

    expect(commands[0]).toMatchObject({
      sessionId: 'sess-web-file',
      content: 'Context file: /tmp/spec.md',
      messageDelivery: 'bridge',
      contentItems: [{ type: 'file', path: '/tmp/spec.md' }]
    })
  })

  it('creates dormant runtime sessions for whole-session forks', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'ow-web-runtime-session-dormant-'))
    const result = await createServerRuntimeSession({
      cwd: workspace,
      sessionId: 'sess-fork',
      start: false,
      systemPrompt: '历史上下文',
      title: 'Forked session'
    })

    const state = JSON.parse(await readFile(path.join(result.storePath, 'state.json'), 'utf8')) as Record<
      string,
      unknown
    >
    await expect(readFile(path.join(result.storePath, 'commands.jsonl'), 'utf8')).rejects.toThrow()
    expect(state).toMatchObject({
      sessionId: 'sess-fork',
      status: 'completed',
      needsEngineConsumer: true
    })
  })
})
