import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const readDirectories = async (directory: string) => {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const findGrokSession = async (grokHome: string, sessionId: string) => {
  const sessionsRoot = resolve(grokHome, 'sessions')
  for (const projectDirName of await readDirectories(sessionsRoot)) {
    const sessionDir = resolve(sessionsRoot, projectDirName, sessionId)
    if ((await readDirectories(resolve(sessionDir, '..'))).includes(sessionId)) {
      return { projectDirName, sessionDir }
    }
  }
  return undefined
}

const resolveLegacyProjectHomes = async (params: {
  cacheRoot: string
  sessionId: string
}) => {
  const homes: string[] = []
  for (const ctxId of await readDirectories(params.cacheRoot)) {
    if (ctxId === 'adapter-grok') continue
    homes.push(resolve(params.cacheRoot, ctxId, params.sessionId, 'adapter-grok', 'home'))
  }
  return homes
}

export const migrateGrokSession = async (params: {
  cacheRoot: string
  currentGrokHome: string
  realGrokHome: string
  sessionId: string
}) => {
  if (await findGrokSession(params.currentGrokHome, params.sessionId) != null) return false

  const legacyHomes = await resolveLegacyProjectHomes(params)
  for (const sourceHome of [params.realGrokHome, ...legacyHomes]) {
    if (resolve(sourceHome) === resolve(params.currentGrokHome)) continue
    const source = await findGrokSession(sourceHome, params.sessionId)
    if (source == null) continue
    const targetDir = resolve(
      params.currentGrokHome,
      'sessions',
      source.projectDirName,
      params.sessionId
    )
    await mkdir(dirname(targetDir), { recursive: true })
    await cp(source.sessionDir, targetDir, { recursive: true, errorOnExist: false })
    return true
  }
  return false
}
