import { readFileSync } from 'node:fs'

import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { applyHotTranslationUpdates, buildTranslationResources } from '#~/i18n-resources'

describe('i18n resources', () => {
  it('builds i18next resources from locale module paths', () => {
    expect(buildTranslationResources({
      './resources/locales/en.json': {
        default: { title: 'Hello' }
      },
      './resources/locales/zh.json': {
        default: { title: '你好' }
      }
    })).toEqual({
      en: {
        translation: { title: 'Hello' }
      },
      zh: {
        translation: { title: '你好' }
      }
    })
  })

  it('replaces translation bundles during hot updates', async () => {
    const i18n = createInstance()

    await i18n.init({
      lng: 'en',
      resources: {
        en: {
          translation: {
            title: 'Old title',
            removed: 'stale'
          }
        }
      }
    })

    applyHotTranslationUpdates({
      instance: i18n,
      modulePaths: ['./resources/locales/en.json'],
      nextModules: [
        {
          default: {
            title: 'New title'
          }
        }
      ]
    })

    expect(i18n.getResourceBundle('en', 'translation')).toEqual({
      title: 'New title'
    })
  })

  it('keeps interface-language synchronization in the dedicated config hook', () => {
    const appPreferencesSource = readFileSync(
      new URL('../src/hooks/use-app-preferences.ts', import.meta.url),
      'utf8'
    )
    const interfaceLanguageSource = readFileSync(
      new URL('../src/hooks/use-interface-language-config.ts', import.meta.url),
      'utf8'
    )

    expect(appPreferencesSource).not.toContain('changeAppLanguage')
    expect(appPreferencesSource).not.toContain('interfaceLanguage')
    expect(interfaceLanguageSource).toContain('updateGlobalInterfaceLanguage')
    expect(interfaceLanguageSource).toContain('changeAppLanguage')
  })

  it('does not claim quota refresh before reset-credit revalidation settles', () => {
    const readLocale = (locale: 'en' | 'zh') =>
      JSON.parse(readFileSync(
        new URL(`../src/resources/locales/${locale}.json`, import.meta.url),
        'utf8'
      )) as {
        config: {
          accounts: {
            resetCredits: {
              outcomes: {
                reset: string
              }
            }
          }
        }
      }

    expect(readLocale('en').config.accounts.resetCredits.outcomes.reset).toBe('Reset credit used.')
    expect(readLocale('zh').config.accounts.resetCredits.outcomes.reset).toBe('额度重置卡已使用。')
  })
})
