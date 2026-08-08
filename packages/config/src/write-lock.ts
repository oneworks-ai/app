import { realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

const resolveCanonicalWriteTarget = async (configPath: string) => {
  try {
    return await realpath(configPath)
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }

  const missingSegments = [basename(configPath)]
  let parentPath = dirname(configPath)
  while (true) {
    try {
      return resolve(await realpath(parentPath), ...missingSegments)
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      const nextParent = dirname(parentPath)
      if (nextParent === parentPath) throw error
      missingSegments.unshift(basename(parentPath))
      parentPath = nextParent
    }
  }
}

export const withCanonicalConfigWriteLock = async <T>(
  configPath: string,
  callback: (targetPath: string) => Promise<T>
) => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const targetPath = await resolveCanonicalWriteTarget(configPath)
    const result = await withDirectoryInstallLock({
      lockDir: `${targetPath}.oneworks-write-lock`
    }, async () => {
      const lockedTargetPath = await resolveCanonicalWriteTarget(configPath)
      return lockedTargetPath === targetPath
        ? { retry: false as const, value: await callback(targetPath) }
        : { retry: true as const }
    })
    if (!result.retry) return result.value
  }
  throw new Error(`Config write target changed repeatedly while waiting for its lock: ${configPath}`)
}
