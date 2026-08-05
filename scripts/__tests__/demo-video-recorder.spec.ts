import { describe, expect, it, vi } from 'vitest'

import {
  assertRecordedVideoCoverage,
  buildSystemCameraFocusVideoFilter,
  buildSystemCursorClickTimingPlan,
  buildSystemCursorContinuityReport,
  getSystemCaptureTimelineElapsedMs,
  mapSystemDisplayPointToVideo,
  resolveSystemCameraFocusVideoPlan,
  sampleSystemCameraFocusTimeline,
  sampleSystemCursorTimeline,
  shouldContinueSystemCaptureDuringAction
} from '../demo-video/recorder'
import { getDemoVideoScenario } from '../demo-video/scenarios'
import type { DemoVideoScenarioContext } from '../demo-video/types'

describe('demo video scenario target following', () => {
  it('declares workspace target following on every Launcher-to-Workspace scenario', () => {
    expect(getDemoVideoScenario('launcher-open-workspace-ui-tour').followCdpTargets).toBe(true)
    expect(getDemoVideoScenario('launcher-open-workspace-adapter-tour').followCdpTargets).toBe(true)
    expect(getDemoVideoScenario('launcher-open-workspace-chat-smoke').followCdpTargets).toBe(true)
    expect(getDemoVideoScenario('launcher-browser-driver-agent-tour').followCdpTargets).toBe(true)
  })

  it('labels the embedded-browser scenario as In-App Browser Control', () => {
    const scenario = getDemoVideoScenario('launcher-browser-driver-agent-tour')
    expect(scenario.title).toBe('Electron In-App Browser Control Agent 演示')
    expect(scenario.description).toContain('In-App Browser Control')
  })

  it('registers a real Launcher-to-Workspace Adapter tour', () => {
    const scenario = getDemoVideoScenario('launcher-open-workspace-adapter-tour')
    expect(scenario.title).toContain('Adapter')
    expect(scenario.defaultFps).toBe(60)
    expect(scenario.requiresUrl).toBe(false)
  })

  it('opens a workspace, opens Adapter, then parks the cursor before the final hold', async () => {
    const events: string[] = []
    const recordFor = vi.fn(async (durationMs: number) => {
      events.push(`record:${durationMs}`)
    })
    const context: DemoVideoScenarioContext = {
      durationMs: 32_000,
      workspace: '/Users/Shared/One Works Demo',
      url: undefined,
      clickSelector: vi.fn(async selector => {
        events.push(`click:${selector}`)
      }),
      clickText: vi.fn(async () => {}),
      focusCameraOnSelector: vi.fn(async selector => {
        events.push(`camera:${selector}`)
      }),
      focusSelector: vi.fn(async () => {}),
      moveToSelector: vi.fn(async selector => {
        events.push(`move:${selector}`)
      }),
      navigate: vi.fn(async () => {}),
      openDesktopWorkspace: vi.fn(async () => {}),
      pressKey: vi.fn(async key => {
        events.push(`key:${key}`)
      }),
      recordDuring: vi.fn(async (_durationMs, action) => {
        await action()
      }),
      recordFor,
      recordUntilSelector: vi.fn(async selector => {
        events.push(`until:${selector}`)
      }),
      recordUntilSelectorAbsent: vi.fn(async selector => {
        events.push(`absent:${selector}`)
      }),
      recordUntilText: vi.fn(async () => {}),
      requireWorkspace: () => '/Users/Shared/One Works Demo',
      requireUrl: () => {
        throw new Error('URL is not used by this scenario.')
      },
      resolveUrl: path => path,
      selectTextInSelector: vi.fn(async () => {}),
      typeText: vi.fn(async text => {
        events.push(`type:${text}`)
      }),
      waitForText: vi.fn(async () => {})
    }

    await getDemoVideoScenario('launcher-open-workspace-adapter-tour').run(context)

    const workspaceReadyIndex = events.findIndex(event => event.startsWith('absent:.workspace-opening-overlay'))
    const cameraFocusIndex = events.indexOf('camera:.sender-select-shell--adapter .adapter-select')
    const adapterClickIndex = events.indexOf('click:.sender-select-shell--adapter .adapter-select')
    const popupIndex = events.indexOf('until:.adapter-select-popup')
    const cursorParkIndex = events.indexOf('move:.chat-route-header')
    const finalHoldIndex = events.lastIndexOf('record:4500')
    expect(workspaceReadyIndex).toBeGreaterThan(-1)
    expect(cameraFocusIndex).toBeGreaterThan(workspaceReadyIndex)
    expect(adapterClickIndex).toBeGreaterThan(cameraFocusIndex)
    expect(popupIndex).toBeGreaterThan(adapterClickIndex)
    expect(cursorParkIndex).toBeGreaterThan(popupIndex)
    expect(finalHoldIndex).toBeGreaterThan(cursorParkIndex)
  })
})

