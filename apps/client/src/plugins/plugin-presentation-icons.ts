import type { IconRef } from '@oneworks/types'

import { sanitizePluginAssetReference } from './plugin-presentation-text'

export const sanitizePluginMaterialIcon = (value: string | undefined) => (
  value != null && /^[a-z0-9_-]{1,64}$/u.test(value) ? value : undefined
)

export const sanitizePluginIconRef = (icon: IconRef | undefined): IconRef | undefined => {
  if (icon?.kind === 'builtin') {
    const id = sanitizePluginMaterialIcon(icon.id)
    return id == null ? undefined : { id, kind: 'builtin' }
  }
  if (icon?.kind === 'material') {
    const name = sanitizePluginMaterialIcon(icon.name)
    return name == null ? undefined : { kind: 'material', name }
  }
  if (icon?.kind !== 'url') return undefined
  const url = sanitizePluginAssetReference(icon.url)
  if (url == null) return undefined
  const darkUrl = sanitizePluginAssetReference(icon.darkUrl)
  return { kind: 'url', url, ...(darkUrl == null ? {} : { darkUrl }) }
}
