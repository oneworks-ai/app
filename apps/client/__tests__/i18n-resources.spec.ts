import { readFileSync } from 'node:fs'

import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { applyHotTranslationUpdates, buildTranslationResources } from '#~/i18n-resources'

const readLocaleSource = (locale: 'en' | 'zh') =>
  readFileSync(
    new URL(`../src/resources/locales/${locale}.json`, import.meta.url),
    'utf8'
  )

const readPlatformDescriptionKeys = (source: string) => {
  const marker = '"platformDescriptions": {'
  const start = source.indexOf(marker)
  const end = source.indexOf('\n      }', start)
  if (start < 0 || end < 0) {
    throw new Error('Missing native history platformDescriptions locale namespace')
  }
  return source.slice(start + marker.length, end).split('\n').flatMap((line) => {
    const trimmed = line.trimStart()
    if (!trimmed.startsWith('"')) return []
    const keyEnd = trimmed.indexOf('"', 1)
    return keyEnd < 0 ? [] : [trimmed.slice(1, keyEnd)]
  })
}

const readInterpolationKeys = (value: string) => {
  const keys: string[] = []
  let offset = 0
  while (offset < value.length) {
    const start = value.indexOf('{{', offset)
    if (start < 0) break
    const end = value.indexOf('}}', start + 2)
    if (end < 0) break
    keys.push(value.slice(start + 2, end).split(',', 1)[0]!.trim())
    offset = end + 2
  }
  return keys.sort()
}

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

  it('keeps Qwen Code native-history descriptions distinct from Cursor across locales', () => {
    const enSource = readLocaleSource('en')
    const zhSource = readLocaleSource('zh')
    const en = JSON.parse(enSource) as {
      nativeHistoryImport: {
        manager: { platformDescriptions: Record<string, string> }
        platforms: Record<string, string>
      }
    }
    const zh = JSON.parse(zhSource) as typeof en
    const expectedDescriptionKeys = ['codex', 'claude-code', 'cursor', 'qwen-code']

    for (const source of [enSource, zhSource]) {
      const keys = readPlatformDescriptionKeys(source)
      expect(keys).toEqual(expectedDescriptionKeys)
      expect(new Set(keys).size).toBe(keys.length)
    }
    expect(Object.keys(en.nativeHistoryImport.manager.platformDescriptions).sort()).toEqual(
      Object.keys(zh.nativeHistoryImport.manager.platformDescriptions).sort()
    )
    expect(en.nativeHistoryImport.manager.platformDescriptions.cursor).toBe(
      'Scans JSONL transcripts under ~/.cursor/projects.'
    )
    expect(zh.nativeHistoryImport.manager.platformDescriptions.cursor).toBe(
      '扫描 ~/.cursor/projects 下的 JSONL 会话记录。'
    )
    expect(en.nativeHistoryImport.manager.platformDescriptions['qwen-code']).toBe(
      'Scans Qwen Code 0.21.11-compatible chats and subagents. The source root resolves from QWEN_RUNTIME_DIR, then QWEN_HOME, then ~/.qwen.'
    )
    expect(zh.nativeHistoryImport.manager.platformDescriptions['qwen-code']).toBe(
      '扫描与 Qwen Code 0.21.11 兼容的 chats 与 subagents 记录；来源根目录依次解析 QWEN_RUNTIME_DIR、QWEN_HOME，最后回退到 ~/.qwen。'
    )
    for (const key of expectedDescriptionKeys) {
      expect(readInterpolationKeys(en.nativeHistoryImport.manager.platformDescriptions[key]!)).toEqual(
        readInterpolationKeys(zh.nativeHistoryImport.manager.platformDescriptions[key]!)
      )
    }
    expect(en.nativeHistoryImport.platforms).toMatchObject({ cursor: 'Cursor', grok: 'Grok' })
    expect(zh.nativeHistoryImport.platforms).toMatchObject({ cursor: 'Cursor', grok: 'Grok' })
  })

  it('keeps complete English and Chinese Factory Droid config metadata in parity', () => {
    const readDroidMetadata = (locale: 'en' | 'zh') =>
      (
        JSON.parse(readFileSync(
          new URL(`../src/resources/locales/${locale}.json`, import.meta.url),
          'utf8'
        )) as {
          config: {
            fields: {
              adaptersByKey: {
                droid: Record<string, unknown>
              }
            }
          }
        }
      ).config.fields.adaptersByKey.droid
    const collectPaths = (value: unknown, prefix = ''): string[] => {
      if (value == null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
      return Object.entries(value as Record<string, unknown>)
        .flatMap(([key, child]) => collectPaths(child, prefix === '' ? key : `${prefix}.${key}`))
    }
    const en = readDroidMetadata('en')
    const zh = readDroidMetadata('zh')

    expect(collectPaths(en).sort()).toEqual(collectPaths(zh).sort())
    expect(collectPaths(en)).toEqual(expect.arrayContaining([
      'cli.label',
      'cli.desc',
      'effort.label',
      'effort.desc',
      'effort.options.low',
      'effort.options.medium',
      'effort.options.high',
      'effort.options.xhigh',
      'effort.options.max',
      'configContent.label',
      'configContent.desc',
      'disableBuiltinSkills.label',
      'disableBuiltinSkills.desc'
    ]))
  })
})
