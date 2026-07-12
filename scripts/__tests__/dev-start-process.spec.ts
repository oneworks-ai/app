import { spawn } from 'node:child_process'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { runSync } from '../dev-start/process'
import {
  pidRunning,
  processFingerprint,
  processFingerprintMatches,
  terminateTrackedPid
} from '../dev-start/process-identity'
import { assertStateCanBeForgotten } from '../dev-start/readiness'

describe('dev-start process ownership', () => {
  it('keeps process identity across a shell-to-node exec command change', () => {
    const startedAt = 'Sat Jul 11 20:27:00 2026'
    expect(processFingerprintMatches(
      `${startedAt} node server.js`,
      `${startedAt} bash pnpm exec server`
    )).toBe(true)
    expect(processFingerprintMatches(
      'Sat Jul 11 20:27:01 2026 node server.js',
      `${startedAt} bash pnpm exec server`
    )).toBe(false)
    expect(processFingerprintMatches('old-client', 'old-client-v2')).toBe(false)
  })

  it('throws on a failed synchronous command instead of exiting the coordinator', () => {
    expect(() => runSync(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'pipe' }))
      .toThrow('exited with status 7')
  })

  it('refuses a mismatched pid identity and stops the matching process', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    const fingerprint = processFingerprint(child.pid)
    expect(fingerprint).toBeTypeOf('string')

    await expect(terminateTrackedPid({
      fingerprint: 'wrong identity',
      label: 'test child',
      pid: child.pid
    })).rejects.toThrow('process identity no longer matches')
    expect(pidRunning(child.pid)).toBe(true)

    await terminateTrackedPid({ fingerprint, label: 'test child', pid: child.pid })
    expect(pidRunning(child.pid)).toBe(false)
  })

  it('forgets only unhealthy state whose live pid identities are disproven', async () => {
    const state = {
      clientFingerprint: 'old-client',
      clientPid: 101,
      components: [{
        fingerprint: 'old-client',
        healthUrl: 'http://127.0.0.1:1/ui',
        id: 'client',
        kind: 'http' as const,
        pid: 101
      }],
      revision: 3,
      root: process.cwd(),
      schemaVersion: 2 as const,
      target: 'web' as const
    }
    const dependencies = {
      async fetchHealthy() { return false },
      fingerprint() { return 'new-unrelated-process' },
      isRunning() { return true }
    }

    await expect(assertStateCanBeForgotten('web', state, dependencies)).resolves.toBeUndefined()
    await expect(assertStateCanBeForgotten('web', state, {
      ...dependencies,
      async fetchHealthy() { return true }
    })).rejects.toThrow('health endpoint is still reachable')
    await expect(assertStateCanBeForgotten('web', state, {
      ...dependencies,
      fingerprint() { return 'old-client' }
    })).rejects.toThrow('still owned or cannot be disproven')
    await expect(assertStateCanBeForgotten('web', {
      ...state,
      components: [{
        ...state.components[0],
        fingerprint: 'different-stale-record'
      }],
      serviceFingerprint: 'new-unrelated-process',
      servicePid: 101
    }, dependencies)).rejects.toThrow('still owned or cannot be disproven')
    await expect(assertStateCanBeForgotten('web', {
      ...state,
      revision: undefined
    }, dependencies)).rejects.toThrow('concrete revision is required')
    await expect(assertStateCanBeForgotten('electron', state, dependencies))
      .rejects.toThrow('machine-scoped target')
  })
})
