const isUnsetPath = (value: unknown): value is string[] => (
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(item => typeof item === 'string' && item.trim() !== '')
)

const applyUnsetPath = (value: unknown, path: string[]) => {
  const root = (value != null && typeof value === 'object' && !Array.isArray(value))
    ? { ...(value as Record<string, unknown>) }
    : {}
  let current = root

  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    const existing = current[key]
    const next = (existing != null && typeof existing === 'object' && !Array.isArray(existing))
      ? { ...(existing as Record<string, unknown>) }
      : {}
    current[key] = next
    current = next
  }

  current[path[path.length - 1]] = undefined
  return root
}

export const applyUnsetPaths = (value: unknown, unsetPaths: unknown) => {
  if (!Array.isArray(unsetPaths)) return value
  return unsetPaths
    .filter(isUnsetPath)
    .reduce<unknown>((nextValue, path) => applyUnsetPath(nextValue, path), value)
}
