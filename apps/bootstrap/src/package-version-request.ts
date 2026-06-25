import { createRequire } from 'node:module'
import process from 'node:process'

import { compareVersionLike, resolvePackageTag } from './npm-package-cache'

const BOOTSTRAP_PACKAGE_VERSION_ENV = 'ONEWORKS_BOOTSTRAP_PACKAGE_VERSION'

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export interface PackageVersionRequest {
  exactVersion?: string
  lookupScope: string
  packageSpec: string
  tag?: string
  versionFilter?: (version: string) => boolean
}

const parseSemver = (version: string): ParsedSemver | undefined => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version.trim())
  if (match == null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? []
  }
}

const comparePrereleaseIdentifiers = (left: string, right: string) => {
  const leftNumber = /^\d+$/u.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/u.test(right) ? Number(right) : undefined
  if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber
  if (leftNumber != null) return -1
  if (rightNumber != null) return 1
  return left.localeCompare(right)
}

const compareSemver = (left: ParsedSemver, right: ParsedSemver) => {
  const coreDiff = left.major - right.major || left.minor - right.minor || left.patch - right.patch
  if (coreDiff !== 0) return coreDiff
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const maxLength = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    const diff = comparePrereleaseIdentifiers(leftPart, rightPart)
    if (diff !== 0) return diff
  }
  return 0
}

export const comparePackageVersions = (left: string, right: string) => {
  const leftSemver = parseSemver(left)
  const rightSemver = parseSemver(right)
  if (leftSemver != null && rightSemver != null) return compareSemver(leftSemver, rightSemver)
  return compareVersionLike(left, right)
}

const hasSameSemverCore = (left: ParsedSemver, right: ParsedSemver) => (
  left.major === right.major && left.minor === right.minor && left.patch === right.patch
)

const readBootstrapPackageVersion = () => {
  const envVersion = process.env[BOOTSTRAP_PACKAGE_VERSION_ENV]?.trim()
  if (envVersion) return envVersion

  try {
    const requireFromHere = createRequire(import.meta.url)
    const packageJsonPath = requireFromHere.resolve('oneworks/package.json')
    const packageJson = requireFromHere(packageJsonPath) as { version?: unknown }
    return typeof packageJson.version === 'string' && packageJson.version.trim()
      ? packageJson.version.trim()
      : undefined
  } catch {
    return undefined
  }
}

export const resolvePackageVersionRequest = (packageName: string): PackageVersionRequest => {
  const explicitTag = process.env.ONEWORKS_BOOTSTRAP_PACKAGE_TAG?.trim()
  if (explicitTag) {
    return {
      lookupScope: `tag:${explicitTag}`,
      packageSpec: `${packageName}@${explicitTag}`,
      tag: explicitTag
    }
  }

  const bootstrapVersion = readBootstrapPackageVersion()
  const parsedBootstrapVersion = bootstrapVersion == null ? undefined : parseSemver(bootstrapVersion)
  const prereleaseChannel = parsedBootstrapVersion?.prerelease[0]
  if (bootstrapVersion != null && parsedBootstrapVersion != null && prereleaseChannel != null) {
    return {
      exactVersion: bootstrapVersion,
      lookupScope: `bootstrap:${bootstrapVersion}:channel:${prereleaseChannel}`,
      packageSpec: `${packageName}@${bootstrapVersion}`,
      versionFilter: (version) => {
        const parsedVersion = parseSemver(version)
        return parsedVersion != null &&
          hasSameSemverCore(parsedVersion, parsedBootstrapVersion) &&
          parsedVersion.prerelease[0] === prereleaseChannel
      }
    }
  }

  const tag = resolvePackageTag()
  return {
    lookupScope: `tag:${tag}`,
    packageSpec: `${packageName}@${tag}`,
    tag
  }
}
