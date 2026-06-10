import { describe, expect, it } from 'vitest'

import { toElectronAccelerator } from '../src/main/launcher-shortcut'

describe('launcher shortcut helpers', () => {
  it('converts supported desktop shortcuts to Electron accelerators', () => {
    expect(toElectronAccelerator('mod+space')).toBe('CommandOrControl+Space')
    expect(toElectronAccelerator('option+space')).toBe('Alt+Space')
    expect(toElectronAccelerator('ctrl+space')).toBe('Control+Space')
    expect(toElectronAccelerator('cmd+shift+p')).toBe('Command+Shift+P')
  })

  it('rejects invalid global shortcuts', () => {
    expect(toElectronAccelerator('cmd+shift')).toBeNull()
    expect(toElectronAccelerator('space')).toBeNull()
    expect(toElectronAccelerator('cmd+not-a-real-key')).toBeNull()
  })
})
