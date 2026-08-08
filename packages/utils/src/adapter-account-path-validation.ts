import { createHash } from 'node:crypto'

import type { AdapterAccountCredentialArtifact } from '@oneworks/types'

const WINDOWS_RESERVED_PATH_SEGMENT = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\..*)?$/iu

export const ACCOUNT_STORE_DIRNAME = '.oneworks-account-store'
export const ACCOUNT_LOCKS_DIRNAME = '.oneworks-account-locks'
export const ACCOUNT_GENERATIONS_DIRNAME = 'generations'
export const ACCOUNT_POINTER_FILENAME = 'current'
export const ADAPTER_KEY_METADATA_FILENAME = '.oneworks-adapter-key.json'
export const ACCOUNT_KEY_METADATA_FILENAME = '.oneworks-account-key.json'
export const KEY_PATH_VERSION = 'v1'
export const GENERATION_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu

const toPortablePathKey = (value: string) => value.normalize('NFKC').toLowerCase()

export const encodeLogicalPathKey = (value: string) => (
  `${KEY_PATH_VERSION}-${createHash('sha256').update(value, 'utf8').digest('hex')}`
)

const isReservedInternalPathSegment = (segment: string) => {
  const portableSegment = toPortablePathKey(segment)
  return portableSegment === ACCOUNT_STORE_DIRNAME || portableSegment === ACCOUNT_LOCKS_DIRNAME
}

const isInvalidPortablePathSegment = (segment: string) => (
  segment === '' ||
  segment === '.' ||
  segment === '..' ||
  segment.trim() !== segment ||
  /[<>:"|?*]/u.test(segment) ||
  segment.endsWith('.') ||
  WINDOWS_RESERVED_PATH_SEGMENT.test(segment)
)

const assertRelativeArtifactPath = (value: string) => {
  const normalized = value.trim()
  if (
    normalized === '' ||
    normalized !== value ||
    normalized.includes('\0') ||
    normalized.includes('\\') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized)
  ) {
    throw new Error(`Invalid adapter account artifact path "${value}".`)
  }
  if (normalized.split('/').some(isInvalidPortablePathSegment)) {
    throw new Error(`Adapter account artifact path "${value}" must stay inside the account directory.`)
  }
  return normalized
}

export const assertArtifactPathSet = (artifacts: AdapterAccountCredentialArtifact[]) => {
  const paths = artifacts.map(artifact => assertRelativeArtifactPath(artifact.path))
  const portablePaths = paths.map(toPortablePathKey)
  for (let left = 0; left < portablePaths.length; left += 1) {
    for (let right = left + 1; right < portablePaths.length; right += 1) {
      const leftPath = portablePaths[left]!
      const rightPath = portablePaths[right]!
      if (
        leftPath === rightPath ||
        leftPath.startsWith(`${rightPath}/`) ||
        rightPath.startsWith(`${leftPath}/`)
      ) {
        throw new Error(`Adapter account artifact paths "${paths[left]}" and "${paths[right]}" collide.`)
      }
    }
  }
  return paths
}

export const assertAdapterAccountPathSegment = (value: string, label: string) => {
  const normalized = value.trim()
  if (
    normalized === '' ||
    normalized !== value ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    /^[a-z]:/iu.test(normalized) ||
    isReservedInternalPathSegment(normalized) ||
    isInvalidPortablePathSegment(normalized)
  ) {
    throw new Error(`Invalid ${label} path segment "${value}".`)
  }
  return normalized
}
