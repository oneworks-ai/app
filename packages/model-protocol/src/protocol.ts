import type { ModelServiceApiProtocol } from '@oneworks/types/model-service-protocol'

export { MODEL_SERVICE_API_PROTOCOLS } from '@oneworks/types/model-service-protocol'
export type { ModelServiceApiProtocol } from '@oneworks/types/model-service-protocol'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue | undefined
}

export class UnsupportedProtocolFeatureError extends Error {
  constructor(feature: string, target?: ModelServiceApiProtocol) {
    super(`Unsupported ${feature}${target ? ` for ${target}` : ''}`)
    this.name = 'UnsupportedProtocolFeatureError'
  }
}

export const isJsonObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const asArray = (value: JsonValue | undefined): JsonValue[] => Array.isArray(value) ? value : []

export const asString = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

export const asNumber = (value: JsonValue | undefined): number | undefined =>
  typeof value === 'number' ? value : undefined
