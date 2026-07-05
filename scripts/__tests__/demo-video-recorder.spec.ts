import { describe, expect, it } from 'vitest'

import {
  buildSystemCursorContinuityReport,
  sampleSystemCursorTimeline,
  shouldContinueSystemCaptureDuringAction
} from '../demo-video/recorder'

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
})
