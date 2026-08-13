import { describe, expect, it } from 'vitest'

import { DROID_SUPPORTED_EFFORTS, adapterConfigContribution, droidEffortSchema } from '../src/config-schema'
import { builtinModels } from '../src/models'

describe('factory Droid effort capabilities', () => {
  it('publishes the pinned native effort set to config and model selectors', () => {
    expect(DROID_SUPPORTED_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(builtinModels[0]?.supportedEfforts).toEqual(DROID_SUPPORTED_EFFORTS)
    for (const effort of DROID_SUPPORTED_EFFORTS) {
      expect(droidEffortSchema.safeParse(effort).success).toBe(true)
    }
    expect(droidEffortSchema.safeParse('ultra').success).toBe(false)
  })

  it('publishes adapter-scoped UI metadata for every visible Droid field', () => {
    expect(adapterConfigContribution.capabilities).toEqual({ accounts: false })
    expect(adapterConfigContribution.uiSchema?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['cli'], label: 'Factory Droid CLI' }),
      expect.objectContaining({
        path: ['effort'],
        label: 'Reasoning effort',
        options: DROID_SUPPORTED_EFFORTS.map(value => ({ label: value, value }))
      }),
      expect.objectContaining({ path: ['configContent'], label: 'Factory settings override' }),
      expect.objectContaining({ path: ['disableBuiltinSkills'], label: 'Disable built-in skills' })
    ]))
  })
})
