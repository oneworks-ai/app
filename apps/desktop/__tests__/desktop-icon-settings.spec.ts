import { describe, expect, it } from 'vitest'

import {
  normalizeDesktopIconSettings,
  normalizeDesktopIconSettingsPatch,
  resolveDesktopIconMode
} from '../src/main/desktop-icon-settings'

describe('desktop icon settings', () => {
  it('normalizes persisted icon settings with stable defaults', () => {
    expect(normalizeDesktopIconSettings({
      iconAppearance: 'dark',
      iconBackground: 'solid',
      iconTheme: 'metal'
    })).toEqual({
      iconAppearance: 'dark',
      iconBackground: 'solid',
      syncAppIcon: true,
      iconTheme: 'metal'
    })

    expect(normalizeDesktopIconSettings({
      iconAppearance: 'sepia',
      iconTheme: 'unknown'
    })).toEqual({
      iconAppearance: 'system',
      iconBackground: 'solid',
      syncAppIcon: true,
      iconTheme: 'metal'
    })

    expect(
      normalizeDesktopIconSettings({
        iconBackground: false
      }).iconBackground
    ).toBe('transparent')
    expect(
      normalizeDesktopIconSettings({
        iconBackground: true
      }).iconBackground
    ).toBe('solid')
  })

  it('normalizes partial update patches without touching missing fields', () => {
    expect(normalizeDesktopIconSettingsPatch({ iconTheme: 'matrix' })).toEqual({
      iconTheme: 'matrix'
    })
    expect(normalizeDesktopIconSettingsPatch({
      iconAppearance: 'light',
      iconBackground: 'transparent',
      iconTheme: 'bad',
      syncAppIcon: false
    }))
      .toEqual({
        iconAppearance: 'light',
        iconBackground: 'transparent',
        syncAppIcon: false,
        iconTheme: 'metal'
      })
    expect(normalizeDesktopIconSettingsPatch(null)).toEqual({})
  })

  it('resolves system appearance from the current native theme mode', () => {
    expect(resolveDesktopIconMode('system', true)).toBe('dark')
    expect(resolveDesktopIconMode('system', false)).toBe('light')
    expect(resolveDesktopIconMode('light', true)).toBe('light')
  })
})
