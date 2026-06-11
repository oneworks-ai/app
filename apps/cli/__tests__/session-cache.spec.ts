import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerListCommand } from '#~/commands/list.js'
import {
  formatResumeCommand,
  listCliSessions,
  resolveCliSession,
  resolveCliSessionAdapter,
  writeCliSessionRecord
} from '#~/session-cache.js'

const tempDirs: string[] = []
const originalCwd = process.cwd()
const originalResumeCommandPrefix = process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-session-cache-'))
  tempDirs.push(cwd)
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  return cwd
}

afterEach(async () => {
  vi.restoreAllMocks()
  process.chdir(originalCwd)
  delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  if (originalResumeCommandPrefix == null) {
    delete process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__
  } else {
    process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__ = originalResumeCommandPrefix
  }
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { force: true, recursive: true })))
})

describe('session cache utilities', () => {
  it('lists cached sessions and resolves them by session id prefix', async () => {
    const cwd = await createTempDir()

    await writeCliSessionRecord(cwd, 'ctx-alpha', 'session-alpha', {
      resume: {
        version: 1,
        ctxId: 'ctx-alpha',
        sessionId: 'session-alpha',
        cwd,
        description: 'Inspect README',
        createdAt: 1,
        updatedAt: 2,
        resolvedAdapter: 'codex',
        taskOptions: {
          adapter: 'claude-code',
          cwd,
          ctxId: 'ctx-alpha'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-alpha',
          mode: 'direct',
          model: 'gpt-5.4'
        },
        outputFormat: 'text'
      },
      detail: {
        ctxId: 'ctx-alpha',
        sessionId: 'session-alpha',
        status: 'completed',
        startTime: 1,
        endTime: 2,
        description: 'Inspect README',
        adapter: 'codex',
        model: 'gpt-5.4'
      }
    })

    const records = await listCliSessions(cwd)
    expect(records).toHaveLength(1)
    expect(records[0]?.resume?.sessionId).toBe('session-alpha')

    const resolved = await resolveCliSession(cwd, 'session-a')
    expect(resolved.resume?.ctxId).toBe('ctx-alpha')
    expect(resolveCliSessionAdapter(resolved)).toBe('codex')
    expect(formatResumeCommand('session-alpha')).toBe('oneworks --resume session-alpha')
  })

  it('does not list legacy sessions from workspace .oo caches', async () => {
    const cwd = await createTempDir()
    const legacySessionDir = path.join(cwd, '.oo/caches/ctx-legacy/session-legacy')
    await fs.mkdir(legacySessionDir, { recursive: true })
    await fs.writeFile(
      path.join(legacySessionDir, 'cli-session.json'),
      JSON.stringify({
        version: 1,
        ctxId: 'ctx-legacy',
        sessionId: 'session-legacy',
        cwd,
        description: 'Legacy cache',
        createdAt: 1,
        updatedAt: 2,
        taskOptions: {
          cwd,
          ctxId: 'ctx-legacy'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-legacy',
          mode: 'direct'
        },
        outputFormat: 'text'
      })
    )

    await expect(resolveCliSession(cwd, 'session-legacy')).rejects.toThrow('not found')
  })

  it('uses the forwarded cli resume command prefix when present', () => {
    process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__ = 'npx ai run'

    expect(formatResumeCommand('session-alpha')).toBe('npx ai run --resume session-alpha')
    expect(formatResumeCommand('session-alpha', 'dyai')).toBe('dyai --resume session-alpha')
  })

  it('reports ambiguous prefix matches clearly', async () => {
    const cwd = await createTempDir()

    for (const suffix of ['one', 'two']) {
      await writeCliSessionRecord(cwd, `ctx-${suffix}`, `session-${suffix}`, {
        resume: {
          version: 1,
          ctxId: `ctx-${suffix}`,
          sessionId: `session-${suffix}`,
          cwd,
          createdAt: 1,
          updatedAt: 1,
          taskOptions: {
            cwd,
            ctxId: `ctx-${suffix}`
          },
          adapterOptions: {
            runtime: 'cli',
            sessionId: `session-${suffix}`,
            mode: 'direct'
          },
          outputFormat: 'text'
        }
      })
    }

    await expect(resolveCliSession(cwd, 'session-')).rejects.toThrow('ambiguous')
  })

  it('resolves the latest created session when no resume id is provided', async () => {
    const cwd = await createTempDir()

    await writeCliSessionRecord(cwd, 'ctx-older', 'session-older', {
      resume: {
        version: 1,
        ctxId: 'ctx-older',
        sessionId: 'session-older',
        cwd,
        createdAt: 10,
        updatedAt: 200,
        taskOptions: {
          cwd,
          ctxId: 'ctx-older'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-older',
          mode: 'direct'
        },
        outputFormat: 'text'
      }
    })

    await writeCliSessionRecord(cwd, 'ctx-newer', 'session-newer', {
      resume: {
        version: 1,
        ctxId: 'ctx-newer',
        sessionId: 'session-newer',
        cwd,
        createdAt: 20,
        updatedAt: 100,
        taskOptions: {
          cwd,
          ctxId: 'ctx-newer'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-newer',
          mode: 'direct'
        },
        outputFormat: 'text'
      }
    })

    await expect(resolveCliSession(cwd, undefined)).resolves.toEqual(
      expect.objectContaining({
        resume: expect.objectContaining({
          sessionId: 'session-newer'
        })
      })
    )
  })

  it('reports missing sessions clearly when resolving latest without an id', async () => {
    const cwd = await createTempDir()

    await expect(resolveCliSession(cwd, undefined)).rejects.toThrow('No sessions found')
  })
})

