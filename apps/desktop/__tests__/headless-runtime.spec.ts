import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolveDesktopHeadlessRuntime,
  resolveMacOSHelperExecutable,
  resolveMacOSHelperInfoPath
} from '../src/headless-runtime.cjs'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

const createMacOSBundleExecutables = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oneworks-headless-runtime-'))
  tempDirs.push(root)
  const mainExecutable = path.join(root, 'One Works Dev.app', 'Contents', 'MacOS', 'One Works Dev')
  const helperExecutable = resolveMacOSHelperExecutable(mainExecutable)
  await mkdir(path.dirname(mainExecutable), { recursive: true })
  await mkdir(path.dirname(helperExecutable), { recursive: true })
  await writeFile(mainExecutable, '#!/bin/sh\n', 'utf8')
  await writeFile(helperExecutable, '#!/bin/sh\n', 'utf8')
  await writeFile(
    resolveMacOSHelperInfoPath(helperExecutable),
    '<plist><dict><key>LSUIElement</key><true/></dict></plist>\n',
    'utf8'
  )
  await chmod(mainExecutable, 0o755)
  await chmod(helperExecutable, 0o755)
  return { helperExecutable, mainExecutable }
}

describe('desktop headless runtime', () => {
  it('uses the packaged macOS Helper agent and propagates it to descendants', async () => {
    const { helperExecutable, mainExecutable } = await createMacOSBundleExecutables()

    expect(resolveDesktopHeadlessRuntime({
      isPackaged: true,
      platform: 'darwin',
      processExecutable: mainExecutable
    })).toEqual({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        __ONEWORKS_PROJECT_NODE_PATH__: helperExecutable
      },
      executable: helperExecutable
    })
  })

  it('fails closed when the packaged macOS Helper runtime is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-headless-runtime-missing-'))
    tempDirs.push(root)
    const mainExecutable = path.join(root, 'One Works.app', 'Contents', 'MacOS', 'One Works')

    expect(() =>
      resolveDesktopHeadlessRuntime({
        isPackaged: true,
        platform: 'darwin',
        processExecutable: mainExecutable
      })
    ).toThrow('Packaged macOS headless runtime is missing or not executable')
  })

  it('rejects a packaged macOS Helper without background-agent identity', async () => {
    const { helperExecutable, mainExecutable } = await createMacOSBundleExecutables()
    await writeFile(
      resolveMacOSHelperInfoPath(helperExecutable),
      '<plist><dict><key>LSUIElement</key><false/></dict></plist>\n',
      'utf8'
    )

    expect(() =>
      resolveDesktopHeadlessRuntime({
        isPackaged: true,
        platform: 'darwin',
        processExecutable: mainExecutable
      })
    ).toThrow('Packaged macOS headless runtime must use an LSUIElement helper')
  })

  it('rejects a packaged macOS override that points back to the foreground app', async () => {
    const { mainExecutable } = await createMacOSBundleExecutables()

    expect(() =>
      resolveDesktopHeadlessRuntime({
        isPackaged: true,
        overrideExecutable: mainExecutable,
        platform: 'darwin',
        processExecutable: mainExecutable
      })
    ).toThrow('Packaged macOS background work cannot override the bundled Helper runtime')
  })

  it('still fails closed for a missing packaged macOS Helper when an override is present', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-headless-runtime-override-missing-'))
    tempDirs.push(root)
    const mainExecutable = path.join(root, 'One Works.app', 'Contents', 'MacOS', 'One Works')

    expect(() =>
      resolveDesktopHeadlessRuntime({
        isPackaged: true,
        overrideExecutable: '/usr/local/bin/node',
        platform: 'darwin',
        processExecutable: mainExecutable
      })
    ).toThrow('Packaged macOS headless runtime is missing or not executable')
  })

  it.each(['linux', 'win32'])('preserves packaged %s Electron-as-Node behavior', platform => {
    const mainExecutable = platform === 'win32' ? 'C:\\One Works\\One Works.exe' : '/opt/oneworks/oneworks'

    expect(resolveDesktopHeadlessRuntime({
      isPackaged: true,
      platform,
      processExecutable: mainExecutable
    })).toEqual({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        __ONEWORKS_PROJECT_NODE_PATH__: mainExecutable
      },
      executable: mainExecutable
    })
  })

  it('preserves the development server runtime fallback', () => {
    expect(resolveDesktopHeadlessRuntime({
      fallbackExecutable: 'node',
      isPackaged: false,
      platform: 'darwin',
      processExecutable: '/fixture/Electron'
    })).toEqual({ env: {}, executable: 'node' })
  })

  it('routes every Desktop background spawn through the shared runtime contract', async () => {
    const sourceFiles = [
      'manager-service-manager.ts',
      'workspace-runtime-cache-refresh.ts',
      'workspace-service-manager.ts',
      'updates.ts'
    ]

    for (const fileName of sourceFiles) {
      const source = await readFile(path.join(__dirname, '..', 'src', 'main', fileName), 'utf8')
      expect(source, fileName).toMatch(/resolve(?:DesktopBackground|Server)Runtime/u)
      expect(source, fileName).not.toMatch(/(?:spawn|execFileAsync)\(\s*process\.execPath/u)
    }
  })
})
