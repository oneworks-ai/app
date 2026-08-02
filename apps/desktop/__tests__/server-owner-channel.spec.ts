import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const ownerChannelPath = resolve(process.cwd(), 'apps/desktop/src/server-owner-channel.cjs')

describe('desktop server owner channel', () => {
  it('terminates the server bootstrap when its Electron IPC owner disconnects', async () => {
    const script = `
      const { installDesktopServerOwnerChannel } = require(${JSON.stringify(ownerChannelPath)})
      installDesktopServerOwnerChannel()
      if (typeof process.send === 'function') process.send('ready')
      setInterval(() => {}, 1000)
    `
    const child = spawn(process.execPath, ['-e', script], {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        __ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__: 'ipc-v1'
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })

    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject)
      child.once('message', () => resolveReady())
    })
    child.disconnect()

    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    })
    expect(result).toEqual({ code: null, signal: 'SIGTERM' })
  })

  it.skipIf(process.platform === 'win32')(
    'terminates the server bootstrap process group when its owner disconnects',
    async () => {
      const script = `
        const { spawn } = require('node:child_process')
        const { installDesktopServerOwnerChannel } = require(${JSON.stringify(ownerChannelPath)})
        installDesktopServerOwnerChannel()
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore'
        })
        descendant.once('spawn', () => process.send?.({ descendantPid: descendant.pid }))
        setInterval(() => {}, 1000)
      `
      const child = spawn(process.execPath, ['-e', script], {
        detached: true,
        env: {
          ...process.env,
          __ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__: 'ipc-v1'
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      })
      let descendantPid: number | undefined
      try {
        descendantPid = await new Promise<number>((resolveReady, reject) => {
          child.once('error', reject)
          child.once('message', (message: { descendantPid?: number }) => {
            if (message.descendantPid == null) reject(new Error('Descendant pid was not reported.'))
            else resolveReady(message.descendantPid)
          })
        })
        child.disconnect()
        await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
        await vi.waitFor(() => {
          expect(() => process.kill(descendantPid as number, 0)).toThrow()
        })
      } finally {
        if (child.exitCode == null && child.signalCode == null) process.kill(-child.pid!, 'SIGKILL')
        if (descendantPid != null) {
          try {
            process.kill(descendantPid, 'SIGKILL')
          } catch {}
        }
      }
    }
  )
})
