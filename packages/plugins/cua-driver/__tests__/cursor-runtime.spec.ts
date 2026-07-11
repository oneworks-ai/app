import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cursorRuntime = require('../bin/cursor-runtime.cjs') as {
  createSessionCursorController: (options: {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
    cursorDir?: string
    defaultColor?: string
    sessionId: string
    strategy?: string
    withLock?: (task: () => Promise<unknown>) => Promise<unknown>
  }) => {
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
    getState: () => { color: string; sessionId: string; source: string }
    setColor: (color: string) => { color: string; sessionId: string; source: string }
  }
  deriveSessionCursorColor: (sessionId: string) => string
  materializeCursorSvg: (options: {
    color: string
    cursorDir: string
    sessionId: string
  }) => Promise<string>
  normalizeCursorColor: (color: unknown) => string | undefined
  renderCursorSvg: (color: string) => string
  resolveInitialCursorColor: (options: {
    defaultColor?: string
    sessionId: string
    strategy?: string
  }) => string
  withCursorActionLock: <T>(
    task: () => Promise<T>,
    options: { lockHost?: string; lockPort: number; timeoutMs?: number }
  ) => Promise<T>
}

const getAvailablePort = () => new Promise<number>((resolvePort, rejectPort) => {
  const server = createServer()
  server.once('error', rejectPort)
  server.listen({ host: '127.0.0.1', port: 0 }, () => {
    const address = server.address()
    const port = typeof address === 'object' && address != null ? address.port : undefined
    server.close(error => {
      if (error != null) rejectPort(error)
      else if (port == null) rejectPort(new Error('Could not reserve a test port.'))
      else resolvePort(port)
    })
  })
})

describe('cua session cursor runtime', () => {
  it('normalizes only safe CSS hex colors and renders a rounded bordered SVG', () => {
    expect(cursorRuntime.normalizeCursorColor('#6bf')).toBe('#66BBFF')
    expect(cursorRuntime.normalizeCursorColor('#625bf6')).toBe('#625BF6')
    expect(cursorRuntime.normalizeCursorColor('#fff"><script>')).toBeUndefined()

    const svg = cursorRuntime.renderCursorSvg('#E3E7ED')
    expect(svg).toContain('fill="#E3E7ED"')
    expect(svg).toContain('stroke="#596273"')
    expect(svg).toContain('stroke-linejoin="round"')
    expect(() => cursorRuntime.renderCursorSvg('#fff"><script>')).toThrow('CSS hex color')
  })

  it('assigns deterministic session colors while preserving a fixed configured default', () => {
    expect(cursorRuntime.deriveSessionCursorColor('session-a'))
      .toBe(cursorRuntime.deriveSessionCursorColor('session-a'))
    expect(cursorRuntime.deriveSessionCursorColor('session-a'))
      .not.toBe(cursorRuntime.deriveSessionCursorColor('session-b'))
    expect(cursorRuntime.resolveInitialCursorColor({
      defaultColor: '#abc',
      sessionId: 'session-a',
      strategy: 'fixed'
    })).toBe('#AABBCC')
  })

  it('generates the session SVG and atomically applies its style before every pointer action', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-session-cursor-'))
    const events: Array<{ args?: Record<string, unknown>; name: string }> = []
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-violet',
      cursorDir,
      async callTool(name, args) {
        events.push({ name, args })
        return { structuredContent: { ok: true } }
      },
      async withLock(task) {
        events.push({ name: 'lock:start' })
        const result = await task()
        events.push({ name: 'lock:end' })
        return result
      }
    })

    try {
      expect(controller.setColor('#625bf6')).toEqual(expect.objectContaining({
        color: '#625BF6',
        source: 'agent'
      }))
      await controller.callTool('click', { element_index: 4 })

      expect(events.map(event => event.name)).toEqual([
        'lock:start',
        'set_agent_cursor_style',
        'click',
        'lock:end'
      ])
      const imagePath = events[1].args?.image_path
      expect(imagePath).toEqual(expect.stringContaining('625bf6.svg'))
      await expect(readFile(imagePath as string, 'utf8')).resolves.toContain('fill="#625BF6"')
      expect(events[1].args).toEqual({
        bloom_color: '#625BF6',
        image_path: imagePath
      })
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('never trusts a pre-existing cursor file with different content', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-conflicting-cursor-'))
    const sessionId = 'session-conflict'
    const sessionKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
    const predictablePath = join(cursorDir, `cursor-${sessionKey}-625bf6.svg`)
    try {
      await writeFile(predictablePath, '<svg><script>untrusted</script></svg>')
      const generatedPath = await cursorRuntime.materializeCursorSvg({
        color: '#625BF6',
        cursorDir,
        sessionId
      })
      expect(generatedPath).not.toBe(predictablePath)
      await expect(readFile(generatedPath, 'utf8')).resolves.toContain('fill="#625BF6"')
      await expect(readFile(generatedPath, 'utf8')).resolves.not.toContain('script')
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('does not serialize or mutate the global pointer style for non-pointer tools', async () => {
    let locked = false
    const calls: string[] = []
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-read',
      async callTool(name) {
        calls.push(name)
        return { structuredContent: { ok: true } }
      },
      async withLock(task) {
        locked = true
        return await task()
      }
    })

    await controller.callTool('get_window_state', { pid: 42 })
    expect(calls).toEqual(['get_window_state'])
    expect(locked).toBe(false)
  })

  it('serializes pointer action transactions that share the cross-process lock', async () => {
    const lockPort = await getAvailablePort()
    const events: string[] = []
    let releaseFirst!: () => void
    let notifyFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => { notifyFirstStarted = resolve })
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = cursorRuntime.withCursorActionLock(async () => {
      events.push('first:start')
      notifyFirstStarted()
      await firstGate
      events.push('first:end')
    }, { lockPort, timeoutMs: 1000 })
    await firstStarted

    const second = cursorRuntime.withCursorActionLock(async () => {
      events.push('second:start')
      events.push('second:end')
    }, { lockPort, timeoutMs: 1000 })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(events).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('releases the kernel lock when a pointer transaction fails', async () => {
    const lockPort = await getAvailablePort()
    await expect(cursorRuntime.withCursorActionLock(async () => {
      throw new Error('pointer failed')
    }, { lockPort, timeoutMs: 500 })).rejects.toThrow('pointer failed')
    await expect(cursorRuntime.withCursorActionLock(
      async () => 'recovered',
      { lockPort, timeoutMs: 500 }
    )).resolves.toBe('recovered')
  })
})
