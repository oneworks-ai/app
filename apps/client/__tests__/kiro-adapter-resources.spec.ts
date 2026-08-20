import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { nativeHistoryAdapters } from '#~/api/sessions'
import { buildBuiltinModelGroups } from '#~/hooks/chat/model-selector-data-builders'
import {
  adapterDisplayMap,
  builtInAdapterKeys,
  getAdapterDisplay,
  resolveAdapterDisplayIcon
} from '#~/resources/adapters'
import { renderIconRef } from '#~/utils/model-provider-icons'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = (path: string) => readFileSync(`${repositoryRoot}/${path}`, 'utf8')

const decodeSvgDataUri = (value: string) => {
  const prefix = 'data:image/svg+xml;utf8,'
  expect(value.startsWith(prefix)).toBe(true)
  return decodeURIComponent(value.slice(prefix.length)).trim()
}

describe('kiro adapter client resources', () => {
  it('registers Kiro without displacing Cursor, Grok, or Pi', () => {
    expect(adapterDisplayMap.kiro.title).toBe('Kiro')
    expect(adapterDisplayMap.kiro.icon).toContain('data:image/svg+xml')
    expect(builtInAdapterKeys).toEqual(expect.arrayContaining(['cursor', 'grok', 'kiro', 'pi']))
    expect(nativeHistoryAdapters).not.toContain('kiro')
  })

  it('keeps the official purple Kiro ghost asset identical across light/dark consumers', () => {
    const canonicalSvg = readRepositoryFile('assets/brand/adapters/kiro.svg').trim()
    const display = getAdapterDisplay('kiro')

    expect(decodeSvgDataUri(display.icon!)).toBe(canonicalSvg)
    expect(resolveAdapterDisplayIcon(display, 'light')).toBe(display.icon)
    expect(resolveAdapterDisplayIcon(display, 'dark')).toBe(display.icon)
    expect(canonicalSvg).toContain('viewBox="0 0 1200 1200"')
    expect(canonicalSvg).toContain('rx="260"')
    expect(canonicalSvg).toContain('#9046FF')
    expect(canonicalSvg).not.toMatch(/terminal adapter|oneworks-terminal/iu)
  })

  it('projects the official mark into Kiro selector data with an accessible small-size rendering', () => {
    const display = getAdapterDisplay('kiro')
    const groups = buildBuiltinModelGroups({
      activeBuiltinModels: {
        kiro: [{ value: 'default', title: 'Default', description: 'Kiro native default' }]
      },
      builtinGroupTitle: key => getAdapterDisplay(key).title,
      mergedModels: {}
    })

    expect(groups).toEqual([
      expect.objectContaining({
        key: 'builtin:kiro',
        title: 'Kiro',
        options: [expect.objectContaining({
          modelIcon: { kind: 'url', url: display.icon, darkUrl: undefined }
        })]
      })
    ])
    const selectorMarkup = renderToStaticMarkup(renderIconRef({
      icon: groups[0]?.options[0]?.modelIcon,
      imageClassName: 'model-selector-icon',
      symbolClassName: 'model-selector-symbol'
    }))
    const accessibleSmallIcon = renderToStaticMarkup(
      createElement('img', { alt: 'Kiro adapter', height: 16, src: display.icon, width: 16 })
    )
    expect(selectorMarkup).toContain('model-selector-icon')
    expect(selectorMarkup).toContain(encodeURIComponent('#9046FF'))
    expect(resolveAdapterDisplayIcon(display, 'dark')).toContain(encodeURIComponent('#9046FF'))
    expect(accessibleSmallIcon).toContain('alt="Kiro adapter"')
    expect(accessibleSmallIcon).toContain('height="16"')
    expect(accessibleSmallIcon).toContain('width="16"')
  })
})
