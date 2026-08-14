import type { EffortLevel } from '@oneworks/types'

/** Values advertised by Junie CLI 26.8.10 (2651.4) for `--effort`. */
export const JUNIE_SUPPORTED_EFFORTS = ['low', 'medium', 'high'] as const satisfies readonly EffortLevel[]

export type JunieEffort = typeof JUNIE_SUPPORTED_EFFORTS[number]

export const isJunieEffort = (value: unknown): value is JunieEffort => (
  typeof value === 'string' && (JUNIE_SUPPORTED_EFFORTS as readonly string[]).includes(value)
)

export function assertJunieEffort(value: unknown): asserts value is JunieEffort {
  if (!isJunieEffort(value)) {
    throw new Error(
      `Junie CLI 26.8.10 (2651.4) supports only ${JUNIE_SUPPORTED_EFFORTS.join(', ')} effort; received ${
        JSON.stringify(value)
      }.`
    )
  }
}
