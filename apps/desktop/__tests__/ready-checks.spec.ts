import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { waitForServerReadyEvent } from '../src/main/ready-checks'

const createChildWithStdout = () => {
  const stdout = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout }) as unknown as ChildProcess
  return { child, stdout }
}

describe('desktop ready checks', () => {
  it('accepts a caller-specific server startup timeout', async () => {
    const { child } = createChildWithStdout()

    await expect(waitForServerReadyEvent(child, Date.now(), 10))
      .rejects.toThrow('Timed out while waiting for the One Works server ready event.')
  })

  it('still resolves when the server publishes its ready event', async () => {
    const { child, stdout } = createChildWithStdout()
    const ready = waitForServerReadyEvent(child, Date.now(), 100)

    stdout.write('[oneworks-desktop-server-ready] http://127.0.0.1:54321\n')

    await expect(ready).resolves.toBeUndefined()
  })
})
