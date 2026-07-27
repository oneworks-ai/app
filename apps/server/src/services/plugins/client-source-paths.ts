import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

export const cleanModuleFilePath = (moduleId: string) => {
  if (moduleId.startsWith('\0')) return undefined
  const cleanId = moduleId.split(/[?#]/, 1)[0]
  if (cleanId == null || cleanId === '') return undefined
  if (cleanId.startsWith('file:')) {
    try {
      return fileURLToPath(cleanId)
    } catch {
      return undefined
    }
  }
  return path.isAbsolute(cleanId) ? cleanId : undefined
}

export const resolveRealModuleFile = async (moduleId: string) => {
  const filePath = cleanModuleFilePath(moduleId)
  if (filePath == null) return undefined
  return await realpath(filePath).catch(() => undefined)
}

export const isNodeModulesPath = (filePath: string) => (
  filePath.split(path.sep).includes('node_modules')
)

export const validateSourceAssetReference = async ({
  reference,
  sourceFile,
  sourceRoot
}: {
  reference: string
  sourceFile: string
  sourceRoot: string
}) => {
  if (
    /^[a-z][a-z\d+.-]*:/i.test(reference) ||
    reference.startsWith('#') ||
    /^[a-z-]+\(/i.test(reference)
  ) {
    return
  }
  const fileReference = reference.split(/[?#]/, 1)[0]
  if (fileReference == null || fileReference === '') return
  const realAsset = await realpath(
    path.resolve(path.dirname(sourceFile), fileReference)
  ).catch(() => undefined)
  if (realAsset != null && !isPathInside(sourceRoot, realAsset)) {
    throw new Error(
      `Client source asset "${reference}" resolves outside the client source root.`
    )
  }
}
