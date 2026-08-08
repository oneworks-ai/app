import { lstatSync, readFileSync } from 'node:fs'
import { chmod, open, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readPathIdentity, syncDirectory } from './adapter-account-fs'
import { KEY_PATH_VERSION } from './adapter-account-path-validation'

const parseLogicalKeyMetadata = (value: string) => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return parsed.version === KEY_PATH_VERSION && typeof parsed.key === 'string'
      ? { key: parsed.key, version: KEY_PATH_VERSION }
      : undefined
  } catch {
    return undefined
  }
}

export const ensureLogicalKeyMetadata = async (params: {
  directory: string
  filename: string
  key: string
  label: string
}) => {
  const metadataPath = resolve(params.directory, params.filename)
  let identity = await readPathIdentity(metadataPath)
  if (identity == null) {
    const handle = await open(metadataPath, 'wx', 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined
      throw error
    })
    if (handle != null) {
      try {
        await handle.writeFile(`${JSON.stringify({ key: params.key, version: KEY_PATH_VERSION })}\n`, 'utf8')
        await handle.chmod(0o600)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await syncDirectory(params.directory)
    }
    identity = await readPathIdentity(metadataPath)
  }
  if (identity == null || identity.isSymbolicLink || !identity.isFile) {
    throw new Error(`${params.label} metadata must be a real file: ${metadataPath}`)
  }
  if (parseLogicalKeyMetadata(await readFile(metadataPath, 'utf8'))?.key !== params.key) {
    throw new Error(`${params.label} metadata does not match the requested logical key: ${metadataPath}`)
  }
  await chmod(metadataPath, 0o600)
}

export const assertLogicalKeyMetadataSync = (params: {
  directory: string
  filename: string
  key: string
  label: string
}) => {
  const metadataPath = resolve(params.directory, params.filename)
  const identity = lstatSync(metadataPath)
  if (identity.isSymbolicLink() || !identity.isFile()) {
    throw new Error(`${params.label} metadata must be a real file: ${metadataPath}`)
  }
  if (parseLogicalKeyMetadata(readFileSync(metadataPath, 'utf8'))?.key !== params.key) {
    throw new Error(`${params.label} metadata does not match the requested logical key: ${metadataPath}`)
  }
}
