import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isMacosWindowVisibilityMetricAcceptable,
  resolveDesktopRecordingVideoBackgroundImage,
  resolveRecordingWindowBounds
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

  it('rejects display crops that do not visually match the target window', () => {
    expect(isMacosWindowVisibilityMetricAcceptable({
      edgeFeaturePixelRatio: 0.002,
      edgeMeanDiff: 42,
      edgeOverlapRatio: 0.05,
      meanRgbDiff: 74,
      similarPixelRatio: 0.08
    })).toBe(false)
  })
})
