import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { adapterDisplayMap, builtInAdapterKeys } from '#~/resources/adapters'

interface ProductBrandCatalogEntry {
  darkIcon?: string
  enabled: boolean
  featured: boolean
  icon: string
  id: string
  kind: 'adapter' | 'channel' | 'model-service'
  label: string
  outputId?: string
  priority: number
}

interface ProductBrandCatalog {
  entries: ProductBrandCatalogEntry[]
  schemaVersion: number
}

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = (path: string) => readFileSync(`${repositoryRoot}/${path}`, 'utf8')
const catalog = JSON.parse(readRepositoryFile('assets/brand/catalog.json')) as ProductBrandCatalog

const decodeSvgDataUri = (value: string) => {
  const prefix = 'data:image/svg+xml;utf8,'
  expect(value.startsWith(prefix)).toBe(true)
  return decodeURIComponent(value.slice(prefix.length))
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

const normalizeSvg = (value: string) =>
  value
    .trim()
    .replaceAll(/\s+/gu, ' ')
    .replaceAll('#000000', '#000')
    .replaceAll('#ffffff', '#fff')
    .replaceAll(' height="1em"', '')
    .replaceAll(' style="flex:none;line-height:1"', '')
    .replaceAll(' width="1em"', '')
    .replace(/^<svg[^>]*>/u, '')
    .replace(/<\/svg>$/u, '')

describe('product brand catalog', () => {
  it('covers every built-in adapter exactly once in product order', () => {
    const adapters = catalog.entries.filter(entry => entry.kind === 'adapter')

    expect(catalog.schemaVersion).toBe(1)
    expect(adapters.map(entry => entry.id)).toEqual(builtInAdapterKeys)
    expect(adapters.map(entry => entry.label)).toEqual(
      builtInAdapterKeys.map(key => adapterDisplayMap[key as keyof typeof adapterDisplayMap].title)
    )
    expect(new Set(adapters.map(entry => entry.priority)).size).toBe(adapters.length)
  })

  it('publishes Pi after OpenCode with the official light and dark marks', () => {
    const pi = catalog.entries.find(entry => entry.kind === 'adapter' && entry.id === 'pi')
    const display = adapterDisplayMap.pi

    expect(pi).toMatchObject({
      darkIcon: 'assets/brand/adapters/pi-dark.svg',
      enabled: true,
      featured: true,
      icon: 'assets/brand/adapters/pi.svg',
      label: 'Pi',
      priority: 70
    })
    expect(normalizeSvg(readRepositoryFile(pi!.icon))).toBe(normalizeSvg(decodeSvgDataUri(display.icon)))
    expect(normalizeSvg(readRepositoryFile(pi!.darkIcon!))).toBe(normalizeSvg(decodeSvgDataUri(display.darkIcon)))
  })

  it('publishes Cline with the official light and dark marks', () => {
    const cline = catalog.entries.find(entry => entry.kind === 'adapter' && entry.id === 'cline')
    const display = adapterDisplayMap.cline

    expect(cline).toMatchObject({
      darkIcon: 'assets/brand/adapters/cline-dark.svg',
      enabled: true,
      featured: true,
      icon: 'assets/brand/adapters/cline.svg',
      label: 'Cline',
      priority: 15
    })
    expect(normalizeSvg(readRepositoryFile(cline!.icon))).toBe(normalizeSvg(decodeSvgDataUri(display.icon)))
    expect(normalizeSvg(readRepositoryFile(cline!.darkIcon!))).toBe(
      normalizeSvg(decodeSvgDataUri(display.darkIcon))
    )
  })

  it('publishes Kiro with the same original neutral terminal mark used by the client package', () => {
    const kiro = catalog.entries.find(entry => entry.kind === 'adapter' && entry.id === 'kiro')
    const display = adapterDisplayMap.kiro

    expect(kiro).toMatchObject({
      enabled: true,
      featured: true,
      icon: 'assets/brand/adapters/kiro.svg',
      label: 'Kiro',
      priority: 47
    })
    expect(normalizeSvg(readRepositoryFile(kiro!.icon))).toBe(normalizeSvg(decodeSvgDataUri(display.icon)))
    expect(readRepositoryFile(kiro!.icon)).not.toMatch(/ghost|official Kiro|#(?:7c3aed|9148ff|813eea|6932c8)/iu)
  })

  it('references repository-contained source assets', () => {
    for (const entry of catalog.entries) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/u)
      expect(entry.label.trim()).not.toBe('')
      expect(entry.priority).toBeGreaterThanOrEqual(0)
      expect(() => readRepositoryFile(entry.icon)).not.toThrow()
      if (entry.darkIcon != null) expect(() => readRepositoryFile(entry.darkIcon!)).not.toThrow()
    }
  })
})
