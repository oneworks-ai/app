import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cursorRuntime = require('../bin/cursor-runtime.cjs') as {
  createSessionCursorController: (options: {
    callTool: (
      name: string,
      args: Record<string, unknown>,
      actionStyle?: {
        cursorColor?: string
        cursorStart?: { x: number; y: number }
        cursorStartPending?: boolean
        runId?: string
      }
    ) => Promise<unknown>
    cursorDir?: string
    defaultColor?: string
    lockOptions?: { lockKey: string; timeoutMs?: number }
    sessionId: string
    strategy?: string
    withLock?: (task: () => Promise<unknown>) => Promise<unknown>
  }) => {
    callTool: (
      name: string,
      args: Record<string, unknown>,
      actionStyle?: {
        cursorColor?: string
        cursorStart?: { x: number; y: number }
        cursorStartPending?: boolean
        runId?: string
      }
    ) => Promise<unknown>
    getState: () => Record<string, unknown>
    setColor: (color: string) => { color: string; sessionId: string; source: string }
    setStartPosition: (position?: { x: number; y: number }) => {
      position: { mode: string } | { x: number; y: number }
      sessionId: string
      source: string
    }
  }
  deriveSessionCursorColor: (sessionId: string) => string
  materializeCursorSvg: (options: {
    color: string
    cursorDir: string
    sessionId: string
  }) => Promise<string>
  normalizeCursorColor: (color: unknown) => string | undefined
  normalizeCursorStart: (position: unknown) => { x: number; y: number } | undefined
  resolveInitialCursorColor: (options: {
    defaultColor?: string
    sessionId: string
    strategy?: string
  }) => string
  withCursorActionLock: <T>(
    task: () => Promise<T>,
    options: { lockKey: string; timeoutMs?: number }
  ) => Promise<T>
}

const uniqueLockKey = () => `cursor-test:${randomUUID()}`

