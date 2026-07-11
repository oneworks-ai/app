import { spawn } from 'node:child_process'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { runSync } from '../dev-start/process'
import { pidRunning, processFingerprint, terminateTrackedPid } from '../dev-start/process-identity'

describe('dev-start process ownership', () => {
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
})
