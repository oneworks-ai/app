import { describe, expect, it } from 'vitest'

import {
  QUIT_CONFIRMATION_RESPONSE,
  buildQuitConfirmationMenuLabel,
  buildQuitConfirmationMessageBoxOptions,
  resolveQuitConfirmationAppName,
  resolveQuitConfirmationLanguage,
  resolveQuitConfirmationSystemLocale
} from '../src/main/quit-confirmation'

describe('quit confirmation helpers', () => {
  it('normalizes package names to the user-facing app name', () => {
    expect(resolveQuitConfirmationAppName('@oneworks/desktop')).toBe('One Works')
    expect(resolveQuitConfirmationAppName('Electron')).toBe('One Works')
    expect(resolveQuitConfirmationAppName('One Works Dev')).toBe('One Works Dev')
  })

  it('uses configured interface language before system locale', () => {
    expect(resolveQuitConfirmationLanguage({ configuredLanguage: 'zh', systemLocale: 'en-US' })).toBe('zh')
    expect(resolveQuitConfirmationLanguage({ configuredLanguage: 'en', systemLocale: 'zh-CN' })).toBe('en')
  })

  it('uses preferred system languages before the Electron app locale', () => {
    const systemLocale = resolveQuitConfirmationSystemLocale({
      appLocale: 'en-US',
      preferredSystemLanguages: ['zh-CN', 'en-US']
    })
    expect(systemLocale).toBe('zh-CN')
    expect(resolveQuitConfirmationLanguage({ appLocale: 'en-US', systemLocale })).toBe('zh')
    expect(resolveQuitConfirmationSystemLocale({
      appLocale: 'en-US',
      preferredSystemLanguages: []
    })).toBe('en-US')
  })

  it('falls back to system locale and then the app default language', () => {
    expect(resolveQuitConfirmationLanguage({ systemLocale: 'zh-CN' })).toBe('zh')
    expect(resolveQuitConfirmationLanguage({ systemLocale: 'en-US' })).toBe('en')
    expect(resolveQuitConfirmationLanguage({ configuredLanguage: 'fr-FR', systemLocale: 'zh-CN' })).toBe('zh')
    expect(resolveQuitConfirmationLanguage({ appLocale: 'en-US', systemLocale: 'fr-FR' })).toBe('en')
    expect(resolveQuitConfirmationLanguage({ systemLocale: 'fr-FR' })).toBe('zh')
    expect(resolveQuitConfirmationLanguage({})).toBe('zh')
  })

  it('builds localized quit menu labels', () => {
    expect(buildQuitConfirmationMenuLabel({
      appName: 'One Works',
      includeAppName: true,
      language: 'zh'
    })).toBe('退出 One Works')
    expect(buildQuitConfirmationMenuLabel({
      appName: 'One Works',
      includeAppName: false,
      language: 'zh'
    })).toBe('退出')
  })

  it('builds localized quit dialog options with enter confirming quit and escape canceling', () => {
    const zhOptions = buildQuitConfirmationMessageBoxOptions({
      appName: 'One Works',
      language: 'zh'
    })
    expect(zhOptions.message).toBe('要退出 One Works 吗？')
    expect(zhOptions.buttons).toEqual(['取消', '退出'])
    expect(zhOptions.defaultId).toBe(QUIT_CONFIRMATION_RESPONSE.quit)
    expect(zhOptions.cancelId).toBe(QUIT_CONFIRMATION_RESPONSE.cancel)

    const enOptions = buildQuitConfirmationMessageBoxOptions({
      appName: 'One Works',
      language: 'en'
    })
    expect(enOptions.message).toBe('Quit One Works?')
    expect(enOptions.buttons).toEqual(['Cancel', 'Quit'])
  })
})
