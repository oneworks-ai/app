import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildPiPermissionExtension } from '#~/runtime/common/permission.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const loadToolCallHandler = async (source: string) => {
  const dir = await mkdtemp(join(tmpdir(), 'oneworks-pi-permission-extension-'))
  tempDirs.push(dir)
  const path = join(dir, 'extension.mjs')
  await writeFile(path, source)
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as {
    default: (pi: { on: (event: string, handler: ToolCallHandler) => void }) => void
  }
  let handler: ToolCallHandler | undefined
  module.default({
    on: (event, candidate) => {
      if (event === 'tool_call') handler = candidate
    }
  })
  if (handler == null) throw new Error('Pi permission extension did not register tool_call')
  return handler
}

type ToolCallHandler = (
  event: { input?: Record<string, unknown>; toolName: string },
  ctx: {
    hasUI: boolean
    signal: AbortSignal
    ui: { select: () => Promise<string | undefined> }
  }
) => Promise<{ block: true; reason: string } | undefined>

const context = () => ({
  hasUI: true,
  signal: new AbortController().signal,
  ui: { select: vi.fn(async () => 'Allow') }
})

describe('generated Pi permission extension', () => {
  it.each(['dontAsk', 'acceptEdits'] as const)(
    'keeps explicit session deny ahead of %s defaults',
    async (permissionMode) => {
      const handler = await loadToolCallHandler(buildPiPermissionExtension({
        configuredPermissions: { write: 'deny' },
        guardUnknownTools: false,
        permissionMode,
        sessionId: 'session-1'
      }))

      await expect(handler({ toolName: 'write', input: { path: 'README.md' } }, context())).resolves.toEqual({
        block: true,
        reason: 'Blocked by an explicit One Works permission.'
      })
    }
  )

  it('allows a configured serverless ask in dontAsk mode without opening permission UI', async () => {
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'ask' },
      guardUnknownTools: false,
      permissionMode: 'dontAsk',
      sessionId: 'session-serverless-dont-ask'
    }))
    const ctx = context()

    await expect(handler({ toolName: 'bash', input: { command: 'pwd' } }, ctx)).resolves.toBeUndefined()
    expect(ctx.ui.select).not.toHaveBeenCalled()
  })

  it('uses the live server decision for an explicitly enabled custom tool', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    const fetchMock = vi.fn(async (_input: unknown) => ({
      ok: true,
      json: async () => ({ result: 'deny' })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { review_changes: 'inherit' },
      guardUnknownTools: true,
      permissionMode: 'dontAsk',
      sessionId: 'session-2'
    }))

    await expect(handler({ toolName: 'review_changes', input: {} }, context())).resolves.toEqual({
      block: true,
      reason: 'Blocked by an explicit One Works permission.'
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/interact/permission-check')
  })

  it('allows a live server ask in dontAsk mode without opening permission UI', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ result: 'ask', source: 'projectAsk' })
      }))
    )
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny' },
      guardUnknownTools: false,
      permissionMode: 'dontAsk',
      sessionId: 'session-live-dont-ask'
    }))
    const ctx = context()

    await expect(handler({ toolName: 'bash', input: { command: 'pwd' } }, ctx)).resolves.toBeUndefined()
    expect(ctx.ui.select).not.toHaveBeenCalled()
  })

  it.each([
    ['0.0.0.0', 'http://127.0.0.1:8787/api/interact/permission-check'],
    ['::', 'http://[::1]:8787/api/interact/permission-check'],
    ['[::]', 'http://[::1]:8787/api/interact/permission-check'],
    ['::1', 'http://[::1]:8787/api/interact/permission-check'],
    ['[::1]', 'http://[::1]:8787/api/interact/permission-check']
  ])('normalizes server host %s to a loopback URL', async (host, expectedUrl) => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', host)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    const fetchMock = vi.fn(async (_input: string | URL | Request) => ({
      ok: true,
      json: async () => ({ success: true, data: { result: 'allow', source: 'sessionAllow' } })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny' },
      guardUnknownTools: false,
      permissionMode: 'dontAsk',
      sessionId: 'session-host-normalize'
    }))

    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toBeUndefined()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(expectedUrl)
  })

  it('never consumes a local onceAllow after a configured server fails', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'allow' },
      guardUnknownTools: false,
      oneTimePermissions: { bash: { decision: 'allow', key: 'Bash' } },
      permissionMode: 'dontAsk',
      sessionId: 'session-server-offline'
    }))

    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toEqual({
      block: true,
      reason: 'One Works permission server is unavailable.'
    })
  })

  it('clears cached one-shot state after a live response before later server failure', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'allow', source: 'onceAllow' }) })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny' },
      guardUnknownTools: false,
      oneTimePermissions: { bash: { decision: 'allow', key: 'Bash' } },
      permissionMode: 'dontAsk',
      sessionId: 'session-live-then-offline'
    }))

    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toBeUndefined()
    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toEqual({
      block: true,
      reason: 'One Works permission server is unavailable.'
    })
  })

  it('enforces an explicit deny for a normally read-only tool', async () => {
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { read: 'deny' },
      guardUnknownTools: false,
      permissionMode: 'dontAsk',
      sessionId: 'session-read-deny'
    }))

    await expect(handler({ toolName: 'read', input: { path: 'README.md' } }, context())).resolves.toEqual({
      block: true,
      reason: 'Blocked by an explicit One Works permission.'
    })
  })

  it('lets bypassPermissions override remembered denies', async () => {
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny' },
      guardUnknownTools: false,
      permissionMode: 'bypassPermissions',
      sessionId: 'session-3'
    }))

    await expect(handler({ toolName: 'bash', input: { command: 'pwd' } }, context())).resolves.toBeUndefined()
  })

  it('blocks bypassPermissions when the configured permission server is unavailable', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    const fetchMock = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchMock)
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'allow' },
      guardUnknownTools: false,
      permissionMode: 'bypassPermissions',
      sessionId: 'session-bypass-server-offline'
    }))

    await expect(handler({ toolName: 'bash', input: { command: 'pwd' } }, context())).resolves.toEqual({
      block: true,
      reason: 'One Works permission server is unavailable.'
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('probes a configured server in bypassPermissions without applying decisions or consuming cached once state', async () => {
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_HOST__', '127.0.0.1')
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_PORT__', '8787')
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      json: async () => ({ success: true, data: { result: 'deny', source: 'onceDeny' } })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const source = buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny' },
      guardUnknownTools: false,
      oneTimePermissions: { bash: { decision: 'deny', key: 'Bash' } },
      permissionMode: 'bypassPermissions',
      sessionId: 'session-bypass-server-online'
    })
    const handler = await loadToolCallHandler(source)

    await expect(handler({ toolName: 'bash', input: { command: 'pwd' } }, context())).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      adapter: 'pi',
      sessionId: 'session-bypass-server-online'
    })
    const bypassBranch = source.slice(
      source.indexOf("if (MODE === 'bypassPermissions')"),
      source.indexOf("if (MODE === 'plan'")
    )
    expect(bypassBranch).not.toContain('takeOneTime')
  })

  it.each(
    [
      ['allow', { bash: 'deny' }, undefined, { block: true, reason: 'Blocked by an explicit One Works permission.' }],
      ['deny', { bash: 'allow' }, { block: true, reason: 'Blocked by an explicit One Works permission.' }, undefined]
    ] as const
  )('consumes in-memory one-shot %s exactly once in the Pi process', async (
    decision,
    configuredPermissions,
    firstResult,
    secondResult
  ) => {
    const source = buildPiPermissionExtension({
      configuredPermissions,
      guardUnknownTools: false,
      oneTimePermissions: { bash: { decision, key: 'Bash' } },
      permissionMode: 'dontAsk',
      sessionId: 'session-one-time'
    })
    const handler = await loadToolCallHandler(source)

    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toEqual(firstResult)
    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toEqual(secondResult)
  })

  it('consumes aliases sharing a canonical one-shot key together', async () => {
    const handler = await loadToolCallHandler(buildPiPermissionExtension({
      configuredPermissions: { bash: 'deny', shell: 'deny' },
      guardUnknownTools: false,
      oneTimePermissions: {
        bash: { decision: 'allow', key: 'Bash' },
        shell: { decision: 'allow', key: 'Bash' }
      },
      permissionMode: 'dontAsk',
      sessionId: 'session-aliases'
    }))

    await expect(handler({ toolName: 'bash', input: {} }, context())).resolves.toBeUndefined()
    await expect(handler({ toolName: 'shell', input: {} }, context())).resolves.toEqual({
      block: true,
      reason: 'Blocked by an explicit One Works permission.'
    })
  })

  it('keeps a baked one-shot deny ahead of dontAsk defaults for every restarted process', async () => {
    const source = buildPiPermissionExtension({
      configuredPermissions: { bash: 'allow' },
      guardUnknownTools: false,
      oneTimePermissions: { bash: { decision: 'deny', key: 'Bash' } },
      permissionMode: 'dontAsk',
      sessionId: 'session-durable-deny'
    })
    const [first, restarted] = await Promise.all([loadToolCallHandler(source), loadToolCallHandler(source)])

    await expect(first({ toolName: 'bash', input: {} }, context())).resolves.toEqual({
      block: true,
      reason: 'Blocked by an explicit One Works permission.'
    })
    await expect(restarted({ toolName: 'bash', input: {} }, context())).resolves.toEqual({
      block: true,
      reason: 'Blocked by an explicit One Works permission.'
    })
  })

  it('does not emit filesystem mirror or lock protocol code', () => {
    const source = buildPiPermissionExtension({
      configuredPermissions: {},
      guardUnknownTools: false,
      permissionMode: 'default',
      sessionId: 'session-no-fs'
    })

    expect(source).not.toMatch(/node:fs|MIRROR_PATH|\.once\.lock|consumeOneTime/)
  })
})
