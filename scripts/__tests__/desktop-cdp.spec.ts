import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  attemptDesktopCdpWindowRaise,
  completeDesktopCdpLaunchReadiness,
  inspectDesktopExternalCdpSupport,
  inspectDesktopRecordingDemoFixtureSupport
} from '../desktop-cdp'

describe('desktop CDP launch safety', () => {
  it('treats Accessibility window raise as best effort for capture-validated launches', async () => {
    await expect(attemptDesktopCdpWindowRaise(async () => {
      throw new Error('AX index is not ready')
    })).resolves.toBe(false)
    await expect(attemptDesktopCdpWindowRaise(async () => {})).resolves.toBe(true)
  })

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

  it('requires the recording demo fixture hook independently from CDP support', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-demo-fixture-support-'))
    const appPath = path.join(root, 'One Works.app')
    const bundlePath = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
    await mkdir(path.dirname(bundlePath), { recursive: true })
    await writeFile(
      bundlePath,
      'process.env.ONEWORKS_DESKTOP_CDP_PORT; "--oneworks-cdp-port";\n',
      'utf8'
    )

    await expect(inspectDesktopRecordingDemoFixtureSupport(appPath)).resolves.toMatchObject({
      reason: 'recording-demo-fixture-hook-missing',
      supported: false
    })

    await writeFile(
      bundlePath,
      'process.env.ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE;\n',
      'utf8'
    )
    await expect(inspectDesktopRecordingDemoFixtureSupport(appPath)).resolves.toMatchObject({
      reason: 'recording-demo-fixture-hook-found',
      supported: true
    })
  })

  it('cleans up the launched process when the post-readiness window raise fails', async () => {
    const cleanup = vi.fn(async () => {})

    await expect(completeDesktopCdpLaunchReadiness({
      cleanup,
      readiness: Promise.resolve(['ready']),
      raiseAfterReady: async () => {
        throw new Error('AXRaise failed')
      }
    })).rejects.toThrow('AXRaise failed')

    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('preserves cancellation and cleans up when the best-effort raise is aborted', async () => {
    const cleanup = vi.fn(async () => {})
    const controller = new AbortController()

    await expect(completeDesktopCdpLaunchReadiness({
      cleanup,
      readiness: Promise.resolve(['ready']),
      raiseAfterReady: async () => {
        await attemptDesktopCdpWindowRaise(async () => {
          controller.abort()
          throw new Error('macOS window activation was aborted.')
        }, controller.signal)
      }
    })).rejects.toThrow('Desktop CDP launch was aborted.')

    expect(cleanup).toHaveBeenCalledOnce()
  })
})
