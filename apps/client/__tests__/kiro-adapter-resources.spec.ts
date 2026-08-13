import { existsSync, readFileSync } from 'node:fs'
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

const relativeLuminance = (hex: string) => {
  const channels = hex.match(/[\da-f]{2}/giu)?.map(channel => Number.parseInt(channel, 16) / 255) ?? []
  return channels.map(channel =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
}

const contrastRatio = (foreground: string, background: string) => {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

describe('kiro adapter client resources', () => {
  it('registers Kiro without displacing Cursor, Grok, or Pi', () => {
    expect(adapterDisplayMap.kiro.title).toBe('Kiro')
    expect(adapterDisplayMap.kiro.icon).toContain('data:image/svg+xml')
    expect(builtInAdapterKeys).toEqual(expect.arrayContaining(['cursor', 'grok', 'kiro', 'pi']))
    expect(nativeHistoryAdapters).not.toContain('kiro')
  })

  it('keeps the original neutral terminal asset identical and legible across light/dark consumers', () => {
    const canonicalSvg = readRepositoryFile('assets/brand/adapters/kiro.svg').trim()
    const display = getAdapterDisplay('kiro')

    expect(decodeSvgDataUri(display.icon!)).toBe(canonicalSvg)
    expect(resolveAdapterDisplayIcon(display, 'light')).toBe(display.icon)
    expect(resolveAdapterDisplayIcon(display, 'dark')).toBe(display.icon)
    expect(canonicalSvg).toContain('<title id="oneworks-terminal-adapter-title">Terminal adapter</title>')
    expect(canonicalSvg).toContain('aria-labelledby="oneworks-terminal-adapter-title"')
    expect(canonicalSvg).toContain('role="img"')
    expect(canonicalSvg).toContain('viewBox="0 0 24 24"')
    expect(canonicalSvg).toContain('height="1em"')
    expect(canonicalSvg).toContain('width="1em"')
    expect(contrastRatio('#6EE7D8', '#263238')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#F5F7F8', '#263238')).toBeGreaterThanOrEqual(4.5)
    expect(canonicalSvg).not.toMatch(/ghost|official Kiro|#(?:7c3aed|9148ff|813eea|6932c8)|<ellipse|radialGradient/iu)
    expect(existsSync(`${repositoryRoot}/assets/brand/adapters/kiro.provenance.md`)).toBe(false)
    expect(existsSync(`${repositoryRoot}/packages/adapters/kiro/THIRD_PARTY_NOTICES.md`)).toBe(false)
  })

  it('projects the neutral mark into Kiro selector data with an accessible small-size rendering', () => {
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
    expect(selectorMarkup).toContain(encodeURIComponent('oneworks-terminal-adapter-title'))
    expect(resolveAdapterDisplayIcon(display, 'dark')).toContain(
      encodeURIComponent('oneworks-terminal-adapter-title')
    )
    expect(accessibleSmallIcon).toContain('alt="Kiro adapter"')
    expect(accessibleSmallIcon).toContain('height="16"')
    expect(accessibleSmallIcon).toContain('width="16"')
  })
})