describe('demo video recorder system capture timing', () => {
  it('fails closed when the encoded video is shorter than the recorded timeline', () => {
    expect(() =>
      assertRecordedVideoCoverage({
        recordedDurationMs: 36_000,
        stillCount: 7
      })
    ).toThrow('expected at least 36 one-second stills')

    expect(() =>
      assertRecordedVideoCoverage({
        recordedDurationMs: 31_000,
        stillCount: 31
      })
    ).not.toThrow()

    for (
      const [recordedDurationMs, stillCount] of [
        [1_100, 1],
        [1_400, 1],
        [2_100, 2]
      ] as const
    ) {
      expect(() =>
        assertRecordedVideoCoverage({
          recordedDurationMs,
          stillCount
        })
      ).not.toThrow()
    }
  })

  it('treats recordDuring duration as a minimum while the action is still running', () => {
    expect(shouldContinueSystemCaptureDuringAction({
      actionSettled: false,
      capturedMs: 10_000,
      requestedDurationMs: 10_000
    })).toBe(true)
  })

  it('stops only after both the requested duration and scenario action are complete', () => {
    expect(shouldContinueSystemCaptureDuringAction({
      actionSettled: true,
      capturedMs: 9_000,
      requestedDurationMs: 10_000
    })).toBe(true)
    expect(shouldContinueSystemCaptureDuringAction({
      actionSettled: true,
      capturedMs: 10_000,
      requestedDurationMs: 10_000
    })).toBe(false)
  })

  it('accounts for system display capture startup latency when mapping actions to video time', () => {
    expect(getSystemCaptureTimelineElapsedMs({
      captureSource: 'system-display',
      elapsedWallMs: 500
    })).toBe(240)
    expect(getSystemCaptureTimelineElapsedMs({
      captureSource: 'cdp',
      elapsedWallMs: 500
    })).toBe(500)
  })

  it('starts cursor press animation before the input that may trigger UI behavior', () => {
    const plan = buildSystemCursorClickTimingPlan({ startMs: 1_000 })

    expect(plan.cursorClickStartMs).toBeLessThan(plan.mousePressedMs)
    expect(plan.cursorReleaseStartMs).toBeLessThan(plan.mouseReleasedMs)
    expect(plan.cursorReleaseStartMs + plan.cursorReleaseDurationMs).toBeLessThan(plan.mousePressedMs)
    expect(plan.mousePressedMs).toBeLessThan(plan.mouseReleasedMs)
  })
})

describe('demo video recorder camera focus', () => {
  const timeline = {
    enabled: true,
    events: [
      {
        durationMs: 1_000,
        from: { x: 960, y: 540 },
        fromScale: 1,
        startMs: 2_000,
        to: { x: 1_250, y: 610 },
        toScale: 1.55
      }
    ],
    initialPoint: { x: 960, y: 540 },
    initialScale: 1
  }

  it('eases from the full frame to a selector-centered zoom and holds it', () => {
    expect(sampleSystemCameraFocusTimeline(timeline, 1_999)).toEqual({
      scale: 1,
      x: 960,
      y: 540
    })
    expect(sampleSystemCameraFocusTimeline(timeline, 2_250)).toEqual({
      scale: 1.05693359375,
      x: 990.01953125,
      y: 547.24609375
    })
    expect(sampleSystemCameraFocusTimeline(timeline, 2_500)).toEqual({
      scale: 1.275,
      x: 1_105,
      y: 575
    })
    expect(sampleSystemCameraFocusTimeline(timeline, 3_000)).toEqual({
      scale: 1.55,
      x: 1_250,
      y: 610
    })
    expect(sampleSystemCameraFocusTimeline(timeline, 8_000)).toEqual({
      scale: 1.55,
      x: 1_250,
      y: 610
    })
  })

  it('maps a workspace selector point into the cropped display video coordinate space', () => {
    expect(mapSystemDisplayPointToVideo({
      crop: { height: 1_080, width: 1_920, x: 100, y: 200 },
      point: { x: 25, y: 35 },
      windowBounds: { height: 900, width: 1_440, x: 300, y: 500 }
    })).toEqual({
      x: 225,
      y: 335
    })
  })

  it('keeps cursor overlay before camera focus and supports camera focus without a cursor', () => {
    expect(resolveSystemCameraFocusVideoPlan({
      cameraFocusEnabled: true,
      cursorOverlayEnabled: true,
      segmentsDir: '/tmp/segments',
      videoPath: '/tmp/final.mp4'
    })).toEqual({
      baseVideoPath: '/tmp/segments/system-recording-base.mp4',
      cameraInputPath: '/tmp/segments/system-recording-with-cursor.mp4',
      cursorOutputPath: '/tmp/segments/system-recording-with-cursor.mp4'
    })
    expect(resolveSystemCameraFocusVideoPlan({
      cameraFocusEnabled: true,
      cursorOverlayEnabled: false,
      segmentsDir: '/tmp/segments',
      videoPath: '/tmp/final.mp4'
    })).toEqual({
      baseVideoPath: '/tmp/segments/system-recording-base.mp4',
      cameraInputPath: '/tmp/segments/system-recording-base.mp4',
      cursorOutputPath: '/tmp/segments/system-recording-with-cursor.mp4'
    })
  })

  it('builds a frame-evaluated zoom filter whose crop stays inside the scaled frame', () => {
    const filter = buildSystemCameraFocusVideoFilter({
      frameSize: { height: 1_080, width: 1_920 },
      timeline
    })

    expect(filter).toContain('eval=frame')
    expect(filter).toContain('crop=1920:1080')
    expect(filter).toContain('min(max(')
    expect(filter).toContain('iw-1920')
    expect(filter).toContain('ih-1080')
  })
})

