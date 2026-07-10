import { describe, expect, it } from 'vitest'

import { isWebProjectLauncherAvailable } from '#~/components/nav-rail-project-launcher'

describe('nav rail project launcher', () => {
  it('is available in the web workspace shell', () => {
    expect(isWebProjectLauncherAvailable({
      desktopClientMode: false,
      hasDesktopBridge: false
    })).toBe(true)
  })

  it('is hidden from every Electron shell signal', () => {
    expect(isWebProjectLauncherAvailable({
      desktopClientMode: true,
      hasDesktopBridge: false
    })).toBe(false)
    expect(isWebProjectLauncherAvailable({
      desktopClientMode: false,
      hasDesktopBridge: true
    })).toBe(false)
  })
})
