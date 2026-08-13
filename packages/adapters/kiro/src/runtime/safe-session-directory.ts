import { lstat, mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export interface DirectoryIdentity {
  dev: number
  ino: number
  realPath: string
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

const isContained = (rootPath: string, targetPath: string) => {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (
    relation !== '..' &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  )
}

export const assertContained = (rootPath: string, targetPath: string, label: string) => {
  if (!isContained(rootPath, targetPath)) {
    throw new Error(`${label} escaped the Kiro managed session root: ${JSON.stringify(targetPath)}.`)
  }
}

export const readDirectoryIdentity = async (
  targetPath: string,
  label: string
): Promise<DirectoryIdentity> => {
  const metadata = await lstat(targetPath)
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`)
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory.`)
  return {
    dev: metadata.dev,
    ino: metadata.ino,
    realPath: await realpath(targetPath)
  }
}

export const assertSameDirectory = async (
  targetPath: string,
  expected: DirectoryIdentity,
  label: string
) => {
  const current = await readDirectoryIdentity(targetPath, label)
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.realPath !== expected.realPath
  ) {
    throw new Error(`${label} changed during Kiro session staging.`)
  }
  return current
}

const readOptionalMetadata = async (targetPath: string) => {
  try {
    return await lstat(targetPath)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

const getMissingDirectoryChain = async (targetPath: string) => {
  const missing: string[] = []
  let candidate = resolve(targetPath)
  while (await readOptionalMetadata(candidate) == null) {
    missing.push(candidate)
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return { existingAncestor: candidate, missing: missing.reverse() }
}

export const createDirectoryChainSafely = async (targetPath: string, label: string) => {
  const { existingAncestor, missing } = await getMissingDirectoryChain(targetPath)
  let parentIdentity = await readDirectoryIdentity(existingAncestor, `${label} existing ancestor`)
  for (const directory of missing) {
    await assertSameDirectory(dirname(directory), parentIdentity, `${label} parent`)
    await mkdir(directory, { recursive: false })
    await assertSameDirectory(dirname(directory), parentIdentity, `${label} parent`)
    parentIdentity = await readDirectoryIdentity(directory, label)
  }
  return readDirectoryIdentity(targetPath, label)
}

const getContainedSegments = (rootPath: string, targetPath: string, label: string) => {
  assertContained(rootPath, targetPath, label)
  const relation = relative(resolve(rootPath), resolve(targetPath))
  if (relation === '') return []
  return relation.split(sep).filter(Boolean)
}

export const ensureContainedDirectory = async (params: {
  label: string
  rootIdentity: DirectoryIdentity
  rootPath: string
  targetPath: string
}) => {
  const segments = getContainedSegments(params.rootPath, params.targetPath, params.label)
  let parentPath = resolve(params.rootPath)
  let parentIdentity = await assertSameDirectory(params.rootPath, params.rootIdentity, 'Kiro managed cache root')
  for (const segment of segments) {
    const childPath = resolve(parentPath, segment)
    const childMetadata = await readOptionalMetadata(childPath)
    if (childMetadata == null) {
      await assertSameDirectory(parentPath, parentIdentity, `${params.label} parent`)
      await mkdir(childPath, { recursive: false })
      await assertSameDirectory(parentPath, parentIdentity, `${params.label} parent`)
    } else if (childMetadata.isSymbolicLink()) {
      throw new Error(
        `${params.label} must not be a symlink or contain a symlink ancestor: ${JSON.stringify(childPath)}.`
      )
    } else if (!childMetadata.isDirectory()) {
      throw new Error(`${params.label} ancestor must be a directory: ${JSON.stringify(childPath)}.`)
    }
    const childIdentity = await readDirectoryIdentity(childPath, params.label)
    assertContained(params.rootIdentity.realPath, childIdentity.realPath, params.label)
    parentPath = childPath
    parentIdentity = childIdentity
  }
  return parentIdentity
}
