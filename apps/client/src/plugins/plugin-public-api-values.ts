const MAX_ITEMS = 128
const MAX_STRING_BYTES = 16 * 1024
const MAX_TOTAL_BYTES = 256 * 1024
const TEXT_ENCODER = new TextEncoder()

export interface PublicParseState {
  bytes: number
  objects: WeakSet<object>
}

export const createPublicParseState = (): PublicParseState => ({
  bytes: 0,
  objects: new WeakSet<object>()
})

export const isPublicRecord = (value: unknown, state: PublicParseState): value is Record<string, unknown> => {
  if (value == null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || state.objects.has(value)) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length > MAX_ITEMS) return false
  for (const key of keys) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) return false
  }
  state.objects.add(value)
  return true
}

export const getPublicValue = (record: Record<string, unknown>, key: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor != null && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

export const hasPublicFields = (value: object) => Object.keys(value).length > 0

export const parsePublicString = (value: unknown, state: PublicParseState) => {
  if (typeof value !== 'string') return undefined
  const bytes = TEXT_ENCODER.encode(value).byteLength
  if (bytes > MAX_STRING_BYTES || state.bytes + bytes > MAX_TOTAL_BYTES) return undefined
  state.bytes += bytes
  return value
}

export const parseOptionalPublicString = (
  record: Record<string, unknown>,
  key: string,
  state: PublicParseState
) => {
  const value = getPublicValue(record, key)
  return value == null ? undefined : parsePublicString(value, state)
}

export const parsePublicStringList = (
  value: unknown,
  state: PublicParseState,
  maximum = MAX_ITEMS
) => {
  if (value == null || typeof value !== 'object') return undefined
  if (!Array.isArray(value) || value.length > maximum) return undefined
  const result: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) return undefined
    const parsed = parsePublicString(descriptor.value, state)
    if (parsed == null) return undefined
    result.push(parsed)
  }
  return result
}

export const parsePublicArray = (
  value: unknown,
  state: PublicParseState,
  maximum: number
) => {
  if (value == null || typeof value !== 'object') return undefined
  if (!Array.isArray(value) || value.length > maximum) return undefined
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) return undefined
    result.push(descriptor.value)
  }
  return result
}
