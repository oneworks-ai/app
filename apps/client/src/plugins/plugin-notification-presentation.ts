import type { UiNotificationInput, UiNotificationSource } from '#~/notifications/notification-types'

import {
  PRIVATE_PLUGIN_PRESENTATION_VALUE,
  projectPluginPresentationValue,
  sanitizePluginMaterialIcon
} from './plugin-presentation'

type OwnDescriptors = Record<PropertyKey, PropertyDescriptor>

const readShape = (value: object) => {
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return undefined
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Reflect.ownKeys(descriptors).length > 32) return undefined
    return descriptors
  } catch {
    return undefined
  }
}

const readField = (descriptors: OwnDescriptors, key: string) => {
  const descriptor = descriptors[key]
  return descriptor != null && 'value' in descriptor ? descriptor.value : undefined
}

export const projectPluginNotificationActions = (value: unknown): UiNotificationInput['actions'] => {
  if (!Array.isArray(value)) return undefined
  let descriptors: OwnDescriptors
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined
    descriptors = Object.getOwnPropertyDescriptors(value) as unknown as OwnDescriptors
    if (Reflect.ownKeys(descriptors).length > 17) return undefined
  } catch {
    return undefined
  }
  const length = readField(descriptors, 'length')
  if (!Number.isSafeInteger(length) || length < 0 || length > 16) return undefined

  const actions: NonNullable<UiNotificationInput['actions']> = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (
      descriptor == null || !('value' in descriptor) || descriptor.value == null ||
      typeof descriptor.value !== 'object'
    ) continue
    const shape = readShape(descriptor.value)
    if (shape == null) continue
    const id = readField(shape, 'id')
    const title = readField(shape, 'title')
    if (typeof id !== 'string' || typeof title !== 'string') continue
    const closeOnClick = readField(shape, 'closeOnClick')
    const icon = sanitizePluginMaterialIcon(readField(shape, 'icon'))
    const onClick = readField(shape, 'onClick')
    const tone = readField(shape, 'tone')
    actions.push({
      id,
      title: projectPluginPresentationValue(title),
      ...(typeof closeOnClick === 'boolean' ? { closeOnClick } : {}),
      ...(icon == null ? {} : { icon }),
      ...(typeof onClick === 'function' ? { onClick } : {}),
      ...(tone === 'danger' || tone === 'default' || tone === 'primary' ? { tone } : {})
    })
  }
  return actions
}

export const projectPluginNotificationInput = (
  input: Omit<UiNotificationInput, 'source'>
): Omit<UiNotificationInput, 'source'> => {
  const shape = readShape(input)
  if (shape == null) return { title: PRIVATE_PLUGIN_PRESENTATION_VALUE }
  const id = readField(shape, 'id')
  const dedupeKey = readField(shape, 'dedupeKey')
  const title = readField(shape, 'title')
  const description = readField(shape, 'description')
  const descriptionFormat = readField(shape, 'descriptionFormat')
  const level = readField(shape, 'level')
  const ttlMs = readField(shape, 'ttlMs')
  return {
    ...(typeof id === 'string' ? { id } : {}),
    ...(typeof dedupeKey === 'string' ? { dedupeKey } : {}),
    title: typeof title === 'string' ? projectPluginPresentationValue(title) : PRIVATE_PLUGIN_PRESENTATION_VALUE,
    actions: projectPluginNotificationActions(readField(shape, 'actions')),
    description: typeof description === 'string' ? projectPluginPresentationValue(description) : undefined,
    descriptionFormat: descriptionFormat === 'markdown' || descriptionFormat === 'text'
      ? descriptionFormat
      : undefined,
    level: level === 'error' || level === 'info' || level === 'success' || level === 'warning'
      ? level
      : undefined,
    ttlMs: typeof ttlMs === 'number' || ttlMs === null ? ttlMs : undefined
  } satisfies Omit<UiNotificationInput, 'source'>
}

export const projectPluginNotificationSource = (source: UiNotificationSource) => {
  const shape = readShape(source)
  if (shape == null) {
    return {
      icon: 'notifications',
      key: 'host:private',
      kind: 'host' as const,
      title: PRIVATE_PLUGIN_PRESENTATION_VALUE
    }
  }
  const kind = readField(shape, 'kind') === 'plugin' ? 'plugin' as const : 'host' as const
  const scope = readField(shape, kind === 'plugin' ? 'scope' : 'id')
  const title = readField(shape, 'title')
  const name = readField(shape, 'name')
  const safeScope = projectPluginPresentationValue(typeof scope === 'string' ? scope : undefined)
  const safeTitle = projectPluginPresentationValue(
    typeof title === 'string' ? title : typeof name === 'string' ? name : safeScope
  )
  return {
    icon: sanitizePluginMaterialIcon(readField(shape, 'icon')) ?? (kind === 'plugin' ? 'extension' : 'notifications'),
    key: `${kind}:${safeScope}`,
    kind,
    scope: kind === 'plugin' ? safeScope : undefined,
    title: safeTitle
  }
}
