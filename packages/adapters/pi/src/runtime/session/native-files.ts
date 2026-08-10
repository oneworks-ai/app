/* eslint-disable max-lines -- native auth and config snapshot lifecycle stays together. */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import lockfile from 'proper-lockfile'

import { asRecord, sanitizePiNativeAuth, sanitizePiNativeModels, sanitizePiNativeSettings } from './native-sanitize'

export { sanitizePiNativeAuth, sanitizePiNativeModels, sanitizePiNativeSettings } from './native-sanitize'

const AUTH_SOURCE_METADATA_FILENAME = '.oneworks-auth-source.json'
const PI_AUTH_LOCK_DEADLINE_MS = 30_000

const waitFor = async (milliseconds: number) => await new Promise(resolve => setTimeout(resolve, milliseconds))

const withPiAuthLock = async <Result>(
  authPath: string,
  options: { hardenParent: boolean },
  callback: () => Promise<Result>
) => {
  if (options.hardenParent) {
    await mkdir(dirname(authPath), { recursive: true, mode: 0o700 })
    await chmod(dirname(authPath), 0o700)
  }
  const deadline = Date.now() + PI_AUTH_LOCK_DEADLINE_MS
  let retryDelay = 50
  let release: (() => Promise<void>) | undefined
  while (release == null) {
    try {
      release = await lockfile.lock(authPath, { realpath: false, retries: 0, stale: PI_AUTH_LOCK_DEADLINE_MS })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ELOCKED' || Date.now() >= deadline) throw error
      const remaining = deadline - Date.now()
      const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(retryDelay / 4)))
      await waitFor(Math.min(retryDelay + jitter, remaining))
      retryDelay = Math.min(retryDelay * 2, 2_000)
    }
  }
  try {
    return await callback()
  } finally {
    await release()
  }
}

