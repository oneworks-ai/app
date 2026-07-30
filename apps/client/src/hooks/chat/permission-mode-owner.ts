import { stableSha256 } from './stable-sha256'

export type CanonicalPermissionModeOwner = string & {
  readonly __canonicalPermissionModeOwner: unique symbol
}

type WorkspacePathKind = 'posix' | 'unc' | 'windows-drive'

interface StructuredWorkspacePath {
  kind: WorkspacePathKind
  root: string
  segments: string[]
}

const normalizeSegments = (parts: string[], caseInsensitive: boolean) => {
  const segments: string[] = []
  for (const rawSegment of parts) {
    const segment = caseInsensitive ? rawSegment.toLowerCase() : rawSegment
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0) segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments
}

const parseAbsoluteWorkspacePath = (value: string): StructuredWorkspacePath | undefined => {
  const trimmed = value.trim()
  if (/^(?:\\\\|\/\/)[^\\/]/.test(trimmed)) {
    const parts = trimmed.replace(/^(?:\\\\|\/\/)/, '').split(/[\\/]+/)
    if (parts.length < 2 || parts[0] === '' || parts[1] === '') return undefined
    const [server, share, ...rest] = parts
    return {
      kind: 'unc',
      root: `${server.toLowerCase()}/${share.toLowerCase()}`,
      segments: normalizeSegments(rest, true)
    }
  }
  const driveMatch = /^([a-z]):[\\/](.*)$/i.exec(trimmed)
  if (driveMatch != null) {
    return {
      kind: 'windows-drive',
      root: driveMatch[1].toLowerCase(),
      segments: normalizeSegments(driveMatch[2].split(/[\\/]+/), true)
    }
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return {
      kind: 'posix',
      root: '/',
      segments: normalizeSegments(trimmed.slice(1).split('/'), false)
    }
  }
  return undefined
}

const resolveRelativeWorkspacePath = (
  source: StructuredWorkspacePath,
  relative: string
): StructuredWorkspacePath => {
  const relativeSegments = source.kind === 'posix'
    ? relative.trim().split('/')
    : relative.trim().split(/[\\/]+/)
  return {
    ...source,
    segments: normalizeSegments(
      [...source.segments, ...relativeSegments],
      source.kind !== 'posix'
    )
  }
}

const serializeWorkspaceIdentity = (path: StructuredWorkspacePath) => {
  return JSON.stringify({
    namespace: path.kind,
    root: path.root,
    segments: path.segments
  })
}

export const deriveCanonicalPermissionModeOwner = ({
  sourceWorkspaceFolder,
  workspaceFolder
}: {
  sourceWorkspaceFolder?: string
  workspaceFolder?: string
}): CanonicalPermissionModeOwner | undefined => {
  const source = sourceWorkspaceFolder == null
    ? undefined
    : parseAbsoluteWorkspacePath(sourceWorkspaceFolder)
  const workspaceValue = workspaceFolder?.trim()
  const workspace = workspaceValue == null || workspaceValue === ''
    ? source
    : parseAbsoluteWorkspacePath(workspaceValue) ??
      (source == null ? undefined : resolveRelativeWorkspacePath(source, workspaceValue))
  if (workspace == null) return undefined

  return `workspace:sha256:${stableSha256(serializeWorkspaceIdentity(workspace))}` as CanonicalPermissionModeOwner
}
