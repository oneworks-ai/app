import { describe, expect, it } from 'vitest'

import { shouldHideLauncherWindowOnBlur } from '../src/main/window-runtime-events'

describe('window runtime events', () => {
  it('keeps normal launcher blur-to-dismiss behavior', () => {
    expect(shouldHideLauncherWindowOnBlur('launcher', {})).toBe(true)
    expect(shouldHideLauncherWindowOnBlur('workspace', {})).toBe(false)
  })

  it('keeps recordable launcher windows visible for system display capture', () => {
    expect(shouldHideLauncherWindowOnBlur('launcher', {
      ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW: '1'
    })).toBe(false)
    expect(shouldHideLauncherWindowOnBlur('launcher', {
      ONEWORKS_DESKTOP_RECORDABLE_WINDOWS: '1'
    })).toBe(false)
  })
})
