import type { ConfigSource } from '@oneworks/core'
import type { ConfigResponse, ConfigSchemaResponse } from '@oneworks/types'

import { fetchApiJson, fetchApiJsonOrThrow, jsonHeaders } from './base'
import type { ApiOkResponse } from './types'

export async function getConfig(): Promise<ConfigResponse> {
  return fetchApiJson<ConfigResponse>('/api/config')
}

export async function getConfigSchema(): Promise<ConfigSchemaResponse> {
  return fetchApiJson<ConfigSchemaResponse>('/api/config/schema')
}

export async function updateConfig(
  source: ConfigSource,
  section: string,
  value: unknown,
  options: { unsetPaths?: string[][] } = {}
): Promise<ApiOkResponse> {
  return fetchApiJsonOrThrow<ApiOkResponse>(
    '/api/config',
    {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ source, section, value, unsetPaths: options.unsetPaths })
    },
    '[api] update config failed:'
  )
}
