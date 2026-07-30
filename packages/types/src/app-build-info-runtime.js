const APP_BUILD_VERSION_FALLBACK = '0.0.0'

const SEMVER_NUMERIC_IDENTIFIER = String.raw`(?:0|[1-9]\d*)`
const SEMVER_NON_NUMERIC_IDENTIFIER = String.raw`(?=[0-9A-Za-z-]*[A-Za-z-])[0-9A-Za-z-]+`
const SEMVER_PRERELEASE_IDENTIFIER = String.raw`(?:${SEMVER_NUMERIC_IDENTIFIER}|${SEMVER_NON_NUMERIC_IDENTIFIER})`
const SEMVER_BUILD_IDENTIFIER = String.raw`[0-9A-Za-z-]+`
const VERSION_PATTERN = new RegExp(
  String.raw`^${SEMVER_NUMERIC_IDENTIFIER}\.${SEMVER_NUMERIC_IDENTIFIER}\.${SEMVER_NUMERIC_IDENTIFIER}` +
    String.raw`(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\.${SEMVER_PRERELEASE_IDENTIFIER})*)?` +
    String.raw`(?:\+${SEMVER_BUILD_IDENTIFIER}(?:\.${SEMVER_BUILD_IDENTIFIER})*)?$`,
  'u'
)
const COMMIT_PATTERN = /^[0-9a-f]{7,64}$/u
const ISO_DATE_PATTERN = new RegExp(
  String.raw`^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)` +
    String.raw`(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$`,
  'u'
)

const fallbackBuildInfo = (fallbackVersion) => ({
  version: normalizeVersion(undefined, fallbackVersion),
  commit: null,
  buildTime: null,
  buildTimeSource: 'unavailable'
})

const isLeapYear = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

const isValidCalendarDate = (year, month, day) => {
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
}

const getValidVersion = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return VERSION_PATTERN.test(normalized) ? normalized : undefined
}

const normalizeVersion = (value, fallback = APP_BUILD_VERSION_FALLBACK) => (
  getValidVersion(value) ?? getValidVersion(fallback) ?? APP_BUILD_VERSION_FALLBACK
)

const normalizeCommit = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return COMMIT_PATTERN.test(normalized) ? normalized : null
}

const normalizeBuildTime = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  const match = ISO_DATE_PATTERN.exec(normalized)
  if (match == null || !isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) return null
  const timestamp = Date.parse(normalized)
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
}

/**
 * The sole public ingress for build identity. It accepts raw JSON text and
 * never reflects on, clones, or otherwise inspects caller-owned objects.
 */
const parseAppBuildInfoJson = (json, fallbackVersion = APP_BUILD_VERSION_FALLBACK) => {
  const text = typeof json === 'string'
    ? json
    : ArrayBuffer.isView(json)
    ? new TextDecoder().decode(json)
    : undefined
  if (text == null) return fallbackBuildInfo(fallbackVersion)

  try {
    const value = JSON.parse(text)
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return fallbackBuildInfo(fallbackVersion)
    }
    const buildTime = normalizeBuildTime(value.buildTime)
    return {
      version: normalizeVersion(value.version, fallbackVersion),
      commit: normalizeCommit(value.commit),
      buildTime,
      buildTimeSource: buildTime == null
        ? 'unavailable'
        : value.buildTimeSource === 'commit'
        ? 'commit'
        : 'build'
    }
  } catch {
    return fallbackBuildInfo(fallbackVersion)
  }
}

module.exports = {
  APP_BUILD_VERSION_FALLBACK,
  parseAppBuildInfoJson
}
