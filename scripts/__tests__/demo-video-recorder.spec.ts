import { describe, expect, it, vi } from 'vitest'

import {
  buildSystemCursorClickTimingPlan,
  buildSystemCursorContinuityReport,
  getSystemCaptureTimelineElapsedMs,
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
    const adapterClickIndex = events.indexOf('click:.sender-select-shell--adapter .adapter-select')
    const popupIndex = events.indexOf('until:.adapter-select-popup')
    const cursorParkIndex = events.indexOf('move:.chat-route-header')
    const finalHoldIndex = events.lastIndexOf('record:4500')
    expect(workspaceReadyIndex).toBeGreaterThan(-1)
    expect(adapterClickIndex).toBeGreaterThan(workspaceReadyIndex)
    expect(popupIndex).toBeGreaterThan(adapterClickIndex)
    expect(cursorParkIndex).toBeGreaterThan(popupIndex)
    expect(finalHoldIndex).toBeGreaterThan(cursorParkIndex)
  })
})

describe('demo video recorder system capture timing', () => {
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
