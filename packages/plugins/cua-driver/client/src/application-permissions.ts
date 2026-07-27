export const applicationPermissionModes = new Set(['always_allow', 'always_ask', 'deny'])
export const applicationBundleIdPattern = /^[a-z0-9][a-z0-9.-]{2,254}$/i
const applicationPermissionPriority: Record<string, number> = {
  always_allow: 0,
  always_ask: 1,
  deny: 2
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const normalizeApplicationPermissionMode = (value: unknown, fallback = 'always_ask') => (
  applicationPermissionModes.has(value as string) ? value as string : fallback
)

export const normalizeApplicationRulesForView = (value: unknown) => {
  if (!Array.isArray(value)) return []
  const rulesByBundleId = new Map<string, { bundleId: string; mode: string; name?: string }>()
  const rules: Array<{ bundleId: string; mode: string; name?: string }> = []
  for (const entry of value) {
    if (
      !isObject(entry) ||
      typeof entry.bundleId !== 'string' ||
      !applicationBundleIdPattern.test(entry.bundleId.trim())
    ) continue
    const bundleId = entry.bundleId.trim()
    const key = bundleId.toLocaleLowerCase('en-US')
    const mode = normalizeApplicationPermissionMode(entry.mode)
    const existing = rulesByBundleId.get(key)
    if (existing != null) {
      if (
        applicationPermissionPriority[mode]! >
          applicationPermissionPriority[existing.mode]!
      ) existing.mode = mode
      continue
    }
    if (rules.length >= 200) continue
    const rule = {
      bundleId,
      ...(typeof entry.name === 'string' && entry.name.trim() !== '' ? { name: entry.name.trim() } : {}),
      mode
    }
    rulesByBundleId.set(key, rule)
    rules.push(rule)
  }
  return rules
}
