import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export interface PathIdentity {
  dev: number
  ino: number
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}

export const readPathIdentity = async (path: string): Promise<PathIdentity | undefined> => {
  try {
    const pathStat = await lstat(path)
    return {
      dev: pathStat.dev,
      ino: pathStat.ino,
      isDirectory: pathStat.isDirectory(),
      isFile: pathStat.isFile(),
      isSymbolicLink: pathStat.isSymbolicLink()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export const identitiesMatch = (left: PathIdentity, right: PathIdentity) => (
  left.dev === right.dev && left.ino === right.ino
)

export const assertSecureDirectory = async (path: string, label: string) => {
  const identity = await readPathIdentity(path)
  if (identity?.isSymbolicLink === true || (identity != null && !identity.isDirectory)) {
    throw new Error(`${label} must be a real directory and cannot be a symbolic link: ${path}`)
  }
  return identity
}

export const assertCanonicalChildDirectory = async (params: {
  expected?: PathIdentity
  label: string
  parent: string
  path: string
}) => {
  const identity = await assertSecureDirectory(params.path, params.label)
  if (identity == null) return undefined
  if (params.expected != null && !identitiesMatch(params.expected, identity)) {
    throw new Error(`${params.label} changed while it was being updated: ${params.path}`)
  }
  const canonicalPath = await realpath(params.path)
  const relativePath = relative(params.parent, canonicalPath)
  if (
    relativePath === '' ||
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.includes('/') ||
    relativePath.includes('\\')
  ) {
    throw new Error(`${params.label} resolves outside its parent directory: ${params.path}`)
  }
  return { identity, path: canonicalPath }
}

export const ensureCanonicalChildDirectory = async (params: {
  label: string
  name: string
  parent: string
}) => {
  const path = resolve(params.parent, params.name)
  await assertSecureDirectory(path, params.label)
  await mkdir(path, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const result = await assertCanonicalChildDirectory({ ...params, path })
  if (result == null) throw new Error(`Failed to create ${params.label}: ${path}`)
  await chmod(result.path, 0o700)
  return result
}

export const syncDirectory = async (path: string) => {
  let handle
  try {
    handle = await open(path, 'r')
    await handle.sync()
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  } finally {
    await handle?.close()
  }
}

export const ensurePrivateParentDirectories = async (root: string, relativeFilePath: string) => {
  const segments = relativeFilePath.split('/').slice(0, -1)
  let current = root
  for (const segment of segments) {
    const parent = current
    current = resolve(current, segment)
    await mkdir(current, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    const identity = await assertSecureDirectory(current, 'Adapter artifact directory')
    if (identity == null) throw new Error(`Adapter artifact directory is unavailable: ${current}`)
    await chmod(current, 0o700)
    await syncDirectory(parent)
  }
}

export const writePrivateArtifact = async (targetPath: string, content: string) => {
  const handle = await open(targetPath, 'wx', 0o600)
  try {
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.chmod(0o600)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(dirname(targetPath))
}
