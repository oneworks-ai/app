import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { inspectDesktopExternalCdpSupport } from '../desktop-cdp'

describe('desktop CDP launch safety', () => {
  it('detects packaged apps that include the opt-in external CDP hook', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-cdp-supported-'))
    const appPath = path.join(root, 'One Works.app')
    const bundlePath = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
    await mkdir(path.dirname(bundlePath), { recursive: true })
    await writeFile(
      bundlePath,
      'process.env.ONEWORKS_DESKTOP_CDP_PORT; "--oneworks-cdp-port";\n',
      'utf8'
    )

    await expect(inspectDesktopExternalCdpSupport(appPath)).resolves.toMatchObject({
      reason: 'external-cdp-hook-found',
      supported: true
    })
  })

  it('rejects macOS app bundles that do not include the external CDP hook', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-cdp-unsupported-'))
    const appPath = path.join(root, 'One Works.app')
    const bundlePath = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
    await mkdir(path.dirname(bundlePath), { recursive: true })
    await writeFile(bundlePath, 'console.log("legacy app")\n', 'utf8')

    await expect(inspectDesktopExternalCdpSupport(appPath)).resolves.toMatchObject({
      reason: 'external-cdp-hook-missing',
      supported: false
    })
  })
})
