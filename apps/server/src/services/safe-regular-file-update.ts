import { constants } from 'node:fs'
import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { platform } from 'node:process'

export interface VerifiedRegularFileOpenOptions {
  expectedParent?: VerifiedDirectoryIdentity
  mode?: number
  mustCreate?: boolean
  noFollowFlag?: number
}

export interface VerifiedDirectoryIdentity {
  canonicalPath: string
  dev: number
  ino: number
}

const unsafeFileError = (path: string) => (
  new Error(`Unsafe regular file update path: ${path}`)
)

const lstatIfExists = async (path: string) => {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const isSafeRegularFile = (fileStat: Stats) => (
  fileStat.isFile() && !fileStat.isSymbolicLink()
)

const isSameFile = (left: Stats, right: Stats) => (
  left.dev === right.dev && left.ino === right.ino
)

export const captureVerifiedDirectoryIdentity = async (
  path: string
): Promise<VerifiedDirectoryIdentity> => {
  const directoryStat = await lstat(path)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw unsafeFileError(path)
  }
  return {
    canonicalPath: await realpath(path),
    dev: directoryStat.dev,
    ino: directoryStat.ino
  }
}

export const assertVerifiedDirectoryIdentity = async (
  path: string,
  expected: VerifiedDirectoryIdentity
) => {
  const current = await captureVerifiedDirectoryIdentity(path)
  if (
    current.canonicalPath !== expected.canonicalPath ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw unsafeFileError(path)
  }
  return current
}

const normalizeComparablePath = (path: string) => {
  const normalized = resolve(path)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Opens an existing regular file, or exclusively creates a new one, without
 * relying on O_NOFOLLOW for link safety. No caller-visible write occurs until
 * the pre-open and post-open identities have both been verified.
 */
export const openVerifiedRegularFileForUpdate = async (
  path: string,
  options: VerifiedRegularFileOpenOptions = {}
): Promise<FileHandle> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.expectedParent != null) {
      await assertVerifiedDirectoryIdentity(dirname(path), options.expectedParent)
    }
    const before = await lstatIfExists(path)
    if (before != null && (options.mustCreate === true || !isSafeRegularFile(before))) {
      throw unsafeFileError(path)
    }

    const creating = options.mustCreate === true || before == null
    const noFollowFlag = options.noFollowFlag ?? constants.O_NOFOLLOW ?? 0
    const flags = constants.O_APPEND |
      constants.O_RDWR |
      noFollowFlag |
      (creating ? constants.O_CREAT | constants.O_EXCL : 0)
    let handle: FileHandle
    try {
      handle = await open(path, flags, options.mode ?? 0o666)
    } catch (error) {
      if (
        options.mustCreate !== true &&
        before == null &&
        (error as NodeJS.ErrnoException).code === 'EEXIST' &&
        attempt === 0
      ) {
        continue
      }
      if (creating && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw unsafeFileError(path)
      }
      throw error
    }

    try {
      const [after, handleStat, canonicalPath, canonicalParent] = await Promise.all([
        lstat(path),
        handle.stat(),
        realpath(path),
        realpath(dirname(path))
      ])
      if (options.expectedParent != null) {
        await assertVerifiedDirectoryIdentity(dirname(path), options.expectedParent)
      }
      const expectedCanonicalPath = join(canonicalParent, basename(path))
      if (
        !isSafeRegularFile(after) ||
        !handleStat.isFile() ||
        !isSameFile(after, handleStat) ||
        (before != null && !isSameFile(before, handleStat)) ||
        (options.mustCreate === true && handleStat.nlink !== 1) ||
        normalizeComparablePath(canonicalPath) !== normalizeComparablePath(expectedCanonicalPath)
      ) {
        throw unsafeFileError(path)
      }
      return handle
    } catch (error) {
      await handle.close().catch(() => undefined)
      throw error
    }
  }
  throw unsafeFileError(path)
}
