import '../src/adapter-config'

import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterCtx, AdapterOutputEvent, Cache } from '@oneworks/types'

import { createPiSession } from '#~/runtime/session/session.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for Pi adapter events')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const createCtx = (cwd: string, projectHome: string, realHome: string, binaryPath: string): AdapterCtx => {
  const cache = new Map<keyof Cache, Cache[keyof Cache]>()
  return {
    ctxId: 'ctx-pi-test',
    cwd,
    env: {
      __ONEWORKS_PROJECT_ADAPTER_PI_CLI_PATH__: binaryPath,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      PI_TEST_RECORD_PATH: join(cwd, 'commands.jsonl')
    },
    cache: {
      get: async key => cache.get(key) as never,
      set: async (key, value) => {
        cache.set(key, value)
        return { cachePath: join(projectHome, `${String(key)}.json`) }
      }
    },
    logger: {
      stream: new PassThrough(),
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined
    },
    configs: [{
      adapters: { pi: {} },
      modelServices: {
        mock: {
          apiBaseUrl: 'http://127.0.0.1:9876/responses',
          apiKey: 'mock-secret',
          models: ['pi-test'],
          extra: { pi: { api: 'openai-responses' } }
        }
      }
    }, undefined]
  }
}

const writeFakePi = async (
  path: string,
  options: {
    ignoreAbort?: boolean
    ignorePrompt?: boolean
    rejectPrompt?: boolean
    retryThenSuccess?: boolean
    retryUntilAbort?: boolean
    synchronousFinish?: boolean
    terminalModelError?: boolean
  } = {}
) => {
  await writeFile(
    path,
    `#!${process.execPath}
import { appendFile } from 'node:fs/promises';
let buffer = '';
let running = false;
let promptCount = 0;
const terminalModelError = ${JSON.stringify(options.terminalModelError === true)};
const retryThenSuccess = ${JSON.stringify(options.retryThenSuccess === true)};
const retryUntilAbort = ${JSON.stringify(options.retryUntilAbort === true)};
const synchronousFinish = ${JSON.stringify(options.synchronousFinish === true)};
let outputBatch;
const out = value => outputBatch == null
  ? process.stdout.write(JSON.stringify(value) + '\\n')
  : outputBatch.push(value);
const flushOutput = () => {
  const values = outputBatch;
  outputBatch = undefined;
  process.stdout.write(values.map(value => JSON.stringify(value)).join('\\n') + '\\n');
};
const record = value => appendFile(process.env.PI_TEST_RECORD_PATH, JSON.stringify(value) + '\\n');
const finishTurn = (text, withTool) => {
  const failTurn = terminalModelError && promptCount === 1;
  out({ type: 'agent_start' });
  out({ type: 'message_start', message: { role: 'assistant', content: [] } });
  out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } });
  if (withTool) {
    out({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'README.md' } });
    out({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'read', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false });
  }
  out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], provider: 'mock', model: 'pi-test', responseId: 'response-' + promptCount, stopReason: failTurn ? 'error' : 'stop', ...(failTurn ? { errorMessage: 'provider request failed' } : {}), usage: { input: 4, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 7, cost: { total: 0.001 } } } });
  if (retryUntilAbort && failTurn) {
    out({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1000, errorMessage: 'provider request failed' });
    return;
  }
  if (retryThenSuccess && failTurn) {
    out({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 1, errorMessage: 'provider request failed' });
    out({ type: 'message_start', message: { role: 'assistant', content: [] } });
    out({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'RECOVERED_OK' } });
    out({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'RECOVERED_OK' }], provider: 'mock', model: 'pi-test', responseId: 'response-retry', stopReason: 'stop', usage: { input: 4, output: 2 } } });
    out({ type: 'auto_retry_end', success: true, attempt: 1 });
  }
  running = false;
  out({ type: 'agent_settled' });
};
const finish = (text, withTool) => synchronousFinish
  ? finishTurn(text, withTool)
  : setTimeout(() => finishTurn(text, withTool), 30);
const handle = async command => {
  await record(command);
  if (command.type === 'get_state') return out({ type: 'response', id: command.id, command: command.type, success: true, data: { sessionId: 'session-real', sessionName: 'Pi test', model: { provider: 'mock', id: 'pi-test' }, thinkingLevel: 'high', isStreaming: running } });
  if (command.type === 'get_commands') return out({ type: 'response', id: command.id, command: command.type, success: true, data: { commands: [{ name: 'compact' }] } });
  if (command.type === 'prompt') {
    if (${JSON.stringify(options.ignorePrompt === true)}) return;
    if (${JSON.stringify(options.rejectPrompt === true)}) {
      return out({ type: 'response', id: command.id, command: command.type, success: false, error: 'missing model authentication' });
    }
    if (synchronousFinish) outputBatch = [];
    out({ type: 'response', id: command.id, command: command.type, success: true });
    if (command.streamingBehavior === 'steer') {
      if (synchronousFinish) flushOutput();
      return;
    }
    running = true;
    promptCount += 1;
    finish(promptCount === 1 ? 'FIRST_OK' : 'FOLLOW_UP_OK', promptCount === 1);
    if (synchronousFinish) flushOutput();
    return;
  }
  if (command.type === 'abort') {
    if (${JSON.stringify(options.ignoreAbort === true)}) return;
    out({ type: 'response', id: command.id, command: command.type, success: true });
    if (retryUntilAbort && running) {
      out({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'Retry cancelled' });
      running = false;
      out({ type: 'agent_settled' });
    }
    return;
  }
};
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) void handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
`
  )
  await chmod(path, 0o755)
}

