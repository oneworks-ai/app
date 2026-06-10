import path from 'node:path'

const parseFsAllowEnv = (raw: string | undefined) => {
  const value = raw?.trim()
  if (value == null || value === '') return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    }
  } catch {}
  return value.split(path.delimiter).filter(item => item.trim() !== '')
}

const normalizeFsAllowPath = (value: string | undefined) =>
  value == null || value.trim() === ''
    ? undefined
    : path.resolve(value.trim())

export const resolveDevServerFsAllow = (repoRoot: string, env: NodeJS.ProcessEnv) => {
  const realHome = env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim()
  return Array.from(
    new Set(
      [
        repoRoot,
        normalizeFsAllowPath(env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__),
        normalizeFsAllowPath(env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__),
        realHome == null || realHome === '' ? undefined : path.join(realHome, '.oneworks'),
        ...parseFsAllowEnv(env.__ONEWORKS_PROJECT_CLIENT_FS_ALLOW__).map(normalizeFsAllowPath)
      ].filter((value): value is string => value != null)
    )
  )
}
