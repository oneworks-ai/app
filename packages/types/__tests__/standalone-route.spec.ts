import { describe, expect, it } from 'vitest'

import {
  buildStandaloneDeviceDebugRoutePath,
  buildStandaloneRoutePath,
  buildStandaloneSessionTabRoutePath,
  isStandaloneDeviceRoutePath,
  normalizeStandaloneDeviceRoutePath,
  parseStandaloneDeviceRoutePath,
  parseStandaloneRoutePath,
  parseStandaloneSessionTabRoutePath,
  standaloneDeviceSettingsRoutePath,
  standaloneDevicesRoutePath
} from '../src/standalone-route'

describe('standalone routes', () => {
  it('builds and parses global device routes', () => {
    expect(standaloneDevicesRoutePath).toBe('/standalone/devices')
    expect(standaloneDeviceSettingsRoutePath).toBe('/standalone/devices/settings')
    expect(buildStandaloneDeviceDebugRoutePath('emulator-5554')).toBe('/standalone/devices/emulator-5554/debug')
    expect(parseStandaloneDeviceRoutePath('/standalone/devices')).toEqual({
      kind: 'devices',
      mode: 'devices'
    })
    expect(parseStandaloneDeviceRoutePath('/standalone/devices/settings')).toEqual({
      kind: 'devices',
      mode: 'settings'
    })
    expect(parseStandaloneDeviceRoutePath('/standalone/devices/emulator-5554/debug')).toEqual({
      deviceId: 'emulator-5554',
      kind: 'devices',
      mode: 'debug'
    })
  })

  it('builds and parses session-scoped panel tab routes', () => {
    const routePath = buildStandaloneSessionTabRoutePath({
      area: 'right',
      sessionId: 'session/1',
      tabId: 'web:https://example.test/a'
    })

    expect(routePath).toBe('/standalone/sessions/session%2F1/panels/right/tabs/web%3Ahttps%3A%2F%2Fexample.test%2Fa')
    expect(parseStandaloneSessionTabRoutePath(routePath)).toEqual({
      area: 'right',
      kind: 'session-tab',
      sessionId: 'session/1',
      tabId: 'web:https://example.test/a'
    })
  })

  it('normalizes only supported standalone route resources', () => {
    expect(normalizeStandaloneDeviceRoutePath('devices')).toBe('/standalone/devices')
    expect(buildStandaloneRoutePath({
      area: 'bottom',
      kind: 'session-tab',
      sessionId: 's1',
      tabId: 'terminal:1'
    })).toBe('/standalone/sessions/s1/panels/bottom/tabs/terminal%3A1')
    expect(parseStandaloneRoutePath('/standalone/sessions/s1/panels/bottom/tabs/terminal%3A1')).toEqual({
      area: 'bottom',
      kind: 'session-tab',
      sessionId: 's1',
      tabId: 'terminal:1'
    })
  })

  it('does not preserve the legacy mobile-debug route alias', () => {
    expect(isStandaloneDeviceRoutePath('/standalone/mobile-debug')).toBe(false)
    expect(parseStandaloneRoutePath('/standalone/mobile-debug?deviceId=emulator-5554')).toBeUndefined()
    expect(parseStandaloneRoutePath('/standalone/devices/emulator-5554')).toBeUndefined()
    expect(normalizeStandaloneDeviceRoutePath('mobile-debug')).toBeUndefined()
  })
})
