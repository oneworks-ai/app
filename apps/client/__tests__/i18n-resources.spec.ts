import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { applyHotTranslationUpdates, buildTranslationResources } from '#~/i18n-resources'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

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

  it('resolves archive success copy in every supported locale', async () => {
    const i18n = createInstance()

    await i18n.init({
      lng: 'en',
      resources: buildTranslationResources({
        './resources/locales/en.json': { default: en },
        './resources/locales/zh.json': { default: zh }
      })
    })

    const englishCopy = i18n.t('common.archived')
    await i18n.changeLanguage('zh')
    const chineseCopy = i18n.t('common.archived')

    expect({
      en: englishCopy,
      zh: chineseCopy
    }).toEqual({
      en: 'Archived successfully',
      zh: '归档成功'
    })
    expect([englishCopy, chineseCopy]).not.toContain('common.archived')
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
})
