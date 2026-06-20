import { normalizeRelayConfigStringList, unique } from './config-assignment-patch.js'
import type { RelayConfigAssignment, RelayConfigProjectContext } from './config-assignment-types.js'

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const matchPattern = (pattern: string, value: string) => {
  if (pattern === value) return true
  if (!pattern.includes('*')) return false

  const expression = `^${pattern.split('*').map(escapeRegExp).join('.*')}$`
  return new RegExp(expression, 'u').test(value)
}

const normalizePath = (value: string) => value.replace(/\\/gu, '/').replace(/\/+$/u, '')

const getPathName = (value: string | undefined) => {
  if (value == null) return undefined
  const normalized = normalizePath(value)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1]
}

const getProjectCandidates = (context: RelayConfigProjectContext) => {
  const cwd = normalizeText(context.cwd)
  const workspaceFolder = normalizeText(context.workspaceFolder)
  return unique([
    normalizeText(context.projectId),
    normalizeText(context.projectName),
    cwd,
    workspaceFolder,
    getPathName(cwd),
    getPathName(workspaceFolder),
    ...(cwd == null ? [] : [normalizePath(cwd)]),
    ...(workspaceFolder == null ? [] : [normalizePath(workspaceFolder)])
  ].filter((value): value is string => value != null && value !== ''))
}

const matchesAnyPattern = (patterns: string[] | undefined, candidates: string[]) => (
  patterns == null || patterns.length === 0
    ? false
    : patterns.some(pattern => candidates.some(candidate => matchPattern(pattern, candidate)))
)

export const matchesRelayConfigProject = (
  assignment: Pick<RelayConfigAssignment, 'project'>,
  context: RelayConfigProjectContext
) => {
  const candidates = getProjectCandidates(context)
  const allow = normalizeRelayConfigStringList(assignment.project?.allow)
  const deny = normalizeRelayConfigStringList(assignment.project?.deny)

  if (matchesAnyPattern(deny, candidates)) return false
  if (allow == null || allow.length === 0) return true

  return matchesAnyPattern(allow, candidates)
}
