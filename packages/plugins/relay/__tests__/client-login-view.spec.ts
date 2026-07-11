import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('relay login view contracts', () => {
  it('renders capability-driven native login without an iframe', async () => {
    const source = await readFile(new URL('../src/client/react-view.ts', import.meta.url), 'utf8')

    expect(source).toContain('createRelayLoginOptions(ctx, {')
    expect(source).toContain("className: 'oneworks-relay__login-native'")
    expect(source).toContain("className: 'oneworks-relay__login-method-switcher'")
    expect(source).toContain("className: 'oneworks-relay__login-method-tabs'")
    expect(source).toContain('options.loginMethods.enabled.length <= 1')
    expect(source).toContain("replace(/^(?:使用\\s*|use\\s+)/iu, '')")
    expect(source).toContain("method === 'passkey'")
    expect(source).toContain("? '通行密钥'")
    expect(source).toContain("className: 'oneworks-relay__login-tab-panel native-tabs-panel'")
    expect(source).toMatch(/renderLoginField\(\s*'person'/u)
    expect(source).toMatch(/renderLoginField\(\s*'password'/u)
    expect(source).toMatch(/renderLoginField\(\s*'key'/u)
    expect(source).toMatch(/renderLoginField\(\s*'pin'/u)
    expect(source).not.toContain("className: 'oneworks-relay__login-field-label'")
    expect(source).toContain('readRelayRememberedLogins')
    expect(source).toContain("label: '登录到其他服务器'")
    expect(source).toContain("completingRegistration ? '返回登录' : '注册账号'")
    expect(source).not.toContain('注册新账号或使用完整安全登录页')
    expect(source).toContain(
      "className: 'oneworks-relay__login-method-switch-button oneworks-relay__login-footer-action'"
    )
    expect(source).toContain('`打开 $' + '{serverName} 兼容登录页`')
    expect(source).toContain('`无法读取 $' + '{serverName} 登录方式`')
    expect(source).toContain("label: '重试'")
    expect(source).toContain("icon: 'swap_horiz'")
    expect(source).toContain("className: 'oneworks-relay__login-error-state-details'")
    expect(source).toContain('serverName: selectedServerDisplayName(status, route.serverId)')
    expect(source).not.toContain("'cloud_off'")
    expect(source).toContain('openLoginDestination(provider.startUrl)')
    expect(source).toContain('desktopApi?.openExternalUrl')
    expect(source).not.toContain("className: 'oneworks-relay__login-header'")
    expect(source).not.toContain("react.createElement('iframe'")
  })
})
