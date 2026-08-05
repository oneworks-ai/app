import type { PluginRuntimeEndpoint, PublicPluginDiagnostic } from '@oneworks/types'

import { parsePublicRuntimeEndpoint } from './plugin-public-api-contract'
import { parsePublicDiagnostics } from './plugin-public-api-manifest'
import { createPublicParseState, getPublicValue, isPublicRecord } from './plugin-public-api-values'

interface PublicPluginListResponse {
  diagnostics?: PublicPluginDiagnostic[]
  plugins: unknown[]
  runtime?: PluginRuntimeEndpoint
}

const resolvePublicPluginListPayload = (
  value: unknown,
  state: ReturnType<typeof createPublicParseState>
) => {
  if (!isPublicRecord(value, state)) {
    throw new TypeError('Plugin snapshot response must contain a public object wrapper.')
  }
  if (!Object.hasOwn(value, 'success')) return value
  if (getPublicValue(value, 'success') !== true) {
    throw new TypeError('Plugin snapshot response must contain a successful API envelope.')
  }
  const data = getPublicValue(value, 'data')
  if (!isPublicRecord(data, state)) {
    throw new TypeError('Plugin snapshot response must contain public API envelope data.')
  }
  return data
}

export const parsePublicPluginListResponse = (value: unknown): PublicPluginListResponse => {
  const state = createPublicParseState()
  const payload = resolvePublicPluginListPayload(value, state)
  const plugins = getPublicValue(payload, 'plugins')
  if (!Array.isArray(plugins)) {
    throw new TypeError('Plugin snapshot response must contain a plugins array.')
  }
  const result: PublicPluginListResponse = { plugins }
  if (Object.hasOwn(payload, 'diagnostics')) {
    const diagnostics = parsePublicDiagnostics(getPublicValue(payload, 'diagnostics'), state)
    if (diagnostics == null) {
      throw new TypeError('Plugin snapshot response contains malformed diagnostics.')
    }
    result.diagnostics = diagnostics
  }
  if (Object.hasOwn(payload, 'runtime')) {
    const runtime = parsePublicRuntimeEndpoint(getPublicValue(payload, 'runtime'), state)
    if (runtime == null) {
      throw new TypeError('Plugin snapshot response contains malformed runtime metadata.')
    }
    result.runtime = runtime
  }
  return result
}
