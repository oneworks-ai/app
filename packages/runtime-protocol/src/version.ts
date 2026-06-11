import packageJson from '../package.json'

export interface ParsedProtocolVersion {
  major: number
  minor: number
  patch: number
  prerelease?: string
  build?: string
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9a-z-]+(?:\.[0-9a-z-]+)*))?(?:\+([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/i

export const getCurrentProtocolVersion = () => packageJson.version

export const parseProtocolVersion = (
  version: string
): ParsedProtocolVersion | undefined => {
  const match = SEMVER_PATTERN.exec(version)
  if (match == null) {
    return undefined
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    build: match[5]
  }
}

const currentProtocolVersion = packageJson.version
const currentParsedProtocolVersion = parseProtocolVersion(currentProtocolVersion)

if (currentParsedProtocolVersion == null) {
  throw new Error(`Invalid package runtime protocol version: ${currentProtocolVersion}`)
}

export const DEFAULT_SUPPORTED_PROTOCOL_RANGE = `^${currentParsedProtocolVersion.major}.0.0`

export const isValidProtocolVersion = (version: string) => parseProtocolVersion(version) != null

const compareProtocolVersions = (
  left: ParsedProtocolVersion,
  right: ParsedProtocolVersion
) => {
  if (left.major !== right.major) {
    return left.major - right.major
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch
  }
  return 0
}

const satisfiesCaretRange = (
  version: ParsedProtocolVersion,
  rangeBase: ParsedProtocolVersion
) => {
  if (compareProtocolVersions(version, rangeBase) < 0) {
    return false
  }

  if (rangeBase.major > 0) {
    return version.major === rangeBase.major
  }
  if (rangeBase.minor > 0) {
    return version.major === 0 && version.minor === rangeBase.minor
  }
  return version.major === 0 && version.minor === 0 && version.patch === rangeBase.patch
}

export const isProtocolCompatible = (
  protocolVersion: string,
  supportedProtocolRange = DEFAULT_SUPPORTED_PROTOCOL_RANGE
) => {
  const version = parseProtocolVersion(protocolVersion)
  if (version == null) {
    return false
  }

  const range = supportedProtocolRange.trim()
  if (range === '*' || range === 'x' || range === 'X') {
    return true
  }

  if (range.startsWith('^')) {
    const rangeBase = parseProtocolVersion(range.slice(1))
    return rangeBase != null && satisfiesCaretRange(version, rangeBase)
  }

  const exactVersion = parseProtocolVersion(range)
  return exactVersion != null && compareProtocolVersions(version, exactVersion) === 0
}

export const assertProtocolCompatible = (
  protocolVersion: string,
  supportedProtocolRange = DEFAULT_SUPPORTED_PROTOCOL_RANGE
) => {
  if (!isValidProtocolVersion(protocolVersion)) {
    throw new Error(`Invalid runtime protocol version: ${protocolVersion}`)
  }

  if (!isProtocolCompatible(protocolVersion, supportedProtocolRange)) {
    throw new Error(
      `Runtime protocol version ${protocolVersion} is not compatible with ${supportedProtocolRange}`
    )
  }
}