describe('demo video recorder system cursor continuity', () => {
  it('accepts a smooth generated cursor move', () => {
    const timeline = {
      enabled: true,
      events: [
        {
          action: 'move' as const,
          durationMs: 1_000,
          from: { x: 100, y: 100 },
          startMs: 0,
          to: { x: 260, y: 180 }
        }
      ],
      initialPoint: { x: 100, y: 100 }
    }
    const samples = sampleSystemCursorTimeline({
      durationMs: 1_100,
      fps: 60,
      timeline
    })
    const report = buildSystemCursorContinuityReport({
      fps: 60,
      samples,
      timeline
    })

    expect(report.ok).toBe(true)
    expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('flags a cursor event whose source does not match the previous endpoint', () => {
    const timeline = {
      enabled: true,
      events: [
        {
          action: 'move' as const,
          durationMs: 500,
          from: { x: 120, y: 100 },
          startMs: 0,
          to: { x: 180, y: 100 }
        }
      ],
      initialPoint: { x: 100, y: 100 }
    }
    const samples = sampleSystemCursorTimeline({
      durationMs: 600,
      fps: 60,
      timeline
    })
    const report = buildSystemCursorContinuityReport({
      fps: 60,
      samples,
      timeline
    })

    expect(report.ok).toBe(false)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'cursor_event_source_jump',
          severity: 'error'
        })
      ])
    )
  })

  it('flags a one-frame cursor jump in the sampled trajectory', () => {
    const timeline = {
      enabled: true,
      events: [
        {
          action: 'move' as const,
          durationMs: 10,
          from: { x: 100, y: 100 },
          startMs: 0,
          to: { x: 820, y: 100 }
        }
      ],
      initialPoint: { x: 100, y: 100 }
    }
    const samples = sampleSystemCursorTimeline({
      durationMs: 100,
      fps: 60,
      timeline
    })
    const report = buildSystemCursorContinuityReport({
      fps: 60,
      samples,
      timeline
    })

    expect(report.ok).toBe(false)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'cursor_frame_jump',
          severity: 'error'
        })
      ])
    )
  })

  it('flags cursor events that overlap in time', () => {
    const timeline = {
      enabled: true,
      events: [
        {
          action: 'move' as const,
          durationMs: 500,
          from: { x: 100, y: 100 },
          startMs: 0,
          to: { x: 260, y: 180 }
        },
        {
          action: 'click' as const,
          durationMs: 220,
          from: { x: 260, y: 180 },
          startMs: 300,
          to: { x: 260, y: 180 }
        }
      ],
      initialPoint: { x: 100, y: 100 }
    }
    const samples = sampleSystemCursorTimeline({
      durationMs: 700,
      fps: 60,
      timeline
    })
    const report = buildSystemCursorContinuityReport({
      fps: 60,
      samples,
      timeline
    })

    expect(report.ok).toBe(false)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'cursor_event_overlap',
          severity: 'error'
        })
      ])
    )
  })

  it('samples click and release cursor scale animation', () => {
    const timeline = {
      enabled: true,
      events: [
        {
          action: 'click' as const,
          durationMs: 240,
          from: { x: 100, y: 100 },
          startMs: 0,
          to: { x: 100, y: 100 }
        },
        {
          action: 'release' as const,
          durationMs: 360,
          from: { x: 100, y: 100 },
          startMs: 240,
          to: { x: 100, y: 100 }
        }
      ],
      initialPoint: { x: 100, y: 100 }
    }
    const samples = sampleSystemCursorTimeline({
      durationMs: 660,
      fps: 1_000,
      timeline
    })

    expect(samples[0]?.action).toBe('click')
    expect(samples[0]?.scale).toBe(1)
    expect(samples[90]?.action).toBe('click')
    expect(samples[90]?.scale).toBeLessThan(0.95)
    expect(samples[241]?.action).toBe('release')
    expect(samples[241]?.scale).toBeLessThan(1)
    expect(samples[490]?.action).toBe('release')
    expect(samples[490]?.scale).toBeGreaterThan(1)
    expect(samples[640]?.action).toBe('idle')
    expect(samples[640]?.scale).toBe(1)
  })
})
