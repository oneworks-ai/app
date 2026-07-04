import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getLocale: () => 'en-US',
    getPreferredSystemLanguages: () => ['en-US']
  },
  nativeTheme: {
    shouldUseDarkColors: false
  }
}))

const originalPlatform = process.platform
const originalRecordableLauncherWindow = process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

afterEach(() => {
  setPlatform(originalPlatform)
  if (originalRecordableLauncherWindow == null) {
    delete process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW
  } else {
    process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW = originalRecordableLauncherWindow
  }
})

describe('window chrome options', () => {
  it('keeps the normal launcher as a macOS panel window', async () => {
    setPlatform('darwin')
    delete process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW
    const { getWindowChromeOptions } = await import('../src/main/window-chrome-options')

    expect(getWindowChromeOptions({ isLauncherWindow: true, isStandaloneWindow: false })).toMatchObject({
      alwaysOnTop: true,
      frame: false,
      hiddenInMissionControl: true,
      transparent: true,
      type: 'panel',
      vibrancy: 'popover'
    })
  })

  it('can launch the launcher as a recordable glass regular window for demo videos', async () => {
    setPlatform('darwin')
    process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW = '1'
    const { getWindowChromeOptions } = await import('../src/main/window-chrome-options')

    const options = getWindowChromeOptions({ isLauncherWindow: true, isStandaloneWindow: false })
    expect(options).toMatchObject({
      backgroundColor: '#00000000',
      frame: false,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active'
    })
    expect(options).not.toHaveProperty('alwaysOnTop')
    expect(options).not.toHaveProperty('hiddenInMissionControl')
    expect(options).not.toHaveProperty('type')
  })
})
