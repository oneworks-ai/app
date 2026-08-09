import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

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
      iconTheme: 'linear'
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
    expect(normalizeDesktopIconSettingsPatch({ iconTheme: 'linear' })).toEqual({
      iconTheme: 'linear'
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
        iconTheme: 'linear'
      })
    expect(normalizeDesktopIconSettingsPatch(null)).toEqual({})
  })

  it('resolves system appearance from the current native theme mode', () => {
    expect(resolveDesktopIconMode('system', true)).toBe('dark')
    expect(resolveDesktopIconMode('system', false)).toBe('light')
    expect(resolveDesktopIconMode('light', true)).toBe('light')
  })

  it('ships the linear runtime icon assets for every background and platform', () => {
    const iconRoot = new URL('../build/icons/linear/', import.meta.url)
    const backgrounds = ['', 'solid/', 'transparent/']
    const platforms = ['', 'linux/', 'macos/', 'windows/']

    for (const background of backgrounds) {
      for (const platform of platforms) {
        for (const mode of ['light', 'dark']) {
          const png = readFileSync(new URL(`${background}${platform}${mode}.png`, iconRoot))
          expect(png.subarray(0, 8)).toEqual(
            Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
          )
        }
      }
    }

    expect(readFileSync(new URL('dark.svg', iconRoot), 'utf8')).toContain(
      'data-oneworks-surface="linear"'
    )
    expect(
      JSON.parse(readFileSync(new URL('../build/icons/manifest.json', import.meta.url), 'utf8'))
    ).toMatchObject({
      defaultTheme: 'linear',
      themes: expect.arrayContaining(['linear'])
    })
  })
})
