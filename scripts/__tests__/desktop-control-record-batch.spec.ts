import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  isMacosWindowVisibilityMetricAcceptable,
  resolveDesktopRecordingVideoBackgroundImage,
  resolveRecordingWindowBounds,
  runDesktopControlRecordBatch,
  selectMacosWindowOnRecordingDisplay
} from '../desktop-control-record-batch'

describe('desktop control recording display layout', () => {
  it('centers launcher and workspace windows inside the DeskPad display', () => {
    const bounds = resolveRecordingWindowBounds({
      frame: {
        height: 2100,
        width: 3360,
        x: -3360,
        y: -983
      },
      id: 10,
      localizedName: 'DeskPad Display',
      screencaptureDisplayId: 2,
      visibleFrame: {
        height: 2100,
        width: 3360,
        x: -3360,
        y: -983
      }
    })

    expect(bounds).toEqual({
      launcher: {
        height: 560,
        width: 760,
        x: -2060,
        y: -213
      },
      outputCrop: {
        height: 1290,
        width: 1920,
        x: 720,
        y: 405
      },
      workspace: {
        height: 1050,
        width: 1680,
        x: -2520,
        y: -458
      }
    })
  })

  it('selects the app window on the recording display instead of a larger window elsewhere', () => {
    const selected = selectMacosWindowOnRecordingDisplay([
      {
        height: 900,
        id: 1,
        ownerName: 'One Works',
        ownerPid: 42,
        title: 'Wrong display',
        width: 1280,
        x: 120,
        y: 80
      },
      {
        height: 560,
        id: 2,
        ownerName: 'One Works',
        ownerPid: 42,
        title: 'Launcher',
        width: 760,
        x: -2_060,
        y: 228
      }
    ], {
      frame: {
        height: 2_100,
        width: 3_360,
        x: -3_360,
        y: -983
      }
    })

    expect(selected?.id).toBe(2)
  })

  it('uses the approved Ventura background by default for DeskPad recordings', async () => {
    const originalCwd = process.cwd()
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-bg-'))
    try {
      process.chdir(tempDir)
      expect(resolveDesktopRecordingVideoBackgroundImage({
        useDeskpadDisplay: true
      })).toBe('/System/Library/Desktop Pictures/.thumbnails/Ventura Graphic Light.heic')
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('prefers an explicit video background over the DeskPad default', () => {
    expect(resolveDesktopRecordingVideoBackgroundImage({
      useDeskpadDisplay: true,
      videoBackgroundImage: '/tmp/custom-background.png'
    })).toBe('/tmp/custom-background.png')
  })

  it('accepts visually similar display crops without requiring byte-identical PNG files', () => {
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.02,
      edgeMeanDiff: 8,
      edgeOverlapRatio: 0.7,
      meanRgbDiff: 8.5,
      similarPixelRatio: 0.62
    })).toBe(true)
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.02,
      edgeMeanDiff: 8,
      edgeOverlapRatio: 0.7,
      meanRgbDiff: 22,
      similarPixelRatio: 0.2
    })).toBe(true)
  })

  it('accepts transparent glass windows by structural edge overlap', () => {
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.03,
      edgeMeanDiff: 0.5,
      edgeOverlapRatio: 0.9,
      meanRgbDiff: 34,
      similarPixelRatio: 0.02
    })).toBe(true)
  })

  it('accepts sparse glass-window edges only when their structure is nearly identical', () => {
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.006,
      edgeMeanDiff: 0.3,
      edgeOverlapRatio: 1,
      meanRgbDiff: 32.6,
      similarPixelRatio: 0.003
    })).toBe(true)
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.006,
      edgeMeanDiff: 8,
      edgeOverlapRatio: 0.7,
      meanRgbDiff: 32.6,
      similarPixelRatio: 0.003
    })).toBe(false)
  })

  it('rejects display crops that do not visually match the target window', () => {
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.002,
      edgeMeanDiff: 42,
      edgeOverlapRatio: 0.05,
      meanRgbDiff: 74,
      similarPixelRatio: 0.08
    })).toBe(false)
  })

  it('passes isolated fixture data to Electron while the scenario sees only the virtual workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-fixture-app-'))
    const appPath = path.join(root, 'One Works Dev.app')
    const bundlePath = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
    await mkdir(path.dirname(bundlePath), { recursive: true })
    await writeFile(bundlePath, 'process.env.ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE;\n', 'utf8')
    const workspace = path.join(root, 'real-workspace')
    const launchInputs: unknown[] = []
    const scenarioOptions: unknown[] = []

    const result = await runDesktopControlRecordBatch({
      appPath,
      colorSchemes: ['light'],
      demoFixture: 'adapter-promo',
      json: true,
      languages: ['en'],
      scenarioId: 'launcher-open-workspace-adapter-tour',
      stdout: { write: () => true },
      useDeskpadDisplay: true,
      workspace
    }, {
      assertDisplayCaptureContainsAppWindow: vi.fn(async () => {}),
      ensureDisplayCaptureAvailable: vi.fn(async () => {}),
      killProcess: vi.fn(async () => {}),
      launchDesktop: vi.fn(async input => {
        launchInputs.push(input)
        return {
          appPath,
          endpoint: 'http://127.0.0.1:1234',
          pid: 42,
          port: 1234,
          processFingerprint: 'fixture-process',
          targets: [{
            type: 'page',
            url: 'http://127.0.0.1:1234/ui/launcher',
            webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/fixture'
          }],
          userDataDir: path.join(root, 'user-data')
        } as never
      }),
      recordScenario: vi.fn(async (_scenario, options) => {
        scenarioOptions.push(options)
        return {
          colorScheme: 'light' as const,
          durationMs: 1_000,
          fps: 30,
          frameCount: 30,
          framesDir: '/tmp/frames',
          height: 1_290,
          keptFrames: false,
          language: 'en',
          posterPath: '/tmp/poster.png',
          scenarioId: 'launcher-open-workspace-adapter-tour',
          scenarioTitle: 'Adapter tour',
          stillFramePaths: [],
          stills: [],
          stillsDir: '/tmp/stills',
          stillsManifestPath: '/tmp/stills.json',
          videoPath: '/tmp/video.mp4',
          width: 1_920
        }
      }),
      resolveRecordingDisplay: vi.fn(async () => ({
        frame: { height: 2_100, width: 3_360, x: -3_360, y: -983 },
        id: 7,
        localizedName: 'DeskPad Display',
        screencaptureDisplayId: 2,
        visibleFrame: { height: 2_100, width: 3_360, x: -3_360, y: -983 }
      })),
      startDisplayBackground: vi.fn(async input => ({
        imagePath: input.imagePath,
        stop: async () => {}
      })),
      startDisplayKeepAwake: vi.fn(async () => ({ stop: async () => {} }))
    })

    expect(result.variants).toHaveLength(1)
    expect(launchInputs).toHaveLength(1)
    const launchInput = launchInputs[0] as {
      env?: Record<string, string>
      workspace?: string
    }
    expect(launchInput.workspace).toBeUndefined()
    expect(launchInput.env).toMatchObject({
      __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
      __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
      ONEWORKS_DESKTOP_RECORDING_LANGUAGE: 'en'
    })
    expect(JSON.parse(launchInput.env?.ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE ?? '{}'))
      .toMatchObject({
        home: '/Users/oneworks',
        workspaces: [{
          actualPath: path.resolve(workspace),
          displayPath: '/Users/oneworks/Projects/oneworks-demo'
        }]
      })
    expect(scenarioOptions).toHaveLength(1)
    expect(scenarioOptions[0]).toMatchObject({
      workspace: '/Users/oneworks/Projects/oneworks-demo'
    })
    expect((scenarioOptions[0] as { pageSetupExpression?: string }).pageSetupExpression)
      .toContain('demo@oneworks.ai')
  })

  it('rejects a legacy CDP-capable app before recording when demo fixture support is absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-legacy-app-'))
    const appPath = path.join(root, 'One Works.app')
    const bundlePath = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
    await mkdir(path.dirname(bundlePath), { recursive: true })
    await writeFile(
      bundlePath,
      'process.env.ONEWORKS_DESKTOP_CDP_PORT; "--oneworks-cdp-port";\n',
      'utf8'
    )

    await expect(runDesktopControlRecordBatch({
      allowUnsupportedApp: true,
      appPath,
      demoFixture: 'adapter-promo',
      scenarioId: 'launcher-open-workspace-adapter-tour',
      useDeskpadDisplay: true,
      workspace: '/tmp/real-workspace'
    })).rejects.toThrow('does not include the recording demo fixture hook')
  })

  it('rejects an executable override outside the verified fixture-capable app bundle', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-fixture-executable-'))
    const appPath = path.join(root, 'One Works Dev.app')
    const bundlePath = path.join(appPath, 'Contents', 'Resources', 'app', 'dist', 'main', 'index.js')
    await mkdir(path.dirname(bundlePath), { recursive: true })
    await writeFile(bundlePath, 'process.env.ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE;\n', 'utf8')
    const ensureDisplayCaptureAvailable = vi.fn(async () => {})
    const launchDesktop = vi.fn(async () => ({} as never))

    await expect(runDesktopControlRecordBatch({
      allowUnsupportedApp: true,
      appPath,
      demoFixture: 'adapter-promo',
      executable: path.join(root, 'legacy-electron'),
      scenarioId: 'launcher-open-workspace-adapter-tour',
      useDeskpadDisplay: true,
      workspace: path.join(root, 'real-workspace')
    }, {
      ensureDisplayCaptureAvailable,
      launchDesktop
    })).rejects.toThrow('requires the executable from the verified app bundle')

    expect(ensureDisplayCaptureAvailable).not.toHaveBeenCalled()
    expect(launchDesktop).not.toHaveBeenCalled()
  })
})
