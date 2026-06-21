import { describe, expect, it } from 'vitest'

import {
  isDesktopContextCaptureAllowedForApplication,
  normalizeDesktopContextCaptureSettings,
  normalizeDesktopContextCaptureSettingsPatch
} from '../src/main/context-capture-settings'

describe('desktop context capture settings', () => {
  it('normalizes persisted settings with stable defaults', () => {
    expect(normalizeDesktopContextCaptureSettings(null)).toEqual({
      allowApplications: [],
      denyApplications: [],
      enabled: false,
      overlayPlacement: 'auto'
    })
    expect(normalizeDesktopContextCaptureSettings({
      allowApplications: ['com.apple.Safari', ' ', 'com.apple.Safari'],
      denyApplications: ['Slack'],
      enabled: true,
      overlayPlacement: 'above'
    })).toEqual({
      allowApplications: ['com.apple.Safari'],
      denyApplications: ['Slack'],
      enabled: true,
      overlayPlacement: 'above'
    })
    expect(normalizeDesktopContextCaptureSettings({
      enabled: 'yes',
      overlayPlacement: 'center'
    })).toEqual({
      allowApplications: [],
      denyApplications: [],
      enabled: false,
      overlayPlacement: 'auto'
    })
  })

  it('normalizes partial update patches without clearing existing fields', () => {
    expect(normalizeDesktopContextCaptureSettingsPatch({
      contextCapture: {
        overlayPlacement: 'below'
      }
    }, {
      allowApplications: ['com.apple.Safari'],
      denyApplications: ['Slack'],
      enabled: true,
      overlayPlacement: 'above'
    })).toEqual({
      contextCapture: {
        allowApplications: ['com.apple.Safari'],
        denyApplications: ['Slack'],
        enabled: true,
        overlayPlacement: 'below'
      }
    })

    expect(normalizeDesktopContextCaptureSettingsPatch({})).toEqual({})
  })

  it('honors enabled state and application allow and deny lists', () => {
    const settings = normalizeDesktopContextCaptureSettings({
      allowApplications: ['com.apple.Safari', 'Notes'],
      denyApplications: ['com.apple.Notes'],
      enabled: true
    })

    expect(isDesktopContextCaptureAllowedForApplication(settings, {
      bundleId: 'com.apple.Safari'
    })).toBe(true)
    expect(isDesktopContextCaptureAllowedForApplication(settings, {
      bundleId: 'com.apple.Notes',
      name: 'Notes'
    })).toBe(false)
    expect(isDesktopContextCaptureAllowedForApplication(settings, {
      name: 'Chrome'
    })).toBe(false)
    expect(isDesktopContextCaptureAllowedForApplication({
      ...settings,
      allowApplications: []
    }, {
      name: 'Chrome'
    })).toBe(true)
    expect(isDesktopContextCaptureAllowedForApplication({
      ...settings,
      enabled: false
    }, {
      bundleId: 'com.apple.Safari'
    })).toBe(false)
  })
})
