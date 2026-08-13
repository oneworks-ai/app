import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { notify, notifyOptionsSchema, resolveDefaultNotificationAssetPaths } from '#~/system.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const notifierNotify = vi.hoisted(() => vi.fn())

vi.mock('node-notifier', () => ({
  default: {
    notify: notifierNotify
  }
}))

describe('system helpers', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    notifierNotify.mockReset()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
  })

  it('exposes the notification schema', () => {
    expect(notifyOptionsSchema.parse({
      description: 'task completed'
    })).toEqual({
      description: 'task completed'
    })
  })

  it('calls node-notifier and resolves without confirmation by default', async () => {
    notifierNotify.mockImplementation((_options, callback) => {
      callback?.(null, 'unused', undefined)
    })

    const result = await notify({
      description: 'task completed',
      sound: false
    })

    expect(notifierNotify).toHaveBeenCalledOnce()
    expect(result.response).toBe('default')
    expect(result.metadata?.activationType).toBe('default')
  })

  it('resolves notification assets from the installed package instead of a relocated bundle chunk', async () => {
    const appDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-notification-assets-'))
    tempDirs.push(appDir)
    const assetDir = path.join(appDir, 'node_modules', '@oneworks', 'utils', 'src', 'assets')
    await mkdir(assetDir, { recursive: true })
    await Promise.all([
      writeFile(path.join(assetDir, 'mcp.png'), 'icon fixture'),
      writeFile(path.join(assetDir, 'completed.mp3'), 'sound fixture')
    ])

    expect(resolveDefaultNotificationAssetPaths(
      { __ONEWORKS_DESKTOP_APP_DIR__: appDir },
      path.join(appDir, 'node_modules/@oneworks/server/dist/__INTERNAL__home/chunks')
    )).toEqual({
      icon: path.join(assetDir, 'mcp.png'),
      sound: path.join(assetDir, 'completed.mp3')
    })
  })
})
