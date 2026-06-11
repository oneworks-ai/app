import type { Config } from '@oneworks/types'
import {
  isObjectSkillsConfig,
  mergeSkillHomeBridge,
  resolveConfiguredSkillInstalls,
  resolveSkillsRegistry
} from '@oneworks/utils'

const mergeList = <T>(
  left?: T[],
  right?: T[]
) => {
  if (left == null && right == null) return undefined
  return [
    ...(left ?? []),
    ...(right ?? [])
  ]
}

const mergeOptionalList = <T>(
  left?: T[],
  right?: T[]
) => {
  const merged = mergeList(left, right)
  return merged == null || merged.length === 0 ? undefined : merged
}

const mergeSkillRegistry = (
  left?: Config['skills'],
  right?: Config['skills']
) => {
  const leftRegistry = resolveSkillsRegistry(left)
  const rightRegistry = resolveSkillsRegistry(right)
  if (leftRegistry == null && rightRegistry == null) return undefined
  if (leftRegistry == null) return rightRegistry
  if (rightRegistry == null) return leftRegistry
  return rightRegistry
}

export const mergeSkills = (
  left?: Config['skills'],
  right?: Config['skills']
) => {
  const installs = mergeOptionalList(
    resolveConfiguredSkillInstalls(left),
    resolveConfiguredSkillInstalls(right)
  )
  const registry = mergeSkillRegistry(left, right)
  const homeBridge = mergeSkillHomeBridge(
    isObjectSkillsConfig(left) ? left.homeBridge : undefined,
    isObjectSkillsConfig(right) ? right.homeBridge : undefined
  )

  if (
    registry == null &&
    homeBridge == null
  ) {
    return installs
  }

  return {
    ...(installs == null ? {} : { items: installs }),
    ...(registry == null ? {} : { registry }),
    ...(homeBridge == null ? {} : { homeBridge })
  }
}
