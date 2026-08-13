import { createHash } from 'node:crypto'
import { lstat, readlink, realpath } from 'node:fs/promises'
import { dirname, posix, resolve, win32 } from 'node:path'

const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

const hasControlCharacter = (value: string) => (
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
)

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

const isPortableSafeLeaf = (value: string) => (
  value !== '' &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !value.includes(':') &&
  !hasControlCharacter(value) &&
  !/[. ]$/u.test(value) &&
  !WINDOWS_DEVICE_NAME_PATTERN.test(value)
)

export const encodeKiroOverlayLeaf = (value: string) => {
  if (isPortableSafeLeaf(value)) return value
  return `encoded-${createHash('sha256').update(value).digest('hex')}`
}

const resolvePlannedSkillName = (targetPath: string) => (
  targetPath.startsWith('skills/') ? targetPath.slice('skills/'.length) : targetPath
)

const isContained = (
  pathApi: Pick<typeof posix, 'isAbsolute' | 'relative' | 'resolve' | 'sep'>,
  rootPath: string,
  targetPath: string
) => {
  const relativePath = pathApi.relative(pathApi.resolve(rootPath), pathApi.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relativePath)
  )
}

export const assertPortableKiroPathContainment = (rootPath: string, targetPath: string) => {
  if (!isContained(posix, rootPath, targetPath) || !isContained(win32, rootPath, targetPath)) {
    throw new Error(`Kiro managed asset path escaped its isolated root: ${JSON.stringify(targetPath)}.`)
  }
}

export const resolveKiroSkillOverlayTarget = (skillsRoot: string, plannedTargetPath: string) => {
  const leaf = encodeKiroOverlayLeaf(resolvePlannedSkillName(plannedTargetPath))
  const targetPath = resolve(skillsRoot, leaf)
  assertPortableKiroPathContainment(skillsRoot, targetPath)
  if (dirname(targetPath) !== resolve(skillsRoot)) {
    throw new Error(
      `Kiro skill overlay target is not a direct child of its isolated root: ${JSON.stringify(targetPath)}.`
    )
  }
  return targetPath
}

const assertExistingDirectoryIsNotSymlink = async (targetPath: string, label: string) => {
  try {
    const metadata = await lstat(targetPath)
    if (metadata.isSymbolicLink()) {
      const destination = resolve(dirname(targetPath), await readlink(targetPath))
      throw new Error(`${label} must not be a symlink (resolved destination: ${JSON.stringify(destination)}).`)
    }
    if (!metadata.isDirectory()) throw new Error(`${label} must be a directory.`)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  return true
}

export const assertSafeKiroSkillsRoot = async (kiroHome: string, skillsRoot: string) => {
  assertPortableKiroPathContainment(kiroHome, skillsRoot)
  const homeExists = await assertExistingDirectoryIsNotSymlink(kiroHome, 'Kiro isolated home')
  if (!homeExists) throw new Error('Kiro isolated home must exist before staging skills.')
  const rootExists = await assertExistingDirectoryIsNotSymlink(skillsRoot, 'Kiro isolated skills root')
  if (!rootExists) return

  const realHome = await realpath(kiroHome)
  const realSkillsRoot = await realpath(skillsRoot)
  assertPortableKiroPathContainment(realHome, realSkillsRoot)
}

export const assertSafeKiroOverlayParent = async (skillsRoot: string, targetPath: string) => {
  assertPortableKiroPathContainment(skillsRoot, targetPath)
  const realSkillsRoot = await realpath(skillsRoot)
  const realParent = await realpath(dirname(targetPath))
  assertPortableKiroPathContainment(realSkillsRoot, realParent)
  if (realParent !== realSkillsRoot) {
    throw new Error(`Kiro skill overlay parent escaped its isolated root: ${JSON.stringify(realParent)}.`)
  }
}
