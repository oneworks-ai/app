import type { AdapterOutputEvent } from '@oneworks/types'
import {
  REDACTED_CREDENTIAL_VALUE,
  collectCredentialRedactionContext,
  createCredentialValueVariants,
  createCredentialVariants,
  isCredentialBearingValue,
  isCredentialGraphSensitiveEntry,
  redactContextualCredentialAssignmentsInString,
  redactCredentialAssignmentsInString,
  redactCredentialVariantsInString,
  resolveCredentialGraphChildContext
} from '@oneworks/utils'
import type { CredentialGraphContext } from '@oneworks/utils'

const REDACTED = REDACTED_CREDENTIAL_VALUE

export const createQwenRuntimeRedactor = (params: {
  env: Record<string, string | null | undefined>
  additionalValues?: unknown[]
  qwenHome?: string
  runtimeDir?: string
}) => {
  const credentialContext = collectCredentialRedactionContext([
    params.env,
    ...params.additionalValues ?? []
  ])
  const secretValues = credentialContext.values
  for (const value of Object.values(params.env)) {
    if (typeof value === 'string' && value !== '' && isCredentialBearingValue(value)) {
      secretValues.add(value)
    }
  }
  const secretVariants = createCredentialVariants(secretValues)
  const privatePaths = [
    [params.runtimeDir, '[QWEN_RUNTIME_DIR]'],
    [params.qwenHome, '[QWEN_HOME]']
  ]
    .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && entry[0] !== '')
    .sort(([left], [right]) => right.length - left.length)

  const string = (input: string) => {
    let output = redactCredentialVariantsInString(input, secretVariants)
    output = redactCredentialAssignmentsInString(output)
    output = redactContextualCredentialAssignmentsInString(
      output,
      credentialContext.textAssignments
    )
    for (const [privatePath, label] of privatePaths) {
      for (const variant of createCredentialValueVariants(privatePath)) {
        output = output.split(variant).join(label)
      }
    }
    return output
  }
  const unknown = (
    input: unknown,
    context: CredentialGraphContext = 'normal'
  ): unknown => {
    if (typeof input === 'string') return string(input)
    if (Array.isArray(input)) return input.map(item => unknown(item, context))
    if (input != null && typeof input === 'object') {
      if (input instanceof Error) return { message: string(input.message), name: input.name }
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          isCredentialGraphSensitiveEntry(key, context)
            ? REDACTED
            : unknown(value, resolveCredentialGraphChildContext(key, context))
        ])
      )
    }
    return input
  }

  return {
    event: (event: AdapterOutputEvent) => unknown(event) as AdapterOutputEvent,
    string,
    unknown
  }
}