const readJsonRecord = async (path: string) => {
  try {
    const record = asRecord(JSON.parse(await readFile(path, 'utf8')) as unknown)
    if (record == null) throw new Error('expected an object')
    return record
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`Invalid Pi native JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const readAuthSourceMetadata = async (path: string) => {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value = JSON.parse(content) as unknown
  const metadata = asRecord(value)
  if (
    metadata == null ||
    (metadata.sourceDigest !== null && typeof metadata.sourceDigest !== 'string')
  ) {
    throw new Error('Invalid Pi auth source metadata.')
  }
  return metadata as { sourceDigest: string | null }
}

export const writePiPrivateFile = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, path)
    await chmod(path, 0o600)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

const removeOptionalFile = (path: string) => rm(path, { force: true })

const readOptionalFile = async (path: string) => {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const hasRegularPrivateFile = async (path: string) => {
  try {
    const fileStat = await lstat(path)
    if (fileStat.isFile() && !fileStat.isSymbolicLink()) {
      await chmod(path, 0o600)
      return true
    }
    await removeOptionalFile(path)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

const readLockedAuthSource = async (sourcePath: string, targetPath: string) => {
  if (resolve(sourcePath) === resolve(targetPath)) return await readOptionalFile(sourcePath)
  try {
    await lstat(sourcePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return await withPiAuthLock(sourcePath, { hardenParent: false }, async () => await readOptionalFile(sourcePath))
}

const sanitizeAuthContent = (content: string) => {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch (error) {
    throw new Error(`Invalid Pi auth.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  const auth = asRecord(parsed)
  if (auth == null) throw new Error('Invalid Pi auth.json: expected an object.')
  const sanitized = sanitizePiNativeAuth(auth)
  return JSON.stringify(auth) === JSON.stringify(sanitized)
    ? content
    : `${JSON.stringify(sanitized, null, 2)}\n`
}

const sanitizePrivateAuth = async (targetPath: string) => {
  if (!(await hasRegularPrivateFile(targetPath))) return false
  const content = await readFile(targetPath, 'utf8')
  const sanitized = sanitizeAuthContent(content)
  if (sanitized !== content) await writePiPrivateFile(targetPath, sanitized)
  return true
}

const syncAuthSnapshot = async (sourcePath: string, targetPath: string, enabled: boolean) => {
  const metadataPath = resolve(dirname(targetPath), AUTH_SOURCE_METADATA_FILENAME)
  if (!enabled) {
    await Promise.all([removeOptionalFile(targetPath), removeOptionalFile(metadataPath)])
    return
  }

  const metadata = await readAuthSourceMetadata(metadataPath)
  const targetExists = await sanitizePrivateAuth(targetPath)
  const source = await readLockedAuthSource(sourcePath, targetPath)
  if (source == null) {
    if (typeof metadata?.sourceDigest === 'string') {
      await removeOptionalFile(targetPath)
    } else {
      await hasRegularPrivateFile(targetPath)
    }
    await writePiPrivateFile(metadataPath, `${JSON.stringify({ sourceDigest: null }, null, 2)}\n`)
    return
  }

  const sourceDigest = createHash('sha256').update(source).digest('hex')
  if (targetExists && metadata?.sourceDigest === sourceDigest) return
  if (targetExists && metadata?.sourceDigest === undefined) {
    await writePiPrivateFile(metadataPath, `${JSON.stringify({ sourceDigest }, null, 2)}\n`)
    return
  }

  await writePiPrivateFile(targetPath, sanitizeAuthContent(source))
  await writePiPrivateFile(metadataPath, `${JSON.stringify({ sourceDigest }, null, 2)}\n`)
}

export const resolvePiNativeExtensionPaths = async (realAgentDir: string) => {
  const extensionDir = resolve(realAgentDir, 'extensions')
  try {
    return (await stat(extensionDir)).isDirectory() ? [extensionDir] : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const syncSettings = async (params: { agentDir: string; inherit: boolean; realAgentDir: string }) => {
  const targetPath = resolve(params.agentDir, 'settings.json')
  const nativeSettings = params.inherit
    ? await readJsonRecord(resolve(params.realAgentDir, 'settings.json'))
    : undefined
  const settings = nativeSettings == null ? undefined : sanitizePiNativeSettings(nativeSettings)
  if (settings != null && Object.keys(settings).length > 0) {
    await writePiPrivateFile(targetPath, `${JSON.stringify(settings, null, 2)}\n`)
  } else {
    await removeOptionalFile(targetPath)
  }
}

const syncModels = async (params: {
  agentDir: string
  generatedModels?: Record<string, unknown>
  inherit: boolean
  realAgentDir: string
}) => {
  const targetPath = resolve(params.agentDir, 'models.json')
  const nativeModelsSource = params.inherit
    ? await readJsonRecord(resolve(params.realAgentDir, 'models.json'))
    : undefined
  const nativeModels = nativeModelsSource == null ? undefined : sanitizePiNativeModels(nativeModelsSource)
  const nativeProviders = asRecord(nativeModels?.providers)
  const generatedProviders = asRecord(params.generatedModels?.providers)
  const modelsConfig = nativeModels == null && generatedProviders == null
    ? undefined
    : {
      ...(nativeModels ?? {}),
      providers: { ...(nativeProviders ?? {}), ...(generatedProviders ?? {}) }
    }
  if (modelsConfig == null) {
    await removeOptionalFile(targetPath)
  } else {
    await writePiPrivateFile(targetPath, `${JSON.stringify(modelsConfig, null, 2)}\n`)
  }
}

export const preparePiNativeFiles = async (params: {
  agentDir: string
  generatedModels?: Record<string, unknown>
  inheritAuth: boolean
  inheritNativeModels: boolean
  inheritNativeSettings: boolean
  realAgentDir: string
}) => {
  const authPath = resolve(params.agentDir, 'auth.json')
  await withPiAuthLock(authPath, { hardenParent: true }, async () => {
    await syncAuthSnapshot(resolve(params.realAgentDir, 'auth.json'), authPath, params.inheritAuth)
    await syncSettings({
      agentDir: params.agentDir,
      inherit: params.inheritNativeSettings,
      realAgentDir: params.realAgentDir
    })
    await syncModels({
      agentDir: params.agentDir,
      generatedModels: params.generatedModels,
      inherit: params.inheritNativeModels,
      realAgentDir: params.realAgentDir
    })
  })
}