describe('cua session cursor runtime', () => {
  it('normalizes only safe CSS hex colors while the shared package owns SVG rendering', () => {
    expect(cursorRuntime.normalizeCursorColor('#6bf')).toBe('#66BBFF')
    expect(cursorRuntime.normalizeCursorColor('#625bf6')).toBe('#625BF6')
    expect(cursorRuntime.normalizeCursorColor('#fff"><script>')).toBeUndefined()
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

  it('configures direct motion once and atomically applies session style before every pointer action', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-session-cursor-'))
    const events: Array<{ args?: Record<string, unknown>; name: string }> = []
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-violet',
      cursorDir,
      async callTool(name, args) {
        events.push({ name, args })
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 982, width: 1512 } }
        }
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
      await controller.callTool('click', { element_index: 5 })

      expect(events.map(event => event.name)).toEqual([
        'lock:start',
        'set_agent_cursor_motion',
        'set_agent_cursor_style',
        'get_screen_size',
        'move_cursor',
        'click',
        'lock:end',
        'lock:start',
        'set_agent_cursor_style',
        'click',
        'lock:end'
      ])
      expect(events[1].args).toEqual({
        dwell_after_click_ms: 125,
        glide_duration_ms: 180,
        idle_hide_ms: 0,
        turn_radius: 1
      })
      const imagePath = events[2].args?.image_path
      expect(imagePath).toEqual(expect.stringContaining('625bf6.svg'))
      await expect(readFile(imagePath as string, 'utf8')).resolves.toContain('fill="#625BF6"')
      expect(events[2].args).toEqual({
        bloom_color: '#625BF6',
        image_path: imagePath
      })
      expect(events[4].args).toEqual({ x: 756, y: 491 })
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('lets the agent configure a bounded logical start for the next pointer action', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-position-cursor-'))
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = []
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-position',
      cursorDir,
      async callTool(name, args) {
        calls.push({ args, name })
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 800, width: 1200 } }
        }
        return { structuredContent: { ok: true } }
      },
      async withLock(task) {
        return await task()
      }
    })

    try {
      expect(controller.setStartPosition({ x: 120, y: 240 })).toEqual({
        position: { x: 120, y: 240 },
        sessionId: 'session-position',
        source: 'agent'
      })
      await controller.callTool('click', { element_index: 4 })
      expect(calls.find(call => call.name === 'move_cursor')?.args).toEqual({ x: 120, y: 240 })

      controller.setStartPosition({ x: 1200, y: 240 })
      await expect(controller.callTool('click', { element_index: 5 }))
        .rejects.toThrow('outside the main display')
      expect(calls.filter(call => call.name === 'click')).toHaveLength(1)
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('binds cursor color and start snapshots to the pointer action that reserved them', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-snapshot-cursor-'))
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = []
    let releaseFirstStyle!: () => void
    let notifyFirstStyle!: () => void
    const firstStyleStarted = new Promise<void>(resolve => {
      notifyFirstStyle = resolve
    })
    const firstStyleGate = new Promise<void>(resolve => {
      releaseFirstStyle = resolve
    })
    let styleCalls = 0
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-snapshot',
      cursorDir,
      async callTool(name, args) {
        calls.push({ args, name })
        if (name === 'set_agent_cursor_style') {
          styleCalls += 1
          if (styleCalls === 1) {
            notifyFirstStyle()
            await firstStyleGate
          }
        }
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 800, width: 1200 } }
        }
        return { structuredContent: { ok: true } }
      },
      async withLock(task) {
        return await task()
      }
    })

    try {
      controller.setColor('#625BF6')
      controller.setStartPosition({ x: 100, y: 100 })
      const firstClick = controller.callTool('click', { element_index: 4 })
      await firstStyleStarted

      controller.setColor('#F97316')
      controller.setStartPosition({ x: 900, y: 700 })
      releaseFirstStyle()
      await firstClick
      await controller.callTool('click', { element_index: 5 })

      expect(calls.filter(call => call.name === 'set_agent_cursor_style').map(call => call.args?.bloom_color))
        .toEqual(['#625BF6', '#F97316'])
      expect(calls.filter(call => call.name === 'move_cursor').map(call => call.args))
        .toEqual([{ x: 100, y: 100 }, { x: 900, y: 700 }])
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('keeps concurrent workflow pointer styles bound to their own locked actions', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-workflow-cursor-'))
    const calls: Array<{ args?: Record<string, unknown>; name: string }> = []
    let tail = Promise.resolve()
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-workflows',
      cursorDir,
      async callTool(name, args) {
        calls.push({ args, name })
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 800, width: 1200 } }
        }
        return { structuredContent: { ok: true } }
      },
      withLock(task) {
        const result = tail.then(task, task)
        tail = result.then(() => undefined, () => undefined)
        return result
      }
    })

    try {
      await Promise.all([
        controller.callTool('click', { element_index: 4 }, {
          cursorColor: '#625BF6',
          cursorStart: { x: 100, y: 100 },
          cursorStartPending: true,
          runId: 'run-violet'
        }),
        controller.callTool('click', { element_index: 5 }, {
          cursorColor: '#F97316',
          cursorStart: { x: 900, y: 700 },
          cursorStartPending: true,
          runId: 'run-orange'
        })
      ])

      expect(calls.filter(call => call.name === 'set_agent_cursor_style').map(call => call.args?.bloom_color))
        .toEqual(['#625BF6', '#F97316'])
      expect(calls.filter(call => call.name === 'move_cursor').map(call => call.args))
        .toEqual([{ x: 100, y: 100 }, { x: 900, y: 700 }])
      expect(calls.filter(call => call.name === 'click').map(call => call.args?.element_index)).toEqual([4, 5])
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('retries a reserved start when preparation fails before the virtual pointer moves', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-retry-start-cursor-'))
    const moves: Array<Record<string, unknown>> = []
    let screenChecks = 0
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-retry-start',
      cursorDir,
      async callTool(name, args) {
        if (name === 'get_screen_size') {
          screenChecks += 1
          if (screenChecks === 1) throw new Error('temporary screen lookup failure')
          return { structuredContent: { height: 800, width: 1200 } }
        }
        if (name === 'move_cursor') moves.push(args)
        return { structuredContent: { ok: true } }
      },
      async withLock(task) {
        return await task()
      }
    })

    try {
      controller.setStartPosition({ x: 320, y: 240 })
      await expect(controller.callTool('click', { element_index: 4 }))
        .rejects.toThrow('temporary screen lookup failure')
      await expect(controller.callTool('click', { element_index: 4 })).resolves.toBeDefined()
      expect(moves).toEqual([{ x: 320, y: 240 }])
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('retains a reserved start when the cross-process lock cannot be acquired', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-lock-retry-cursor-'))
    const moves: Array<Record<string, unknown>> = []
    let lockAttempts = 0
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-lock-retry',
      cursorDir,
      async callTool(name, args) {
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 800, width: 1200 } }
        }
        if (name === 'move_cursor') moves.push(args)
        return { structuredContent: { ok: true } }
      },
      async withLock(task) {
        lockAttempts += 1
        if (lockAttempts === 1) throw new Error('lock timeout')
        return await task()
      }
    })

    try {
      controller.setStartPosition({ x: 420, y: 260 })
      await expect(controller.callTool('click', { element_index: 4 }))
        .rejects.toThrow('lock timeout')
      await expect(controller.callTool('click', { element_index: 4 })).resolves.toBeDefined()
      expect(moves).toEqual([{ x: 420, y: 260 }])
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('rejects malformed Agent cursor starts before mutating runtime state', () => {
    expect(cursorRuntime.normalizeCursorStart({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(cursorRuntime.normalizeCursorStart(undefined)).toBeUndefined()
    expect(() => cursorRuntime.normalizeCursorStart({ x: -1, y: 20 })).toThrow('non-negative')
    expect(() => cursorRuntime.normalizeCursorStart({ x: 10, y: Number.NaN })).toThrow('finite')
  })

  it('never trusts a pre-existing cursor file with different content', async () => {
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-conflicting-cursor-'))
    const sessionId = 'session-conflict'
    const sessionKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
    const predictablePath = join(cursorDir, `cursor-up-v3-${sessionKey}-625bf6.svg`)
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
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 800, width: 1200 } }
        }
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

  it('injects session motion once when the first two pointer actions arrive concurrently', async () => {
    const lockKey = uniqueLockKey()
    const cursorDir = await mkdtemp(join(tmpdir(), 'oneworks-concurrent-cursor-'))
    const calls: string[] = []
    const controller = cursorRuntime.createSessionCursorController({
      sessionId: 'session-concurrent',
      cursorDir,
      lockOptions: { lockKey, timeoutMs: 1000 },
      async callTool(name) {
        calls.push(name)
        if (name === 'get_screen_size') {
          return { structuredContent: { height: 800, width: 1200 } }
        }
        return { structuredContent: { ok: true } }
      }
    })
    try {
      await Promise.all([
        controller.callTool('click', { element_index: 4 }),
        controller.callTool('click', { element_index: 5 })
      ])
      expect(calls.filter(name => name === 'set_agent_cursor_motion')).toHaveLength(1)
      expect(calls.filter(name => name === 'set_agent_cursor_style')).toHaveLength(2)
      expect(calls.filter(name => name === 'click')).toHaveLength(2)
    } finally {
      await rm(cursorDir, { force: true, recursive: true })
    }
  })

  it('serializes pointer action transactions that share the cross-process lock', async () => {
    const lockKey = uniqueLockKey()
    const events: string[] = []
    let releaseFirst!: () => void
    let notifyFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => {
      notifyFirstStarted = resolve
    })
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = cursorRuntime.withCursorActionLock(async () => {
      events.push('first:start')
      notifyFirstStarted()
      await firstGate
      events.push('first:end')
    }, { lockKey, timeoutMs: 1000 })
    await firstStarted

    const second = cursorRuntime.withCursorActionLock(async () => {
      events.push('second:start')
      events.push('second:end')
    }, { lockKey, timeoutMs: 1000 })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(events).toEqual(['first:start'])

    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('releases the cross-process lock when a pointer transaction fails', async () => {
    const lockKey = uniqueLockKey()
    await expect(cursorRuntime.withCursorActionLock(async () => {
      throw new Error('pointer failed')
    }, { lockKey, timeoutMs: 500 })).rejects.toThrow('pointer failed')
    await expect(cursorRuntime.withCursorActionLock(
      async () => 'recovered',
      { lockKey, timeoutMs: 500 }
    )).resolves.toBe('recovered')
  })
})
