import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const createAdapterAccountTestContext = () => {
  const tempDirs: string[] = []
  return {
    cleanup: async () => {
      await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    },
    createTempDir: async (prefix: string) => {
      const dir = await mkdtemp(join(tmpdir(), prefix))
      tempDirs.push(dir)
      return dir
    },
    pathExists: async (targetPath: string) => {
      try {
        await access(targetPath)
        return true
      } catch {
        return false
      }
    }
  }
}
