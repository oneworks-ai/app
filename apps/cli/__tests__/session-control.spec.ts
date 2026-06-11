import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { signalCliSession } from '#~/commands/session-control.js'
import { readCliSessionControl, resolveCliSession, writeCliSessionRecord } from '#~/session-cache.js'

const tempDirs: string[] = []
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

const createTempDir = async () => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-session-control-'))
  tempDirs.push(cwd)
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  return cwd
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('signalCliSession', () => {
  it('keeps the session running until exit is observed', async () => {
    const cwd = await createTempDir()
    const sendSignal = vi.fn()
    const waitForExit = vi.fn().mockResolvedValue(false)
    const now = vi.fn(() => 100)

    await writeCliSessionRecord(cwd, 'ctx-running', 'session-running', {
      detail: {
        ctxId: 'ctx-running',
        sessionId: 'session-running',
        status: 'running',
        pid: 123,
        startTime: 1
      }
    })

    const result = await signalCliSession({
      cwd,
      sessionId: 'session-running',
      signal: 'SIGTERM',
      sendSignal,
      waitForExit,
      now
    })

    expect(result.message).toContain('Waiting for the session to exit')
    expect(sendSignal).toHaveBeenCalledWith(123, 'SIGTERM')
    expect(waitForExit).toHaveBeenCalledWith({
      pid: 123,
      timeoutMs: 10_000,
      sendSignal
    })
    expect((await resolveCliSession(cwd, 'session-running')).detail?.status).toBe('running')
    expect(await readCliSessionControl(cwd, 'ctx-running', 'session-running')).toEqual({
      signal: 'SIGTERM',
      requestedAt: 100,
      expiresAt: 10_100
    })
  })

  it('marks the session stopped once exit is observed', async () => {
    const cwd = await createTempDir()
    const sendSignal = vi.fn()
    const waitForExit = vi.fn().mockResolvedValue(true)
    const now = vi.fn()
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(250)

    await writeCliSessionRecord(cwd, 'ctx-running', 'session-running', {
      detail: {
        ctxId: 'ctx-running',
        sessionId: 'session-running',
        status: 'running',
        pid: 456,
        startTime: 1
      }
    })

    const result = await signalCliSession({
      cwd,
      sessionId: 'session-running',
      signal: 'SIGKILL',
      sendSignal,
      waitForExit,
      now
    })

    expect(result.message).toContain('Sent SIGKILL to process 456')
    expect((await resolveCliSession(cwd, 'session-running')).detail).toEqual(expect.objectContaining({
      status: 'stopped',
      endTime: 250
    }))
    expect(await readCliSessionControl(cwd, 'ctx-running', 'session-running')).toEqual({
      signal: 'SIGKILL',
      requestedAt: 200,
      expiresAt: 2_200
    })
  })

  it('marks a stale running session stopped when its process is missing', async () => {
    const cwd = await createTempDir()
    const missingProcessError = Object.assign(new Error('missing'), { code: 'ESRCH' })
    const sendSignal = vi.fn(() => {
      throw missingProcessError
    })
    const waitForExit = vi.fn()
    const now = vi.fn(() => 300)

    await writeCliSessionRecord(cwd, 'ctx-stale', 'session-stale', {
      detail: {
        ctxId: 'ctx-stale',
        sessionId: 'session-stale',
        status: 'running',
        pid: 789,
        startTime: 1
      }
    })

    const result = await signalCliSession({
      cwd,
      sessionId: 'session-stale',
      signal: 'SIGTERM',
      sendSignal,
      waitForExit,
      now
    })

    expect(result.message).toBe('Process 789 not found. Marked session session-stale as stopped.')
    expect(sendSignal).toHaveBeenCalledWith(789, 'SIGTERM')
    expect(waitForExit).not.toHaveBeenCalled()
    expect((await resolveCliSession(cwd, 'session-stale')).detail).toEqual(expect.objectContaining({
      status: 'stopped',
      endTime: 300
    }))
    expect(await readCliSessionControl(cwd, 'ctx-stale', 'session-stale')).toBeUndefined()
  })
})
