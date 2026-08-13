import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SCRCPY_SERVER_VERSION, resolveScrcpyServerPath } from '#~/services/mobile-debug/runtime-assets.js'

describe('mobile debug runtime assets', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
  })

  it('resolves scrcpy from the stable desktop app root after server modules are bundled into chunks', async () => {
    const appDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-app-'))
    tempDirs.push(appDir)
    const serverPath = path.join(
      appDir,
      'resources',
      'scrcpy',
      `scrcpy-server-v${SCRCPY_SERVER_VERSION}`
    )
    await mkdir(path.dirname(serverPath), { recursive: true })
    await writeFile(serverPath, 'scrcpy fixture')

    expect(resolveScrcpyServerPath({
      cwd: path.join(appDir, 'workspace'),
      env: { __ONEWORKS_DESKTOP_APP_DIR__: appDir },
      moduleDir: path.join(appDir, 'node_modules/@oneworks/server/dist/__INTERNAL__home/chunks')
    })).toBe(serverPath)
  })
})
