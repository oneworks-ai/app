import {
  PRIVATE_PLUGIN_PRESENTATION_VALUE,
  projectPluginPresentationValue,
  sanitizePluginPresentationValue
} from './plugin-presentation-text'
export { sanitizePluginIconRef, sanitizePluginMaterialIcon } from './plugin-presentation-icons'
export {
  PRIVATE_PLUGIN_PRESENTATION_VALUE,
  projectPluginPresentationValue,
  sanitizePluginAssetReference,
  sanitizePluginPresentationValue
} from './plugin-presentation-text'

const MAX_DEPTH = 8
const MAX_NODES = 256
const MAX_BREADTH = 64
const MAX_OWN_KEYS = 128
interface Budget {
  nodes: number
}

const readShape = (value: object) => {
  try {
    const prototype = Object.getPrototypeOf(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    return { descriptors, keys, prototype }
  } catch {
    return undefined
  }
}

const projectData = (value: unknown, depth: number, budget: Budget): unknown => {
  budget.nodes += 1
  if (budget.nodes > MAX_NODES || depth > MAX_DEPTH) return PRIVATE_PLUGIN_PRESENTATION_VALUE
  if (typeof value === 'string') return projectPluginPresentationValue(value)
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : PRIVATE_PLUGIN_PRESENTATION_VALUE
  if (typeof value !== 'object') return PRIVATE_PLUGIN_PRESENTATION_VALUE

  const shape = readShape(value)
  if (shape == null || shape.keys.length > MAX_OWN_KEYS) return PRIVATE_PLUGIN_PRESENTATION_VALUE
  budget.nodes += shape.keys.length
  if (budget.nodes > MAX_NODES) return PRIVATE_PLUGIN_PRESENTATION_VALUE

  if (Array.isArray(value)) {
    if (shape.prototype !== Array.prototype) return PRIVATE_PLUGIN_PRESENTATION_VALUE
    const length = shape.descriptors.length
    if (length == null || !('value' in length) || !Number.isSafeInteger(length.value) || length.value < 0) {
      return PRIVATE_PLUGIN_PRESENTATION_VALUE
    }
    const visible: unknown[] = []
    const visibleLength = Math.min(length.value, MAX_BREADTH)
    for (let index = 0; index < visibleLength; index += 1) {
      const descriptor = shape.descriptors[String(index)]
      visible.push(
        descriptor != null && 'value' in descriptor
          ? projectData(descriptor.value, depth + 1, budget)
          : PRIVATE_PLUGIN_PRESENTATION_VALUE
      )
    }
    if (length.value > MAX_BREADTH) visible.push(PRIVATE_PLUGIN_PRESENTATION_VALUE)
    return visible
  }

  if (shape.prototype !== Object.prototype && shape.prototype !== null) return PRIVATE_PLUGIN_PRESENTATION_VALUE
  const entries: Array<readonly [string, unknown]> = []
  for (const key of shape.keys) {
    if (typeof key !== 'string' || key === '__proto__') continue
    const descriptor = shape.descriptors[key]
    if (descriptor?.enumerable !== true) continue
    if (entries.length >= MAX_BREADTH) {
      entries.push([`${PRIVATE_PLUGIN_PRESENTATION_VALUE}:truncated`, PRIVATE_PLUGIN_PRESENTATION_VALUE])
      break
    }
    entries.push([
      sanitizePluginPresentationValue(key) ?? `${PRIVATE_PLUGIN_PRESENTATION_VALUE}:${entries.length}`,
      descriptor != null && 'value' in descriptor
        ? projectData(descriptor.value, depth + 1, budget)
        : PRIVATE_PLUGIN_PRESENTATION_VALUE
    ])
  }
  return Object.fromEntries(entries)
}

export const sanitizePluginPresentationData = (value: unknown): unknown => projectData(value, 0, { nodes: 0 })

export const projectPluginPresentationList = (value: unknown): string[] => {
  const projected = sanitizePluginPresentationData(value)
  if (!Array.isArray(projected)) return []
  return projected.map(item => typeof item === 'string' ? item : PRIVATE_PLUGIN_PRESENTATION_VALUE)
}
