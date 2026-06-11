import type {
  MessageWorkspaceFileOpener,
  WorkspaceExternalOpenResponse,
  WorkspaceExternalOpenerId,
  WorkspaceFileOpenResponse,
  WorkspaceFileOpenersResponse,
  WorkspacePathActionCapabilities
} from '@oneworks/types'

import { createApiUrl, fetchApiJson, jsonHeaders } from './base'
import type { ApiOkResponse } from './types'

export interface WorkspaceTreeEntry {
  absolutePath: string
  isExternal?: boolean
  isSymlink?: boolean
  linkKind?: 'gitdir' | 'symlink'
  linkTarget?: string
  linkType?: 'directory' | 'file' | 'missing' | 'other'
  path: string
  name: string
  type: 'file' | 'directory'
}

export interface WorkspaceFileContent {
  content: string
  encoding: 'utf-8'
  path: string
  size: number
}

export async function listWorkspaceTree(path?: string) {
  const url = createApiUrl('/api/workspace/tree')
  if (path != null && path.trim() !== '') {
    url.searchParams.set('path', path)
  }

  return fetchApiJson<{
    path: string
    entries: WorkspaceTreeEntry[]
  }>(url)
}

export async function readWorkspaceFile(path: string): Promise<WorkspaceFileContent> {
  const url = createApiUrl('/api/workspace/file')
  url.searchParams.set('path', path)
  return fetchApiJson<WorkspaceFileContent>(url)
}

export async function listWorkspaceFileOpeners(): Promise<WorkspaceFileOpenersResponse> {
  return fetchApiJson<WorkspaceFileOpenersResponse>('/api/workspace/file-openers')
}

export async function getWorkspacePathActionCapabilities(): Promise<WorkspacePathActionCapabilities> {
  return fetchApiJson<WorkspacePathActionCapabilities>('/api/workspace/path-actions')
}

export async function openWorkspaceFileInExternalOpener(
  path: string,
  options: {
    column?: number
    line?: number
    opener?: MessageWorkspaceFileOpener
  } = {}
): Promise<WorkspaceFileOpenResponse> {
  return fetchApiJson<WorkspaceFileOpenResponse>('/api/workspace/open-file', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      path,
      line: options.line,
      column: options.column,
      opener: options.opener
    })
  })
}

export async function openWorkspaceInExternalOpener(
  options: {
    opener?: WorkspaceExternalOpenerId | MessageWorkspaceFileOpener
  } = {}
): Promise<WorkspaceExternalOpenResponse> {
  return fetchApiJson<WorkspaceExternalOpenResponse>('/api/workspace/open-workspace', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      opener: options.opener
    })
  })
}

export interface WorkspacePathRevealResponse extends ApiOkResponse {
  path: string
}

export async function revealWorkspacePathInFileManager(path: string): Promise<WorkspacePathRevealResponse> {
  return fetchApiJson<WorkspacePathRevealResponse>('/api/workspace/reveal-path', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ path })
  })
}

export function getWorkspaceResourceUrl(path: string) {
  const url = createApiUrl('/api/workspace/resource')
  url.searchParams.set('path', path)
  return url.toString()
}

export async function updateWorkspaceFile(path: string, content: string): Promise<WorkspaceFileContent> {
  return fetchApiJson<WorkspaceFileContent>('/api/workspace/file', {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ path, content })
  })
}
