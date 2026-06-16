import type { Config } from '@oneworks/types'

const hasOwnKeys = (value: Record<string, unknown>) => Object.keys(value).length > 0

const mergeRecord = <T>(
  left?: Record<string, T>,
  right?: Record<string, T>
) => {
  if (left == null && right == null) return undefined

  return {
    ...(left ?? {}),
    ...(right ?? {})
  }
}

const mergeVoiceServiceConfig = (
  left?: Record<string, unknown>,
  right?: Record<string, unknown>
) => {
  if (left == null && right == null) return undefined

  const leftRequest = left?.request as Record<string, unknown> | undefined
  const rightRequest = right?.request as Record<string, unknown> | undefined
  const leftBody = leftRequest?.body as Record<string, unknown> | undefined
  const rightBody = rightRequest?.body as Record<string, unknown> | undefined

  return {
    ...(left ?? {}),
    ...(right ?? {}),
    capabilities: mergeRecord(
      left?.capabilities as Record<string, unknown> | undefined,
      right?.capabilities as Record<string, unknown> | undefined
    ),
    request: leftRequest == null && rightRequest == null
      ? undefined
      : {
        ...(leftRequest ?? {}),
        ...(rightRequest ?? {}),
        headers: mergeRecord(
          leftRequest?.headers as Record<string, string> | undefined,
          rightRequest?.headers as Record<string, string> | undefined
        ),
        body: leftBody == null && rightBody == null
          ? undefined
          : {
            ...(leftBody ?? {}),
            ...(rightBody ?? {}),
            fields: mergeRecord(
              leftBody?.fields as Record<string, unknown> | undefined,
              rightBody?.fields as Record<string, unknown> | undefined
            )
          }
      },
    response: mergeRecord(
      left?.response as Record<string, unknown> | undefined,
      right?.response as Record<string, unknown> | undefined
    )
  }
}

const mergeVoiceServices = (
  left?: NonNullable<NonNullable<Config['voice']>['speechToText']>['services'],
  right?: NonNullable<NonNullable<Config['voice']>['speechToText']>['services']
) => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {})
  ])

  if (keys.size === 0) return undefined

  return Object.fromEntries(
    Array.from(keys).map((key) => [
      key,
      mergeVoiceServiceConfig(
        (left as Record<string, Record<string, unknown>> | undefined)?.[key],
        (right as Record<string, Record<string, unknown>> | undefined)?.[key]
      )
    ])
  ) as NonNullable<NonNullable<Config['voice']>['speechToText']>['services']
}

export const mergeVoice = (
  left?: Config['voice'],
  right?: Config['voice']
) => {
  if (left == null && right == null) return undefined

  const merged: NonNullable<Config['voice']> = {
    ...(left ?? {}),
    ...(right ?? {}),
    speechToText: left?.speechToText == null && right?.speechToText == null
      ? undefined
      : {
        ...(left?.speechToText ?? {}),
        ...(right?.speechToText ?? {}),
        services: mergeVoiceServices(left?.speechToText?.services, right?.speechToText?.services)
      }
  }

  return hasOwnKeys(merged as Record<string, unknown>) ? merged : undefined
}
