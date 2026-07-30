import type { PluginRuntimeEndpoint, PublicPluginDiagnostic } from '@oneworks/types'

import { parsePublicRuntimeEndpoint } from './plugin-public-api-contract'
import { parsePublicDiagnostics } from './plugin-public-api-manifest'
import { createPublicParseState, getPublicValue, isPublicRecord } from './plugin-public-api-values'

interface PublicPluginListResponse {
  diagnostics?: PublicPluginDiagnostic[]
  plugins: unknown[]
  runtime?: PluginRuntimeEndpoint
}

export const parsePublicPluginListResponse = (value: unknown): PublicPluginListResponse => {
  const state = createPublicParseState()
  if (!isPublicRecord(value, state)) {
    throw new TypeError('Plugin snapshot response must contain a public object wrapper.')
  }
  const plugins = getPublicValue(value, 'plugins')
  if (!Array.isArray(plugins)) {
    throw new TypeError('Plugin snapshot response must contain a plugins array.')
  }
  const result: PublicPluginListResponse = { plugins }
  if (Object.hasOwn(value, 'diagnostics')) {
    const diagnostics = parsePublicDiagnostics(getPublicValue(value, 'diagnostics'), state)
    if (diagnostics == null) {
      throw new TypeError('Plugin snapshot response contains malformed diagnostics.')
    }
    result.diagnostics = diagnostics
  }
  if (Object.hasOwn(value, 'runtime')) {
    const runtime = parsePublicRuntimeEndpoint(getPublicValue(value, 'runtime'), state)
    if (runtime == null) {
      throw new TypeError('Plugin snapshot response contains malformed runtime metadata.')
    }
    result.runtime = runtime
  }
  return result
}
