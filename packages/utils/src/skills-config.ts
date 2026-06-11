/* eslint-disable max-lines -- skills config normalization keeps schema variants and duplicate checks together. */
import type {
  Config,
  ConfiguredSkillInstallConfig,
  ConfiguredSkillRegistry,
  ObjectSkillsConfig,
  SkillHomeBridgeConfig,
  SkillsMetaConfig
} from '@oneworks/types'

import { normalizeProjectSkillInstall } from './project-skills/normalize'
import { toSkillSlug } from './skills-cli'

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeConfiguredSkillRegistry = (
  value: ConfiguredSkillRegistry
): ConfiguredSkillRegistry | undefined => {
  const source = normalizeNonEmptyString(value.source)
  if (source == null) return undefined

  const title = normalizeNonEmptyString(value.title)
  const description = normalizeNonEmptyString(value.description)
  const registry = normalizeNonEmptyString(value.registry)
  const publishGroup = normalizeNonEmptyString(value.publish?.group)
  const publishRegion = normalizeNonEmptyString(value.publish?.region)
  const publishAccess = normalizeNonEmptyString(value.publish?.access)

  return {
    source,
    ...(title == null ? {} : { title }),
    ...(description == null ? {} : { description }),
    ...(registry == null ? {} : { registry }),
    ...(
      publishGroup == null &&
        publishRegion == null &&
        publishAccess == null
        ? {}
        : {
          publish: {
            ...(publishGroup == null ? {} : { group: publishGroup }),
            ...(publishRegion == null ? {} : { region: publishRegion }),
            ...(publishAccess == null ? {} : { access: publishAccess })
          }
        }
    )
  }
}

export const isObjectSkillsConfig = (value: Config['skills'] | undefined): value is ObjectSkillsConfig => (
  value != null &&
  !Array.isArray(value) &&
  typeof value === 'object'
)

export const resolveConfiguredSkillInstalls = (
  skills: Config['skills'] | undefined
): Array<string | ConfiguredSkillInstallConfig> => (
  Array.isArray(skills) ? skills : (skills?.items ?? skills?.install ?? [])
)

export const resolveSkillsRegistry = (
  skills: Config['skills'] | undefined
) => (
  isObjectSkillsConfig(skills) ? normalizeNonEmptyString(skills.registry) : undefined
)

const normalizeStringList = (values: string[] | undefined) => {
  const normalized = (values ?? [])
    .map(normalizeNonEmptyString)
    .filter((value): value is string => value != null)

  return normalized.length === 0 ? undefined : Array.from(new Set(normalized))
}

export const resolveSkillsMeta = (
  config: Config | undefined
): SkillsMetaConfig | undefined => {
  const meta = config?.skillsMeta
  if (meta == null) return undefined

  const registries = normalizeStringList(meta.registries)
  const sources = normalizeStringList(meta.sources)
  const homeBridge = meta.homeBridge

  if (
    meta.bundled == null &&
    registries == null &&
    sources == null &&
    homeBridge == null
  ) {
    return undefined
  }

  return {
    ...(meta.bundled == null ? {} : { bundled: meta.bundled }),
    ...(registries == null ? {} : { registries }),
    ...(sources == null ? {} : { sources }),
    ...(homeBridge == null ? {} : { homeBridge })
  }
}

export const mergeSkillsMeta = (
  left: Config | undefined,
  right: Config | undefined
): SkillsMetaConfig | undefined => {
  const leftMeta = resolveSkillsMeta(left)
  const rightMeta = resolveSkillsMeta(right)
  if (leftMeta == null && rightMeta == null) return undefined

  return {
    ...(leftMeta ?? {}),
    ...(rightMeta ?? {}),
    registries: normalizeStringList([
      ...(leftMeta?.registries ?? []),
      ...(rightMeta?.registries ?? [])
    ]),
    sources: normalizeStringList([
      ...(leftMeta?.sources ?? []),
      ...(rightMeta?.sources ?? [])
    ]),
    homeBridge: mergeSkillHomeBridge(leftMeta?.homeBridge, rightMeta?.homeBridge)
  }
}

export const resolveSkillsHomeBridge = (
  config: Config | undefined
): SkillHomeBridgeConfig | undefined => (
  config?.skillsMeta?.homeBridge ??
    (isObjectSkillsConfig(config?.skills) ? config.skills.homeBridge : undefined)
)

export const resolveConfiguredSkillRegistries = (
  config: Config | undefined
): ConfiguredSkillRegistry[] => (
  (config?.skillRegistries ?? [])
    .map(normalizeConfiguredSkillRegistry)
    .filter((entry): entry is ConfiguredSkillRegistry => entry != null)
)

export const mergeConfiguredSkillRegistries = (
  left: Config | undefined,
  right: Config | undefined
) => {
  const merged = new Map<string, ConfiguredSkillRegistry>()

  for (const entry of resolveConfiguredSkillRegistries(left)) {
    merged.set(entry.source, entry)
  }
  for (const entry of resolveConfiguredSkillRegistries(right)) {
    const previous = merged.get(entry.source)
    merged.set(entry.source, previous == null ? entry : { ...previous, ...entry })
  }

  return merged.size > 0 ? Array.from(merged.values()) : undefined
}

export const mergeSkillHomeBridge = (
  left?: SkillHomeBridgeConfig,
  right?: SkillHomeBridgeConfig
) => {
  if (left == null && right == null) return undefined

  const merged = {
    ...(left ?? {}),
    ...(right ?? {})
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export const buildSkillsConfigValue = (params: {
  items: Array<string | ConfiguredSkillInstallConfig>
  current?: Config['skills']
}) => {
  const items = params.items.length > 0 ? params.items : undefined
  const registry = resolveSkillsRegistry(params.current)
  const homeBridge = isObjectSkillsConfig(params.current) ? params.current.homeBridge : undefined

  if (
    registry == null &&
    homeBridge == null
  ) {
    return items
  }

  return {
    ...(items == null ? {} : { items }),
    ...(registry == null ? {} : { registry }),
    ...(homeBridge == null ? {} : { homeBridge })
  }
}

export const isSameDeclaredSkill = (
  left: string | ConfiguredSkillInstallConfig,
  right: string | ConfiguredSkillInstallConfig
) => {
  const normalizedLeft = normalizeProjectSkillInstall(left)
  const normalizedRight = normalizeProjectSkillInstall(right)

  if (normalizedLeft != null && normalizedRight != null) {
    return normalizedLeft.ref === normalizedRight.ref &&
      normalizedLeft.targetName === normalizedRight.targetName &&
      normalizedLeft.rename === normalizedRight.rename &&
      normalizedLeft.source === normalizedRight.source &&
      normalizedLeft.registry === normalizedRight.registry &&
      normalizedLeft.version === normalizedRight.version
  }

  return left === right
}

export const matchesDeclaredSkillSelector = (
  selector: string,
  value: string | ConfiguredSkillInstallConfig
) => {
  const normalized = normalizeProjectSkillInstall(value)
  if (normalized == null) return false

  const trimmedSelector = selector.trim()
  const selectorSlug = toSkillSlug(trimmedSelector)
  return (
    trimmedSelector === normalized.ref ||
    trimmedSelector === normalized.name ||
    trimmedSelector === normalized.targetName ||
    trimmedSelector === normalized.targetDirName ||
    selectorSlug === normalized.targetDirName ||
    selectorSlug === toSkillSlug(normalized.name) ||
    selectorSlug === toSkillSlug(normalized.targetName)
  )
}
