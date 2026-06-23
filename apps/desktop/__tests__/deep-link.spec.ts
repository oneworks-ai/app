import { describe, expect, it } from 'vitest'

import { findDesktopDeepLinkArg, parseDesktopDeepLinkLaunchRequest } from '../src/main/deep-link'

describe('desktop deep links', () => {
  it('parses standalone device links into standardized routes', () => {
    expect(parseDesktopDeepLinkLaunchRequest('oneworks://standalone/devices')).toEqual({
      standaloneRoutePath: '/standalone/devices'
    })
    expect(parseDesktopDeepLinkLaunchRequest('oneworks://standalone/devices/emulator-5554/debug')).toEqual({
      standaloneRoutePath: '/standalone/devices/emulator-5554/debug'
    })
    expect(parseDesktopDeepLinkLaunchRequest('oneworks://standalone/mobile-debug?deviceId=emulator-5554'))
      .toBeUndefined()
  })

  it('parses relay auth callbacks into workspace plugin routes', () => {
    const request = parseDesktopDeepLinkLaunchRequest(
      'oneworks://relay/auth?workspace=%2Fworkspace&scope=relay&serverId=prod#relay_token=sso-token'
    )

    expect(request).toEqual({
      workspaceFolder: '/workspace',
      routePath: 'plugins/relay/home?relayLogin=1&relayLoginServerId=prod#relay_token=sso-token'
    })
  })

  it('ignores unsupported deep links and finds supported argv entries', () => {
    expect(parseDesktopDeepLinkLaunchRequest('https://relay.example/login')).toBeUndefined()
    expect(findDesktopDeepLinkArg([
      '--flag',
      'one-works://relay/auth?workspace=%2Fworkspace&scope=relay'
    ])).toBe('one-works://relay/auth?workspace=%2Fworkspace&scope=relay')
  })
})