describe('createPiSession', () => {
  it('runs a real JSONL child process, streams a turn, steers, and follows up', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-session-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFile(join(realHome, '.pi', 'agent', 'auth.json'), '{"mock":"auth"}\n')
    await writeFakePi(binaryPath)
    const events: AdapterOutputEvent[] = []

    const session = await createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-real',
      model: 'mock,pi-test',
      effort: 'high',
      permissionMode: 'default',
      description: 'initial',
      assetPlan: { adapter: 'pi', diagnostics: [], mcpServers: {}, overlays: [] },
      onEvent: event => events.push(event)
    })
    session.emit({ type: 'message', content: [{ type: 'text', text: 'steer now' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)
    session.emit({ type: 'message', content: [{ type: 'text', text: 'follow up' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({ uuid: 'session-real', model: 'mock/pi-test', slashCommands: ['compact'] })
    }))
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message', data: expect.objectContaining({ content: 'FIRST_OK' }) })
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message', data: expect.objectContaining({ content: 'FOLLOW_UP_OK' }) })
    )
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'usage', data: expect.objectContaining({ inputTokens: 4 }) })
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({
        content: [expect.objectContaining({ type: 'tool_use', name: 'read' })]
      })
    }))

    const commands = (await readFile(join(workspace, 'commands.jsonl'), 'utf8')).trim().split('\n').map(line =>
      JSON.parse(line)
    )
    expect(commands).toContainEqual(
      expect.objectContaining({ type: 'prompt', message: 'steer now', streamingBehavior: 'steer' })
    )
    expect(commands).toContainEqual(expect.objectContaining({ type: 'prompt', message: 'follow up' }))

    const agentDir = join(projectHome, 'caches', 'ctx-pi-test', 'session-real', 'adapter-pi', 'agent')
    await expect(readFile(join(agentDir, 'auth.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const modelsFile = await readFile(join(agentDir, 'models.json'), 'utf8')
    expect(modelsFile).not.toContain('mock-secret')
    expect(modelsFile).toContain('openai-responses')
  })

  it('terminates an idle turn when Pi rejects prompt preflight', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-preflight-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { rejectPrompt: true })
    const events: AdapterOutputEvent[] = []

    await expect(createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-preflight',
      model: 'mock,pi-test',
      permissionMode: 'default',
      description: 'initial',
      onEvent: event => events.push(event)
    })).rejects.toThrow('missing model authentication')
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events).toContainEqual(expect.objectContaining({
      type: 'operation',
      data: expect.objectContaining({ type: 'operation_failed', message: 'missing model authentication' })
    }))
    expect(events).toContainEqual({
      type: 'error',
      data: { message: 'missing model authentication', fatal: true }
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: 1 })
    }))
    expect(events).not.toContainEqual({ type: 'stop' })
  })

  it('terminates a provider-failed turn with exit code one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-provider-error-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { terminalModelError: true })
    const events: AdapterOutputEvent[] = []

    await createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-provider-error',
      model: 'mock,pi-test',
      permissionMode: 'default',
      description: 'initial',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'exit'))

    expect(events).toContainEqual({
      type: 'error',
      data: { message: 'provider request failed', fatal: true }
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: 1 })
    }))
    expect(events).not.toContainEqual({ type: 'stop' })
  })

  it('allows Pi to recover a failed model message through auto-retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-retry-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { retryThenSuccess: true, terminalModelError: true })
    const events: AdapterOutputEvent[] = []

    const session = await createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-retry',
      model: 'mock,pi-test',
      permissionMode: 'default',
      description: 'initial',
      onEvent: event => events.push(event)
    })
    await waitFor(() => events.some(event => event.type === 'stop'))

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message', data: expect.objectContaining({ content: 'RECOVERED_OK' }) })
    )
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events.some(event => event.type === 'exit')).toBe(false)
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('keeps the session reusable after interrupting Pi during retry backoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-interrupt-retry-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { retryUntilAbort: true, terminalModelError: true })
    const events: AdapterOutputEvent[] = []

    const session = await createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-interrupt-retry',
      model: 'mock,pi-test',
      permissionMode: 'default',
      description: 'initial',
      onEvent: event => events.push(event)
    })
    await waitFor(() =>
      events.some(event => (
        event.type === 'operation' && event.data.operationId === 'pi-retry' && event.data.type === 'operation_started'
      ))
    )
    session.emit({ type: 'interrupt' })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 1)

    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events.some(event => event.type === 'exit')).toBe(false)
    session.emit({ type: 'message', content: [{ type: 'text', text: 'continue after interrupt' }] })
    await waitFor(() => events.filter(event => event.type === 'stop').length === 2)
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message', data: expect.objectContaining({ content: 'FOLLOW_UP_OK' }) })
    )
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'))
  })

  it('rejects creation when a provider failure settles in the prompt response chunk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-synchronous-error-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { synchronousFinish: true, terminalModelError: true })
    const events: AdapterOutputEvent[] = []

    await expect(createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-synchronous-error',
      model: 'mock,pi-test',
      permissionMode: 'default',
      description: 'initial',
      onEvent: event => events.push(event)
    })).rejects.toThrow('provider request failed')
    expect(events).toContainEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: 1 })
    }))
  })

  it('stops promptly without waiting for an abort response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-stop-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { ignoreAbort: true })
    const events: AdapterOutputEvent[] = []
    const session = await createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-stop',
      model: 'mock,pi-test',
      permissionMode: 'default',
      onEvent: event => events.push(event)
    })

    const startedAt = Date.now()
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'), 2_000)

    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  it('does not turn a user stop during prompt preflight into a fatal error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-pi-stop-preflight-'))
    tempDirs.push(root)
    const workspace = join(root, 'workspace')
    const projectHome = join(root, 'project-home')
    const realHome = join(root, 'real-home')
    const binaryPath = join(root, 'fake-pi.mjs')
    await mkdir(join(realHome, '.pi', 'agent'), { recursive: true })
    await mkdir(workspace, { recursive: true })
    await writeFakePi(binaryPath, { ignorePrompt: true })
    const events: AdapterOutputEvent[] = []
    const session = await createPiSession(createCtx(workspace, projectHome, realHome, binaryPath), {
      type: 'create',
      runtime: 'cli',
      sessionId: 'session-stop-preflight',
      model: 'mock,pi-test',
      permissionMode: 'default',
      onEvent: event => events.push(event)
    })

    session.emit({ type: 'message', content: [{ type: 'text', text: 'pending prompt' }] })
    const commandPath = join(workspace, 'commands.jsonl')
    await waitFor(() => {
      try {
        return readFileSync(commandPath, 'utf8').includes('"type":"prompt"')
      } catch {
        return false
      }
    })
    session.stop?.()
    await waitFor(() => events.some(event => event.type === 'exit'), 2_000)

    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'exit',
      data: expect.objectContaining({ exitCode: 0 })
    }))
  })
})
