import { Buffer } from 'node:buffer'

import {
  isCredentialBearingKey,
  isCredentialBearingValue,
  isCredentialHeaderContainerKey,
  redactCredentialAssignmentsInString
} from './credential-redaction'
import { isFilesystemShapedNativeAppValue } from './native-app-metadata'

export type CredentialGraphContext = 'credential' | 'headers' | 'normal'

export interface CredentialTextAssignment {
  key: string
  value: string
}

export interface CredentialRedactionContext {
  textAssignments: CredentialTextAssignment[]
  values: Set<string>
}

const CREDENTIAL_CONTAINER_VALUE_KEY = /^(?:raw|value|values)$/iu

export const isCredentialGraphSensitiveEntry = (
  key: string,
  context: CredentialGraphContext
) => (
  context === 'headers' ||
  isCredentialBearingKey(key) ||
  (context === 'credential' && CREDENTIAL_CONTAINER_VALUE_KEY.test(key))
)

export const resolveCredentialGraphChildContext = (
  key: string,
  context: CredentialGraphContext
): CredentialGraphContext => {
  if (isCredentialHeaderContainerKey(key)) return 'headers'
  return isCredentialGraphSensitiveEntry(key, context) ? 'credential' : 'normal'
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value == null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const collectUrlUserInfo = (value: string, output: Set<string>) => {
  try {
    const url = new URL(value)
    for (const component of [url.username, url.password]) {
      if (component === '') continue
      output.add(component)
      try {
        output.add(decodeURIComponent(component))
      } catch {
        // Keep the URL parser's exact component when percent encoding is malformed.
      }
    }
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

const collectAllStrings = (value: unknown, output: Set<string>, seen = new WeakSet<object>()) => {
  if (typeof value === 'string') {
    if (value !== '') output.add(value)
    return
  }
  if (value == null || typeof value !== 'object' || value instanceof Date) return
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8')
    if (text !== '') output.add(text)
    return
  }
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value) || value instanceof Set) {
    for (const item of value) collectAllStrings(item, output, seen)
    return
  }
  if (value instanceof Map) {
    for (const [key, child] of value) {
      collectAllStrings(key, output, seen)
      collectAllStrings(child, output, seen)
    }
    return
  }
  if (value instanceof Error) {
    collectAllStrings(value.message, output, seen)
    collectAllStrings(value.stack, output, seen)
  }
  for (const child of Object.values(value)) collectAllStrings(child, output, seen)
}

/** Collects literal values plus exact header assignments from supported credential graphs. */
export const collectCredentialRedactionContext = (value: unknown): CredentialRedactionContext => {
  const output = new Set<string>()
  const textAssignments: CredentialTextAssignment[] = []
  const assignmentKeys = new Set<string>()
  const seenByContext: Record<CredentialGraphContext, WeakSet<object>> = {
    credential: new WeakSet<object>(),
    headers: new WeakSet<object>(),
    normal: new WeakSet<object>()
  }

  const visitValue = (current: unknown, context: CredentialGraphContext = 'normal'): void => {
    if (typeof current === 'string') {
      if (context !== 'headers' && collectUrlUserInfo(current, output)) return
      if (
        current !== '' &&
        (
          context === 'headers' ||
          (
            isCredentialBearingValue(current) &&
            !isFilesystemShapedNativeAppValue(current) &&
            redactCredentialAssignmentsInString(current) === current
          )
        )
      ) output.add(current)
      return
    }
    if (
      current == null ||
      typeof current !== 'object' ||
      current instanceof Date ||
      Buffer.isBuffer(current)
    ) return
    const seen = seenByContext[context]
    if (seen.has(current)) return
    seen.add(current)

    const visitEntry = (key: unknown, child: unknown) => {
      if (typeof key !== 'string') {
        visitValue(child, context)
        return
      }
      if (context === 'headers') {
        const headerValues = new Set<string>()
        collectAllStrings(child, headerValues)
        for (const headerValue of headerValues) {
          output.add(headerValue)
          const assignmentKey = `${key.toLowerCase()}\0${headerValue}`
          if (!assignmentKeys.has(assignmentKey)) {
            assignmentKeys.add(assignmentKey)
            textAssignments.push({ key, value: headerValue })
          }
        }
        return
      }
      const childContext = resolveCredentialGraphChildContext(key, context)
      if (childContext === 'headers') {
        visitValue(child, childContext)
        return
      }
      const sensitiveKey = isCredentialGraphSensitiveEntry(key, context)
      if (!sensitiveKey) {
        visitValue(child)
        return
      }
      if (isPlainRecord(child)) visitValue(child, 'credential')
      else collectAllStrings(child, output)
    }

    if (Array.isArray(current) || current instanceof Set) {
      for (const item of current) visitValue(item, context)
      return
    }
    if (current instanceof Map) {
      for (const [key, child] of current) visitEntry(key, child)
      return
    }
    for (const [key, child] of Object.entries(current)) visitEntry(key, child)
  }

  visitValue(value)
  return { textAssignments, values: output }
}

/** Backward-compatible value-only view of the centralized credential graph collector. */
export const collectCredentialValues = (value: unknown) => collectCredentialRedactionContext(value).values
