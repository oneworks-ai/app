import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ConfigTaskTabs } from '#~/components/config/ConfigTaskTabs'
import {
  configTaskTabQueryKey,
  getConfigTaskTabDefinitions,
  getConfigTaskTabFields,
  resolveConfigTaskTabKey
} from '#~/components/config/config-task-tabs'
import { configSchema } from '#~/components/config/configSchema'

vi.hoisted(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    })
  })
})

vi.mock('#~/i18n', () => ({
  appLanguageOptions: [
    { value: 'zh', label: 'config.options.language.zh' },
    { value: 'en', label: 'config.options.language.en' }
  ]
}))

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
const fieldKey = (field: { path: string[] }) => field.path.join('.')

describe('config task tabs', () => {
  it('partitions every general and conversation field into one user-task tab', () => {
    for (const sectionKey of ['general', 'conversation'] as const) {
      const tabFields = getConfigTaskTabDefinitions(sectionKey).flatMap(tab => (
        getConfigTaskTabFields(sectionKey, tab.key)
      ))
      const tabFieldKeys = tabFields.map(fieldKey)
      const schemaFieldKeys = configSchema[sectionKey].map(fieldKey)

      expect(tabFieldKeys).toHaveLength(new Set(tabFieldKeys).size)
      expect(tabFieldKeys.sort()).toEqual(schemaFieldKeys.sort())
    }
  })

  it('uses a stable query key and falls back to the first task for invalid links', () => {
    expect(configTaskTabQueryKey).toBe('sectionTab')
    expect(resolveConfigTaskTabKey({
      sectionKey: 'general',
      requestedTabKey: 'missing'
    })).toBe('base')
    expect(resolveConfigTaskTabKey({
      sectionKey: 'conversation',
      requestedTabKey: 'missing'
    })).toBe('defaults')
  })

  it('lets an existing detail path select its owning task tab', () => {
    expect(resolveConfigTaskTabKey({
      sectionKey: 'general',
      requestedTabKey: 'advanced',
      detailQuery: 'recommendedModels/0'
    })).toBe('models')
    expect(resolveConfigTaskTabKey({
      sectionKey: 'general',
      requestedTabKey: 'links',
      detailQuery: 'notifications/events/completed'
    })).toBe('notifications')
    expect(resolveConfigTaskTabKey({
      sectionKey: 'conversation',
      requestedTabKey: 'actions',
      detailQuery: 'startupPresets/0'
    })).toBe('presets')
    expect(resolveConfigTaskTabKey({
      sectionKey: 'conversation',
      requestedTabKey: 'presets',
      detailQuery: 'builtinActions/0'
    })).toBe('actions')
  })

  it('renders only the active task fields without repeating the host title', () => {
    const html = renderToStaticMarkup(
      <ConfigTaskTabs
        sectionKey='general'
        title='Host-owned general title'
        requestedTabKey='models'
        value={{}}
        onChange={() => undefined}
        onTaskTabChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        showHeader={false}
        t={t}
      />
    )

    expect(html).toContain('config.taskTabs.general.models')
    expect(html).toContain('>defaultAdapter<')
    expect(html).toContain('>recommendedModels<')
    expect(html).not.toContain('>interfaceLanguage<')
    expect(html).not.toContain('Host-owned general title')
  })

  it('keeps a legacy detail link inside the task-tab shell', () => {
    const html = renderToStaticMarkup(
      <ConfigTaskTabs
        detailQuery='startupPresets/0'
        sectionKey='conversation'
        requestedTabKey='defaults'
        value={{
          startupPresets: [{ title: 'Daily setup' }]
        }}
        onChange={() => undefined}
        onTaskTabChange={() => undefined}
        mergedModelServices={{}}
        mergedAdapters={{}}
        showHeader={false}
        t={t}
      />
    )

    expect(html).toContain('config.taskTabs.conversation.presets')
    expect(html).toContain('config.fields.conversation.starterItem.title.label')
    expect(html).not.toContain('config.fields.conversation.style.label')
  })
})
