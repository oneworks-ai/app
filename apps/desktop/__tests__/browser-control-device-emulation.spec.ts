import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { restoreBrowserControlDeviceEmulationForScope } from '../src/main/browser-control-device-emulation'

vi.mock('electron', () => ({ webContents: { fromId: vi.fn(() => undefined) } }))

const state = {
  device_pixel_ratio: 2,
  device_type: 'mobile' as const,
  enabled: true,
  height: 844,
  preset_id: 'iphone-14',
  width: 390,
  zoom: 'auto' as const
}

const fakeContents = (id: number) =>
  Object.assign(new EventEmitter(), {
    id,
    disableDeviceEmulation: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    isDestroyed: vi.fn(() => false)
  })

const scope = (webContentsId: number, panelPageId: string) => ({
  hostWebContentsId: 90,
  panelPageId,
  registeredAt: Date.now(),
  sessionKey: 'session-a',
  webContentsId,
  workspaceFolder: '/workspace'
})

describe('browser control device emulation restoration', () => {
  it.each([
    ['cross-area move replacement', 21, 'panel-moved'],
    ['duplicate replacement', 22, 'panel-copy']
  ])('restores persisted device state on %s scope registration', async (_label, guestId, panelPageId) => {
    const host = fakeContents(90)
    const guest = fakeContents(guestId)
    const sendPageCommand = vi.fn(async () => ({ device_mode: state }))

    await expect(restoreBrowserControlDeviceEmulationForScope(scope(guestId, panelPageId), {
      getWebContentsById: id => id === host.id ? host as never : id === guest.id ? guest as never : undefined,
      sendPageCommand
    })).resolves.toEqual({ restored: true, state })

    expect(sendPageCommand).toHaveBeenCalledWith(host, {
      command: { type: 'get_page_view_state' },
      pageId: `page_${guestId}`,
      panelPageId,
      sessionId: 'session-a'
    })
    expect(guest.enableDeviceEmulation).toHaveBeenCalledWith(expect.objectContaining({
      deviceScaleFactor: 2,
      screenPosition: 'mobile',
      viewSize: { height: 844, width: 390 }
    }))
  })

  it('actively disables native emulation when persisted device mode is off', async () => {
    const host = fakeContents(90)
    const guest = fakeContents(23)
    await restoreBrowserControlDeviceEmulationForScope(scope(guest.id, 'panel-disabled'), {
      getWebContentsById: id => id === host.id ? host as never : id === guest.id ? guest as never : undefined,
      sendPageCommand: vi.fn(async () => ({ device_mode: { ...state, enabled: false } }))
    })
    expect(guest.disableDeviceEmulation).toHaveBeenCalledOnce()
    expect(guest.enableDeviceEmulation).not.toHaveBeenCalled()
  })

  it('keeps the registered page controllable but reports a warning when native apply fails', async () => {
    const host = fakeContents(90)
    const guest = fakeContents(24)
    guest.enableDeviceEmulation.mockImplementation(() => {
      throw new Error('native emulation unavailable')
    })

    await expect(restoreBrowserControlDeviceEmulationForScope(scope(guest.id, 'panel-failed'), {
      getWebContentsById: id => id === host.id ? host as never : id === guest.id ? guest as never : undefined,
      sendPageCommand: vi.fn(async () => ({ device_mode: state }))
    })).resolves.toMatchObject({
      restored: false,
      warning: { code: 'DEVICE_EMULATION_RESTORE_FAILED' }
    })
    expect(guest.disableDeviceEmulation).toHaveBeenCalledOnce()
  })
})
