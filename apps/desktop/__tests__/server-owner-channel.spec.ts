import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const ownerChannelPath = resolve(process.cwd(), 'apps/desktop/src/server-owner-channel.cjs')
const nodeRequire = createRequire(import.meta.url)
const {
  installDesktopServerOwnerChannel,
  terminateDesktopServerProcessTree
} = nodeRequire(ownerChannelPath) as {
  installDesktopServerOwnerChannel: (options?: Record<string, unknown>) => boolean
  terminateDesktopServerProcessTree: (options?: Record<string, unknown>) => void
}

describe('desktop server owner channel', () => {
  it('fails closed when desktop ownership is required without a real IPC channel', () => {
    expect(() =>
      installDesktopServerOwnerChannel({
        env: { __ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__: 'ipc-v1' },
        processRef: { connected: false, once: vi.fn() }
      })
    ).toThrow('Desktop server owner IPC channel is required but unavailable.')
  })

  it('terminates the complete Windows process tree with taskkill', () => {
    const processRef = {
      kill: vi.fn(),
      pid: 4321,
      platform: 'win32'
    }
    const taskkill = {
      once: vi.fn(),
      unref: vi.fn()
    }
    const spawnProcess = vi.fn(() => taskkill)

    terminateDesktopServerProcessTree({ processRef, spawnProcess })

    expect(spawnProcess).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/pid', '4321', '/t', '/f'],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }
    )
    expect(taskkill.once).toHaveBeenCalledWith('error', expect.any(Function))
    expect(taskkill.unref).toHaveBeenCalledOnce()
    expect(processRef.kill).not.toHaveBeenCalled()
  })

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
    'terminates the descendant process group when its owner disconnects',
    async () => {
      const descendantScript = `
        process.stdout.write('ready')
        setInterval(() => {}, 1000)
      `
      const script = `
        const { spawn } = require('node:child_process')
        const { installDesktopServerOwnerChannel } = require(${JSON.stringify(ownerChannelPath)})
        installDesktopServerOwnerChannel()
        const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], {
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe']
        })
        descendant.stdout.once('data', () => process.send?.({ descendantPid: descendant.pid }))
        descendant.once('error', error => process.send?.({ descendantError: error.message }))
        descendant.once('exit', (code, signal) => {
          process.send?.({ descendantError: 'exited code=' + code + ' signal=' + signal })
        })
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
          child.on('message', (message: { descendantError?: string; descendantPid?: number }) => {
            if (message.descendantError != null) {
              reject(new Error(message.descendantError))
              return
            }
            if (message.descendantPid != null) resolveReady(message.descendantPid)
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