describe('list command', () => {
  it('prints a compact table by default and shows next-step hints', async () => {
    const cwd = await createTempDir()
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await writeCliSessionRecord(cwd, 'ctx-demo', 'session-demo', {
      resume: {
        version: 1,
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        cwd,
        description: 'Review CLI resume flow',
        createdAt: 10,
        updatedAt: 20,
        resolvedAdapter: 'codex',
        taskOptions: {
          adapter: 'codex',
          cwd,
          ctxId: 'ctx-demo'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-demo',
          mode: 'direct',
          model: 'gpt-5.4'
        },
        outputFormat: 'text'
      },
      detail: {
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        status: 'running',
        pid: 123,
        startTime: 10,
        description: 'Review CLI resume flow',
        adapter: 'codex',
        model: 'gpt-5.4'
      }
    })

    process.chdir(cwd)
    const program = new Command()
    registerListCommand(program)
    await program.parseAsync(['list'], { from: 'user' })

    expect(tableSpy).toHaveBeenCalledTimes(1)
    expect(tableSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        Session: 'session-demo',
        Status: 'running',
        Description: 'Review CLI resume flow'
      })
    ])
    expect(Object.keys(tableSpy.mock.calls[0]?.[0]?.[0] ?? {})).toEqual([
      'Session',
      'Status',
      'Updated',
      'Description'
    ])
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Resume latest: oneworks --resume session-demo')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Stop a running session: oneworks stop session-demo')
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('More columns: oneworks list --view default')
    )
  })

  it('prints full view rows with helper commands', async () => {
    const cwd = await createTempDir()
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await writeCliSessionRecord(cwd, 'ctx-demo', 'session-demo', {
      resume: {
        version: 1,
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        cwd,
        description: 'Review CLI resume flow',
        createdAt: 10,
        updatedAt: 20,
        resolvedAdapter: 'codex',
        taskOptions: {
          adapter: 'codex',
          cwd,
          ctxId: 'ctx-demo'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-demo',
          mode: 'direct',
          model: 'gpt-5.4'
        },
        outputFormat: 'text'
      },
      detail: {
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        status: 'running',
        pid: 123,
        startTime: 10,
        description: 'Review CLI resume flow',
        adapter: 'codex',
        model: 'gpt-5.4'
      }
    })

    process.chdir(cwd)
    const program = new Command()
    registerListCommand(program)
    await program.parseAsync(['list', '--view', 'full'], { from: 'user' })

    expect(tableSpy).toHaveBeenCalledTimes(1)
    expect(tableSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        Session: 'session-demo',
        Context: 'ctx-demo',
        Resume: 'oneworks --resume session-demo',
        Stop: 'oneworks stop session-demo',
        Kill: 'oneworks kill session-demo'
      })
    ])
  })

  it('prints forwarded resume commands in list rows and hints', async () => {
    const cwd = await createTempDir()
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__ = 'ai'

    await writeCliSessionRecord(cwd, 'ctx-demo', 'session-demo', {
      resume: {
        version: 1,
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        cwd,
        description: 'Review CLI resume flow',
        createdAt: 10,
        updatedAt: 20,
        resolvedAdapter: 'codex',
        taskOptions: {
          adapter: 'codex',
          cwd,
          ctxId: 'ctx-demo'
        },
        adapterOptions: {
          runtime: 'cli',
          sessionId: 'session-demo',
          mode: 'direct',
          model: 'gpt-5.4'
        },
        outputFormat: 'text'
      },
      detail: {
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        status: 'completed',
        startTime: 10,
        endTime: 20,
        description: 'Review CLI resume flow',
        adapter: 'codex',
        model: 'gpt-5.4'
      }
    })

    process.chdir(cwd)
    const program = new Command()
    registerListCommand(program)
    await program.parseAsync(['list', '--view', 'full'], { from: 'user' })

    expect(tableSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        Resume: 'ai --resume session-demo'
      })
    ])
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Resume latest: ai --resume session-demo')
    )
  })

  it('supports filtering to running sessions only', async () => {
    const cwd = await createTempDir()
    const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await writeCliSessionRecord(cwd, 'ctx-running', 'session-running', {
      resume: {
        version: 1,
        ctxId: 'ctx-running',
        sessionId: 'session-running',
        cwd,
        createdAt: 10,
        updatedAt: 20,
        resolvedAdapter: 'codex',
        taskOptions: { cwd, ctxId: 'ctx-running' },
        adapterOptions: { runtime: 'cli', sessionId: 'session-running', mode: 'direct' },
        outputFormat: 'text'
      },
      detail: {
        ctxId: 'ctx-running',
        sessionId: 'session-running',
        status: 'running',
        startTime: 10
      }
    })

    await writeCliSessionRecord(cwd, 'ctx-done', 'session-done', {
      resume: {
        version: 1,
        ctxId: 'ctx-done',
        sessionId: 'session-done',
        cwd,
        createdAt: 11,
        updatedAt: 21,
        resolvedAdapter: 'claude-code',
        taskOptions: { cwd, ctxId: 'ctx-done' },
        adapterOptions: { runtime: 'cli', sessionId: 'session-done', mode: 'direct' },
        outputFormat: 'text'
      },
      detail: {
        ctxId: 'ctx-done',
        sessionId: 'session-done',
        status: 'completed',
        startTime: 11
      }
    })

    process.chdir(cwd)
    const program = new Command()
    registerListCommand(program)
    await program.parseAsync(['list', '--running'], { from: 'user' })

    expect(tableSpy).toHaveBeenCalledTimes(1)
    expect(tableSpy.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        Session: 'session-running',
        Status: 'running'
      })
    ])
  })

  it('rejects unsupported list status filters', async () => {
    const cwd = await createTempDir()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await writeCliSessionRecord(cwd, 'ctx-demo', 'session-demo', {
      resume: {
        version: 1,
        ctxId: 'ctx-demo',
        sessionId: 'session-demo',
        cwd,
        createdAt: 1,
        updatedAt: 1,
        taskOptions: { cwd, ctxId: 'ctx-demo' },
        adapterOptions: { runtime: 'cli', sessionId: 'session-demo', mode: 'direct' },
        outputFormat: 'text'
      }
    })

    process.chdir(cwd)
    const program = new Command()
    registerListCommand(program)

    await expect(program.parseAsync(['list', '--status', 'weird'], { from: 'user' })).rejects.toThrow(
      'process.exit'
    )
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unsupported status "weird"'))
  })
})
