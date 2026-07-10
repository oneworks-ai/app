import { normalizeRelayConfigStringList, unique } from './config-assignment-patch.js'
import type { RelayConfigAssignment, RelayConfigProjectContext } from './config-assignment-types.js'

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const gitRepositoryHostPattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/iu
const caseInsensitiveRepositoryHosts = new Set([
  'bitbucket.org',
  'github.com',
  'gitlab.com'
])

export const normalizeRelayGitRepositoryIdentity = (value: unknown) => {
  const text = normalizeText(value)
  if (text == null || /\s/u.test(text)) return undefined

  let host = ''
  let repositoryPath = ''
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(text)) {
    try {
      const url = new URL(text)
      if (!['git:', 'http:', 'https:', 'ssh:'].includes(url.protocol) || url.search !== '' || url.hash !== '') {
        return undefined
      }
      const defaultPort = url.protocol === 'ssh:'
        ? '22'
        : url.protocol === 'git:'
        ? '9418'
        : url.protocol === 'http:'
        ? '80'
        : url.protocol === 'https:'
        ? '443'
        : ''
      host = `${url.hostname}${url.port !== '' && url.port !== defaultPort ? `:${url.port}` : ''}`
      repositoryPath = url.pathname
    } catch {
      return undefined
    }
  } else {
    const scpMatch = /^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/u.exec(text)
    if (scpMatch != null) {
      host = scpMatch[1] ?? ''
      repositoryPath = scpMatch[2] ?? ''
    } else {
      const [nextHost, ...pathSegments] = text.split('/')
      host = nextHost ?? ''
      repositoryPath = pathSegments.join('/')
    }
  }

  host = host.toLowerCase()
  repositoryPath = repositoryPath
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.git$/iu, '')
  const pathSegments = repositoryPath.split('/').filter(Boolean)
  if (
    !gitRepositoryHostPattern.test(host) ||
    pathSegments.length < 2 ||
    pathSegments.some(segment => segment === '.' || segment === '..' || /[?#\\]/u.test(segment))
  ) {
    return undefined
  }

  return `${host}/${pathSegments.join('/')}`
}

export const relayGitRepositoryComparisonKey = (value: unknown) => {
  const identity = normalizeRelayGitRepositoryIdentity(value)
  if (identity == null) return undefined
  const separatorIndex = identity.indexOf('/')
  const host = separatorIndex < 0 ? identity : identity.slice(0, separatorIndex)
  const providerHost = host.replace(/:\d+$/u, '')
  return caseInsensitiveRepositoryHosts.has(providerHost) ? identity.toLowerCase() : identity
}

export const relayGitRepositoryIdentitiesEqual = (left: unknown, right: unknown) => {
  const leftKey = relayGitRepositoryComparisonKey(left)
  const rightKey = relayGitRepositoryComparisonKey(right)
  return leftKey != null && rightKey != null && leftKey === rightKey
}

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
  const gitRepositories = (context.gitRepositories ?? [])
    .flatMap(repository => {
      const text = normalizeText(repository)
      const identity = normalizeRelayGitRepositoryIdentity(repository)
      return [text, identity].filter((value): value is string => value != null)
    })
  return unique([
    normalizeText(context.projectId),
    normalizeText(context.projectName),
    cwd,
    workspaceFolder,
    getPathName(cwd),
    getPathName(workspaceFolder),
    ...gitRepositories,
    ...(cwd == null ? [] : [normalizePath(cwd)]),
    ...(workspaceFolder == null ? [] : [normalizePath(workspaceFolder)])
  ].filter((value): value is string => value != null && value !== ''))
}

const matchesProjectPattern = (pattern: string, candidate: string) => {
  const repositoryPattern = normalizeRelayGitRepositoryIdentity(pattern)
  const repositoryCandidate = normalizeRelayGitRepositoryIdentity(candidate)
  if (repositoryPattern != null && repositoryCandidate != null) {
    return relayGitRepositoryIdentitiesEqual(repositoryPattern, repositoryCandidate)
  }
  return matchPattern(pattern, candidate)
}

const matchesAnyPattern = (patterns: string[] | undefined, candidates: string[]) => (
  patterns == null || patterns.length === 0
    ? false
    : patterns.some(pattern => candidates.some(candidate => matchesProjectPattern(pattern, candidate)))
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
