import process from 'node:process'

import { resolvePackageManagerEnv } from './npm-package-cache'
import { comparePackageVersions } from './package-version-request'
import type { PackageVersionRequest } from './package-version-request'
import { runBufferedCommand } from './process-utils'

const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const parseVersionOutput = (spec: string, output: string) => {
  const normalizedOutput = output.trim()
  if (!normalizedOutput) {
    throw new Error(`No version was returned for ${spec}.`)
  }

  try {
    const parsed = JSON.parse(normalizedOutput) as unknown
    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim()
    }
  } catch {
    // fall through
  }

  const unquotedOutput = normalizedOutput.replace(/^"|"$/g, '').trim()
  if (!unquotedOutput) {
    throw new Error(`Invalid published version for ${spec}: ${normalizedOutput}`)
  }

  return unquotedOutput
}

const resolvePublishedPackageVersionBySpec = async (
  spec: string,
  options: { allowMissing?: boolean; timeoutMs?: number } = {}
) => {
  const result = await runBufferedCommand({
    command: NPM_BIN,
    args: ['view', spec, 'version', '--json'],
    env: resolvePackageManagerEnv(),
    timeoutMs: options.timeoutMs
  })

  if (result.timedOut === true) {
    return {
      spec,
      timedOut: true as const
    }
  }

  if (result.code !== 0) {
    if (options.allowMissing === true) {
      return {
        missing: true as const,
        spec
      }
    }
    throw new Error(`Failed to resolve published version for ${spec}:\n${result.stderr.trim()}`)
  }

  return {
    spec,
    version: parseVersionOutput(spec, result.stdout)
  }
}

const parseVersionsOutput = (spec: string, output: string) => {
  const normalizedOutput = output.trim()
  if (!normalizedOutput) {
    throw new Error(`No versions were returned for ${spec}.`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalizedOutput) as unknown
  } catch {
    parsed = normalizedOutput.replace(/^"|"$/g, '').trim()
  }

  const versions = Array.isArray(parsed)
    ? parsed.filter((version): version is string => typeof version === 'string' && version.trim() !== '')
    : typeof parsed === 'string' && parsed.trim() !== ''
    ? [parsed.trim()]
    : []
  if (versions.length === 0) {
    throw new Error(`Invalid published versions for ${spec}: ${normalizedOutput}`)
  }
  return versions
}

const resolvePublishedPackageVersionsFromRegistry = async (
  packageName: string,
  options: { timeoutMs?: number } = {}
) => {
  const result = await runBufferedCommand({
    command: NPM_BIN,
    args: ['view', packageName, 'versions', '--json'],
    env: resolvePackageManagerEnv(),
    timeoutMs: options.timeoutMs
  })

  if (result.timedOut === true) {
    return {
      spec: packageName,
      timedOut: true as const
    }
  }

  if (result.code !== 0) {
    throw new Error(`Failed to resolve published versions for ${packageName}:\n${result.stderr.trim()}`)
  }

  return {
    spec: packageName,
    versions: parseVersionsOutput(packageName, result.stdout)
  }
}

export const resolvePublishedPackageVersionFromRegistry = async (
  packageName: string,
  request: PackageVersionRequest,
  options: { timeoutMs?: number } = {}
) => {
  if (request.exactVersion == null) {
    return await resolvePublishedPackageVersionBySpec(request.packageSpec, options)
  }

  const exactResult = await resolvePublishedPackageVersionBySpec(request.packageSpec, {
    allowMissing: true,
    timeoutMs: options.timeoutMs
  })
  if ('version' in exactResult || 'timedOut' in exactResult) {
    return exactResult
  }

  const versionsResult = await resolvePublishedPackageVersionsFromRegistry(packageName, options)
  if ('timedOut' in versionsResult) {
    return versionsResult
  }

  const matchedVersion = versionsResult.versions
    .filter(version => request.versionFilter == null || request.versionFilter(version))
    .sort(comparePackageVersions)
    .at(-1)
  if (matchedVersion == null) {
    throw new Error(
      `No published version for ${packageName} matches bootstrap runtime series ${request.exactVersion}.`
    )
  }
  return {
    spec: `${packageName} versions`,
    version: matchedVersion
  }
}
