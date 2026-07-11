import type { Stats } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { getWorkspaceFolder } from '#~/services/config/index.js'
import { badRequest, isHttpError, notFound } from '#~/utils/http.js'

import { resolveWorkspaceFileEntryPath } from './file'
import type { WorkspacePathEntry } from './file'

const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  aac: 'audio/aac',
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  flac: 'audio/flac',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  ogv: 'video/ogg',
  png: 'image/png',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  webm: 'video/webm',
  webp: 'image/webp'
}

export interface WorkspaceMediaResource {
  device: number
  filePath: string
  inode: number
  mimeType: string
  path: string
  size: number
}

const isPathInside = (parentPath: string, childPath: string) => {
  const childRelativePath = relative(parentPath, childPath)
  return childRelativePath === '' || (
    childRelativePath !== '..' &&
    !childRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(childRelativePath)
  )
}

const getProductArtifactRoots = async () => {
  const candidateParents = new Set([resolve('/tmp')])
  const canonicalParents = await Promise.all(
    [...candidateParents].map(parent => realpath(parent).catch(() => resolve(parent)))
  )
  return [
    ...new Set(
      [...candidateParents, ...canonicalParents].map(parent => join(resolve(parent), 'oneworks-cua'))
    )
  ]
}

const getFileExtension = (path: string) => {
  const fileName = path.split('/').filter(Boolean).at(-1) ?? path
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex <= 0 ? '' : fileName.slice(dotIndex + 1).toLowerCase()
}

export const resolveWorkspaceImageResource = async (
  rawPath: string | undefined,
  options: { workspaceFolder?: string } = {}
): Promise<WorkspaceMediaResource> => {
  const resource = await resolveWorkspaceMediaResource(rawPath, options).catch((error) => {
    if (isHttpError(error) && error.code === 'workspace_resource_not_media') {
      throw badRequest(
        'Workspace resource is not a supported image',
        { path: rawPath },
        'workspace_resource_not_image'
      )
    }
    throw error
  })
  if (!resource.mimeType.startsWith('image/')) {
    throw badRequest('Workspace resource is not a supported image', { path: rawPath }, 'workspace_resource_not_image')
  }
  return resource
}

export const resolveWorkspaceMediaResource = async (
  rawPath: string | undefined,
  options: {
    allowProductArtifactPaths?: boolean
    workspaceFolder?: string
  } = {}
): Promise<WorkspaceMediaResource> => {
  const workspaceFolder = options.workspaceFolder ?? getWorkspaceFolder()
  const trimmedPath = rawPath?.trim() ?? ''
  if (trimmedPath === '') {
    throw badRequest('Workspace media path is required', { path: rawPath }, 'workspace_media_path_required')
  }

  const workspaceRealRoot = await realpath(workspaceFolder).catch(() => {
    throw notFound(
      'Workspace root was not found',
      { workspaceFolder },
      'workspace_media_workspace_root_not_found'
    )
  })
  const artifactRoots = options.allowProductArtifactPaths === true ? await getProductArtifactRoots() : []
  const canonicalRoots = [workspaceRealRoot, ...artifactRoots]

  let resolved: WorkspacePathEntry
  if (!isAbsolute(trimmedPath)) {
    resolved = await resolveWorkspaceFileEntryPath(trimmedPath, { workspaceFolder })
  } else {
    const workspaceLexicalRoot = resolve(workspaceFolder)
    const lexicalRoots = [...new Set([workspaceLexicalRoot, workspaceRealRoot, ...artifactRoots])]
    const requestedPath = resolve(trimmedPath)

    if (!lexicalRoots.some(root => isPathInside(root, requestedPath))) {
      throw badRequest(
        'Local media path is outside the authorized roots',
        { path: rawPath },
        'workspace_media_path_not_authorized'
      )
    }

    let fileStat: Stats
    try {
      const symlinkStat = await lstat(requestedPath)
      fileStat = symlinkStat.isSymbolicLink() ? await stat(requestedPath) : symlinkStat
    } catch {
      throw notFound('Local media file not found', { path: rawPath }, 'workspace_media_not_found')
    }

    const targetRealPath = await realpath(requestedPath).catch(() => undefined)
    if (targetRealPath == null || !canonicalRoots.some(root => isPathInside(root, targetRealPath))) {
      throw badRequest(
        'Local media path escapes an authorized root through a symlink',
        { path: rawPath },
        'workspace_media_path_escapes_authorized_root'
      )
    }

    if (!fileStat.isFile()) {
      throw badRequest('Local media path is not a file', { path: rawPath }, 'workspace_media_path_not_file')
    }

    resolved = {
      filePath: targetRealPath,
      fileStat,
      normalizedPath: trimmedPath
    }
  }

  const { filePath, fileStat, normalizedPath } = resolved
  const canonicalFilePath = await realpath(filePath).catch(() => undefined)
  if (canonicalFilePath == null) {
    throw notFound('Local media file not found', { path: rawPath }, 'workspace_media_not_found')
  }
  if (!canonicalRoots.some(root => isPathInside(root, canonicalFilePath))) {
    throw badRequest(
      'Local media path escapes an authorized root through a symlink',
      { path: rawPath },
      'workspace_media_path_escapes_authorized_root'
    )
  }

  const mimeType = MEDIA_MIME_BY_EXTENSION[getFileExtension(normalizedPath)]
  if (mimeType == null) {
    throw badRequest(
      'Workspace resource is not a supported media file',
      { path: rawPath },
      'workspace_resource_not_media'
    )
  }

  return {
    device: fileStat.dev,
    filePath: canonicalFilePath,
    inode: fileStat.ino,
    mimeType,
    path: normalizedPath,
    size: fileStat.size
  }
}
