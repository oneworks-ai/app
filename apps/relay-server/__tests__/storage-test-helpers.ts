import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const createStorageTestContext = () => {
  const tempDirs: string[] = []
  return {
    cleanup: async () => {
      await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    },
    createTempDataPath: async (filename = 'store.json') => {
      const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-storage-test-'))
      tempDirs.push(root)
      return join(root, 'relay', filename)
    }
  }
}

export const readPersistenceText = async (dataPath: string) => {
  const paths = [dataPath, `${dataPath}-wal`, `${dataPath}-shm`, `${dataPath}-journal`]
  const buffers = await Promise.all(paths.map(async path => {
    try {
      return await readFile(path)
    } catch {
      return Buffer.alloc(0)
    }
  }))
  return buffers.map(buffer => buffer.toString('latin1')).join('\n')
}
