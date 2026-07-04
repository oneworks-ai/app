import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  appendSwitch: vi.fn(),
  setPath: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    commandLine: {
      appendSwitch: electronMock.appendSwitch
    },
    setPath: electronMock.setPath
  }
}))

afterEach(() => {
  electronMock.appendSwitch.mockReset()
  electronMock.setPath.mockReset()
  vi.resetModules()
})

describe('desktop external CDP config', () => {
  it('stays disabled unless a CDP port is explicitly requested', async () => {
    const { resolveDesktopExternalCdpConfig } = await import('../src/main/external-cdp')

    expect(resolveDesktopExternalCdpConfig({
      argv: ['One Works'],
      env: {}
    })).toBeUndefined()
  })

  it('resolves an agent control endpoint from environment variables', async () => {
    const { resolveDesktopExternalCdpConfig } = await import('../src/main/external-cdp')

    expect(resolveDesktopExternalCdpConfig({
      argv: ['One Works'],
      env: {
        ONEWORKS_DESKTOP_CDP_ADDRESS: '127.0.0.1',
        ONEWORKS_DESKTOP_CDP_PORT: '9333',
        ONEWORKS_DESKTOP_USER_DATA_DIR: '/tmp/ow-agent-profile'
      }
    })).toEqual({
      address: '127.0.0.1',
      port: 9333,
      userDataDir: '/tmp/ow-agent-profile'
    })
  })

  it('resolves an agent control endpoint from launch arguments', async () => {
    const { resolveDesktopExternalCdpConfig } = await import('../src/main/external-cdp')

    expect(resolveDesktopExternalCdpConfig({
      argv: [
        'One Works',
        '--oneworks-cdp-port=9444',
        '--oneworks-cdp-address',
        '127.0.0.1',
        '--oneworks-user-data-dir',
        '/tmp/ow-launch-profile'
      ],
      env: {}
    })).toEqual({
      address: '127.0.0.1',
      port: 9444,
      userDataDir: '/tmp/ow-launch-profile'
    })
  })

  it('applies CDP switches and isolated userData before bootstrap', async () => {
    const { applyDesktopExternalCdpConfig } = await import('../src/main/external-cdp')

    const config = applyDesktopExternalCdpConfig({
      address: '127.0.0.1',
      port: 9555,
      userDataDir: '/tmp/ow-agent-profile'
    })

    expect(config).toEqual({
      address: '127.0.0.1',
      port: 9555,
      userDataDir: '/tmp/ow-agent-profile'
    })
    expect(electronMock.setPath).toHaveBeenCalledWith('userData', path.resolve('/tmp/ow-agent-profile'))
    expect(electronMock.appendSwitch).toHaveBeenCalledWith('remote-debugging-port', '9555')
    expect(electronMock.appendSwitch).toHaveBeenCalledWith('remote-debugging-address', '127.0.0.1')
  })
})
