import { Buffer } from 'node:buffer'

import { isCredentialLikeNativeAppKey } from '@oneworks/utils'

import { isCredentialShapedValue, isPlainAppMetadataRecord } from './app-metadata-normalization'

const MAX_APP_MANIFEST_DEPTH = 4
const MAX_APP_MANIFEST_ITEMS = 128
const MAX_APP_MANIFEST_NODES = 1024
const MAX_APP_MANIFEST_STRING_BYTES = 16 * 1024
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface AppMetadataShape {
  invalid: boolean
  nodes: number
  secret: boolean
}

export const inspectAppMetadataShape = (
  value: unknown,
  state: AppMetadataShape,
  depth = 0
) => {
  state.nodes += 1
  if (depth > MAX_APP_MANIFEST_DEPTH || state.nodes > MAX_APP_MANIFEST_NODES) {
    state.invalid = true
    return
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_APP_MANIFEST_STRING_BYTES) state.invalid = true
    if (isCredentialShapedValue(value)) state.secret = true
    return
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return
  if (Array.isArray(value)) {
    if (value.length > MAX_APP_MANIFEST_ITEMS) {
      state.invalid = true
      return
    }
    for (const item of value) inspectAppMetadataShape(item, state, depth + 1)
    return
  }
  if (!isPlainAppMetadataRecord(value)) {
    state.invalid = true
    return
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_APP_MANIFEST_ITEMS) {
    state.invalid = true
    return
  }
  for (const [key, item] of entries) {
    if (DANGEROUS_METADATA_KEYS.has(key)) state.invalid = true
    if (isCredentialLikeNativeAppKey(key)) state.secret = true
    inspectAppMetadataShape(item, state, depth + 1)
  }
}
