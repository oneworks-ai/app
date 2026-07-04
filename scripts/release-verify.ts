/* eslint-disable max-lines -- release verification coordinates npm, GitHub Releases, installed apps, caches, and runtime sessions. */
import { execFile } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { buildPackageReleaseTag } from './cli-package-release'
import { waitForRuntimeEvidenceReply } from './runtime-evidence'

const execFileAsync = promisify(execFile)

export const DEFAULT_RELEASE_VERIFY_REPO = 'oneworks-ai/app'
export const DEFAULT_RELEASE_VERIFY_NPM_PACKAGES = [
  'oneworks',
  '@oneworks/client',
  '@oneworks/cli',
  'onework',
  'oneork',
  'oneorks'
]
export const DEFAULT_RELEASE_VERIFY_RUNTIME_PACKAGES = [
  '@oneworks/client',
  '@oneworks/server',
  '@oneworks/cli',
  '@oneworks/adapter-codex',
  '@oneworks/adapter-claude-code'
]
export const DEFAULT_DESKTOP_APP_PATH = '/Applications/One Works.app'
export const DEFAULT_DESKTOP_BUNDLE_ID = 'ai.oneworks.desktop'
export const DEFAULT_DESKTOP_APP_NAME = 'One Works'
export const DEFAULT_DESKTOP_ASSET_ARCHS = ['arm64', 'x64']
export const DEFAULT_DESKTOP_ASSET_EXTS = ['dmg', 'pkg', 'zip']
export const releaseVerifyScenarios = ['desktop-installed', 'desktop-chat'] as const

const COMMAND_MAX_BUFFER = 1024 * 1024 * 10
const ADAPTER_PACKAGE_PREFIX = '@oneworks/adapter-'

interface CommandResult {
  stderr: string
  stdout: string
}

export interface ReleaseVerifyDeps {
  homeDir: () => string
  now: () => number
  platform: () => NodeJS.Platform
  runCommand: (command: string, args: string[], options?: { cwd?: string }) => Promise<CommandResult>
  sleep: (ms: number) => Promise<void>
}

export interface ReleaseVerifyCheck {
  durationMs?: number
  message: string
  name: string
  ok: boolean
}

export interface ReleaseVerifyResult {
  checks: ReleaseVerifyCheck[]
  elapsedMs: number
  ok: boolean
}

export type ReleaseVerifyScenario = typeof releaseVerifyScenarios[number]

export interface ReleaseVerifyBetaInput {
  desktopApp?: boolean
  desktopAppName?: string
  desktopAppPath?: string
  desktopAssetArchs?: string[]
  desktopAssetExts?: string[]
  desktopAssetNames?: string[]
  desktopBundleId?: string
  desktopRelease?: boolean
  expectedReply?: string
  discoverSession?: boolean
  emit?: boolean
  json?: boolean
  npmPackages?: string[]
  packageCacheRoot?: string
  projectHome?: string
  repo?: string
  runtimeCache?: boolean
  runtimeCacheHome?: string
  runtimeVersionMode?: 'dist-tag' | 'exact'
  runtimePackages?: string[]
  sessionId?: string
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  tag?: string
  version: string
  waitSessionMs?: number
  setExitCode?: boolean
  withoutBuildSource?: boolean
}

export interface ReleaseVerifyRunInput
  extends Omit<ReleaseVerifyBetaInput, 'emit' | 'json' | 'setExitCode' | 'tag' | 'version'>
{
  channel?: string
  json?: boolean
  scenario?: ReleaseVerifyScenario
  setExitCode?: boolean
  tag?: string
  version?: string
}

export interface ReleaseVerifyRunResult extends ReleaseVerifyResult {
  channel: string
  expectedReply?: string
  recommendations: string[]
  scenario: ReleaseVerifyScenario
  uiAction?: string
  version: string
}

export interface ReleaseVerifyAgentInput extends Omit<ReleaseVerifyRunInput, 'discoverSession' | 'scenario'> {
  scenario?: ReleaseVerifyScenario
}

const defaultDeps: ReleaseVerifyDeps = {
  homeDir: () => os.homedir(),
  now: () => Date.now(),
  platform: () => process.platform,
  runCommand: async (command, args, options) => {
    const result = await execFileAsync(command, args, {
      cwd: options?.cwd,
      encoding: 'utf8',
      maxBuffer: COMMAND_MAX_BUFFER
    })
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? ''
    }
  },
  sleep: async (ms) => {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

export const parseReleaseVerifyList = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return value.map(item => item.trim()).filter(Boolean)
  }
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? []
}

export const parseReleaseVerifyScenario = (value: string | undefined): ReleaseVerifyScenario => {
  const normalized = value?.trim() || 'desktop-installed'
  if (releaseVerifyScenarios.includes(normalized as ReleaseVerifyScenario)) {
    return normalized as ReleaseVerifyScenario
  }
  throw new Error(`Unsupported release verification scenario: ${normalized}`)
}

const normalizeVersion = (value: string) => {
  const trimmed = value.trim()
  const packageTagPrefix = /^pkg\/[^/]+\/v/u
  if (packageTagPrefix.test(trimmed)) return trimmed.replace(packageTagPrefix, '')
  return trimmed.replace(/^v/u, '')
}

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

const createCheck = (name: string, ok: boolean, message: string): ReleaseVerifyCheck => ({
  name,
  ok,
  message
})

const createTimedCheck = (
  name: string,
  ok: boolean,
  message: string,
  startedAt: number,
  deps: ReleaseVerifyDeps
) => ({
  ...createCheck(name, ok, message),
  durationMs: deps.now() - startedAt
})

const timedCheck = async (
  name: string,
  deps: ReleaseVerifyDeps,
  fn: () => Promise<ReleaseVerifyCheck>
): Promise<ReleaseVerifyCheck> => {
  const startedAt = deps.now()
  try {
    return {
      ...await fn(),
      durationMs: deps.now() - startedAt
    }
  } catch (error) {
    return {
      ...createCheck(name, false, formatError(error)),
      durationMs: deps.now() - startedAt
    }
  }
}

const readJsonFile = async (filePath: string) => {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content) as unknown
}

const readPackageJsonVersion = async (packageJsonPath: string) => {
  const parsed = await readJsonFile(packageJsonPath)
  if (!isRecord(parsed) || typeof parsed.version !== 'string') {
    throw new Error(`Missing version in ${packageJsonPath}`)
  }
  return parsed.version
}

const fileExists = async (filePath: string) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const parseNpmViewVersion = (stdout: string) => {
  const trimmed = stdout.trim()
  if (trimmed === '') return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') return parsed
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0]
  } catch {
    return trimmed.replace(/^"|"$/gu, '')
  }
  return trimmed
}

const packageNamePathSegments = (packageName: string) => packageName.split('/')

const sanitizePackageName = (packageName: string) => packageName.replace(/^@/u, '').replace(/[\\/]/gu, '__')

const buildNpmCachePackageJsonPath = (input: {
  homeDir: string
  packageCacheRoot?: string
  packageName: string
  version: string
}) => (
  path.join(
    input.packageCacheRoot ?? path.join(input.homeDir, '.oneworks', 'bootstrap'),
    'npm',
    sanitizePackageName(input.packageName),
    input.version,
    'node_modules',
    ...packageNamePathSegments(input.packageName),
    'package.json'
  )
)

const buildAdapterCachePackageJsonPath = (input: {
  homeDir: string
  packageCacheRoot?: string
  packageName: string
  version: string
}) => (
  path.join(
    input.packageCacheRoot ?? path.join(input.homeDir, '.oneworks', 'bootstrap'),
    'adapter-packages',
    sanitizePackageName(input.packageName),
    input.version,
    'node_modules',
    ...packageNamePathSegments(input.packageName),
    'package.json'
  )
)

const buildDefaultDesktopAssetNames = (input: {
  archs: string[]
  exts: string[]
  version: string
}) => (
  input.archs.flatMap(arch => input.exts.map(ext => `oneworks-${input.version}-mac-${arch}.${ext}`))
)

export const resolveDesktopReleaseAssetNames = (input: {
  archs?: string[]
  assetNames?: string[]
  exts?: string[]
  version: string
}) => {
  if (input.assetNames != null && input.assetNames.length > 0) {
    return input.assetNames
  }
  return buildDefaultDesktopAssetNames({
    version: normalizeVersion(input.version),
    archs: input.archs?.length ? input.archs : DEFAULT_DESKTOP_ASSET_ARCHS,
    exts: input.exts?.length ? input.exts : DEFAULT_DESKTOP_ASSET_EXTS
  })
}

const verifyNpmPackageTag = async (input: {
  actualVersion: Promise<string>
  packageName: string
  tag: string
  version: string
}) => {
  const actual = await input.actualVersion
  const ok = actual === input.version
  return createCheck(
    `npm ${input.packageName}@${input.tag}`,
    ok,
    ok ? `${actual}` : `expected ${input.version}, got ${actual || '<empty>'}`
  )
}

const readNpmDistTagVersion = async (input: {
  packageName: string
  tag: string
}, deps: ReleaseVerifyDeps) => (
  parseNpmViewVersion(
    (await deps.runCommand('npm', ['view', `${input.packageName}@${input.tag}`, 'version', '--json'])).stdout
  )
)

const resolveReleaseVerifyVersion = async (input: {
  channel: string
  version?: string
}, deps: ReleaseVerifyDeps) => {
  const requestedVersion = input.version?.trim()
  if (requestedVersion != null && requestedVersion !== '' && requestedVersion !== 'auto') {
    return normalizeVersion(requestedVersion)
  }

  return await readNpmDistTagVersion({
    packageName: 'oneworks',
    tag: input.channel
  }, deps)
}

const verifyRuntimeExpectedVersion = async (input: {
  expectedVersion: Promise<string>
  packageName: string
  tag: string
}) => {
  const expectedVersion = await input.expectedVersion
  return createCheck(
    `runtime dist-tag ${input.packageName}@${input.tag}`,
    expectedVersion.trim() !== '',
    expectedVersion
  )
}

const verifyGithubDesktopRelease = async (input: {
  assetNames: string[]
  repo: string
  version: string
}, deps: ReleaseVerifyDeps) => {
  const tagName = buildPackageReleaseTag('@oneworks/desktop', input.version)
  const output = await deps.runCommand('gh', [
    'release',
    'view',
    tagName,
    '--repo',
    input.repo,
    '--json',
    'tagName,isPrerelease,url,assets'
  ])
  const parsed = JSON.parse(output.stdout) as unknown
  if (!isRecord(parsed)) {
    return createCheck('desktop GitHub release', false, 'GitHub release output was not an object')
  }

  const assets = Array.isArray(parsed.assets) ? parsed.assets : []
  const assetNames = new Set(
    assets.flatMap(asset => isRecord(asset) && typeof asset.name === 'string' ? [asset.name] : [])
  )
  const missingAssets = input.assetNames.filter(assetName => !assetNames.has(assetName))
  const actualTagName = typeof parsed.tagName === 'string' ? parsed.tagName : ''
  const prereleaseExpected = input.version.includes('-')
  const prereleaseActual = parsed.isPrerelease === true
  const ok = actualTagName === tagName && missingAssets.length === 0 && prereleaseActual === prereleaseExpected
  const url = typeof parsed.url === 'string' ? parsed.url : tagName

  return createCheck(
    'desktop GitHub release',
    ok,
    ok
      ? `${url} (${input.assetNames.length} expected assets)`
      : [
        actualTagName === tagName ? undefined : `expected tag ${tagName}, got ${actualTagName || '<empty>'}`,
        prereleaseActual === prereleaseExpected
          ? undefined
          : `expected prerelease=${prereleaseExpected}, got ${prereleaseActual}`,
        missingAssets.length === 0 ? undefined : `missing assets: ${missingAssets.join(', ')}`
      ].filter(Boolean).join('; ')
  )
}

const readInfoPlist = async (input: {
  appPath: string
}, deps: ReleaseVerifyDeps) => {
  const plistPath = path.join(input.appPath, 'Contents', 'Info.plist')
  const output = await deps.runCommand('plutil', ['-convert', 'json', '-o', '-', plistPath])
  return JSON.parse(output.stdout) as unknown
}

const verifyInstalledDesktopMetadata = async (input: {
  appName: string
  appPath: string
  bundleId: string
  version: string
}, deps: ReleaseVerifyDeps) => {
  if (deps.platform() !== 'darwin') {
    return createCheck('installed desktop metadata', true, `skipped on ${deps.platform()}`)
  }

  const info = await readInfoPlist({ appPath: input.appPath }, deps)
  if (!isRecord(info)) {
    return createCheck('installed desktop metadata', false, 'Info.plist was not an object')
  }

  const actualBundleId = typeof info.CFBundleIdentifier === 'string' ? info.CFBundleIdentifier : ''
  const actualName = typeof info.CFBundleName === 'string' ? info.CFBundleName : ''
  const actualVersion = typeof info.CFBundleShortVersionString === 'string' ? info.CFBundleShortVersionString : ''
  const ok = actualBundleId === input.bundleId && actualName === input.appName && actualVersion === input.version

  return createCheck(
    'installed desktop metadata',
    ok,
    ok
      ? `${actualName} ${actualVersion} (${actualBundleId})`
      : [
        actualBundleId === input.bundleId ? undefined : `bundle ${actualBundleId || '<empty>'}`,
        actualName === input.appName ? undefined : `name ${actualName || '<empty>'}`,
        actualVersion === input.version ? undefined : `version ${actualVersion || '<empty>'}`
      ].filter(Boolean).join('; ')
  )
}

const getInstalledDesktopAppRoot = (appPath: string) => path.join(appPath, 'Contents', 'Resources', 'app')

const verifyInstalledDesktopPackageVersion = async (input: {
  appPath: string
  version: string
}) => {
  const packageJsonPath = path.join(getInstalledDesktopAppRoot(input.appPath), 'package.json')
  const actual = await readPackageJsonVersion(packageJsonPath)
  const ok = actual === input.version
  return createCheck(
    'installed desktop package',
    ok,
    ok ? `${actual}` : `expected ${input.version}, got ${actual}`
  )
}

const verifyInstalledDesktopBuildSource = async (input: {
  appPath: string
  withoutBuildSource: boolean
}) => {
  const buildSourcePath = path.join(input.appPath, 'Contents', 'Resources', 'desktop-build-source.json')
  const exists = await fileExists(buildSourcePath)
  const ok = input.withoutBuildSource ? !exists : true
  return createCheck(
    'installed desktop build source',
    ok,
    ok
      ? input.withoutBuildSource ? 'absent' : exists ? 'present' : 'absent'
      : `release app should not include ${buildSourcePath}`
  )
}

const listPnpmPackageJsonCandidates = async (input: {
  appRoot: string
  packageName: string
}) => {
  const pnpmDir = path.join(input.appRoot, 'node_modules', '.pnpm')
  try {
    const entries = await readdir(pnpmDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => (
        path.join(pnpmDir, entry.name, 'node_modules', ...packageNamePathSegments(input.packageName), 'package.json')
      ))
  } catch {
    return []
  }
}

const findInstalledRuntimePackageJson = async (input: {
  appPath: string
  packageName: string
}) => {
  const appRoot = getInstalledDesktopAppRoot(input.appPath)
  const candidates = [
    path.join(appRoot, 'runtime-packages', ...packageNamePathSegments(input.packageName), 'package.json'),
    path.join(appRoot, 'node_modules', ...packageNamePathSegments(input.packageName), 'package.json'),
    ...await listPnpmPackageJsonCandidates({
      appRoot,
      packageName: input.packageName
    })
  ]

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}

const verifyInstalledRuntimePackage = async (input: {
  appPath: string
  expectedVersion: Promise<string>
  packageName: string
}) => {
  const packageJsonPath = await findInstalledRuntimePackageJson(input)
  if (packageJsonPath == null) {
    return createCheck(`installed runtime ${input.packageName}`, false, 'package.json not found in app bundle')
  }
  const expectedVersion = await input.expectedVersion
  const actual = await readPackageJsonVersion(packageJsonPath)
  const ok = actual === expectedVersion
  return createCheck(
    `installed runtime ${input.packageName}`,
    ok,
    ok ? `${actual}` : `expected ${expectedVersion}, got ${actual} (${packageJsonPath})`
  )
}

const verifyRuntimeCachePackage = async (input: {
  cacheVersion: string
  expectedVersion: Promise<string>
  homeDir: string
  packageCacheRoot?: string
  packageName: string
}) => {
  const packageJsonPath = input.packageName.startsWith(ADAPTER_PACKAGE_PREFIX)
    ? buildAdapterCachePackageJsonPath({
      homeDir: input.homeDir,
      packageCacheRoot: input.packageCacheRoot,
      packageName: input.packageName,
      version: input.cacheVersion
    })
    : buildNpmCachePackageJsonPath({
      homeDir: input.homeDir,
      packageCacheRoot: input.packageCacheRoot,
      packageName: input.packageName,
      version: input.cacheVersion
    })
  const expectedVersion = await input.expectedVersion
  const actual = await readPackageJsonVersion(packageJsonPath)
  const ok = actual === expectedVersion
  return createCheck(
    `runtime cache ${input.packageName}`,
    ok,
    ok ? `${actual}` : `expected ${expectedVersion}, got ${actual} (${packageJsonPath})`
  )
}

const verifyRuntimeEvidenceReply = async (input: {
  expectedReply?: string
  homeDir: string
  projectHome?: string
  sessionId?: string
  waitSessionMs: number
}, deps: ReleaseVerifyDeps) => {
  const result = await waitForRuntimeEvidenceReply({
    expectedReply: input.expectedReply,
    homeDir: input.homeDir,
    projectHome: input.projectHome,
    sessionId: input.sessionId,
    waitMs: input.waitSessionMs
  }, deps)
  return createCheck('runtime session reply', result.ok, result.message)
}

const formatCheck = (check: ReleaseVerifyCheck) => {
  const status = check.ok ? 'OK' : 'FAIL'
  const duration = check.durationMs == null ? '' : ` ${check.durationMs}ms`
  return `[release-verify] ${status}${duration} ${check.name}: ${check.message}`
}

export const formatReleaseVerifyResult = (result: ReleaseVerifyResult) =>
  [
    ...result.checks.map(formatCheck),
    `[release-verify] ${result.ok ? 'OK' : 'FAIL'} ${
      result.checks.filter(check => check.ok).length
    }/${result.checks.length} checks in ${result.elapsedMs}ms`
  ].join('\n')

const buildReleaseVerifyRecommendations = (result: ReleaseVerifyResult) => {
  const failedChecks = result.checks.filter(check => !check.ok)
  if (failedChecks.length === 0) return ['No follow-up required.']

  const recommendations = new Set<string>()
  for (const check of failedChecks) {
    if (check.name.startsWith('npm ')) {
      recommendations.add('Check npm publish status and dist-tags for the failed package.')
      continue
    }
    if (check.name.startsWith('runtime dist-tag ')) {
      recommendations.add(
        'Check whether the runtime package exists on the selected channel before validating app/cache contents.'
      )
      continue
    }
    if (check.name === 'desktop GitHub release') {
      recommendations.add('Check the desktop-package workflow and GitHub Release assets for the expected tag.')
      continue
    }
    if (check.name.startsWith('installed desktop') || check.name.startsWith('installed runtime')) {
      recommendations.add('Reinstall the downloaded release app, then rerun verification against the installed bundle.')
      continue
    }
    if (check.name.startsWith('runtime cache')) {
      recommendations.add(
        'Clear or reseed the specific bootstrap cache entry, then relaunch the app to materialize runtime packages.'
      )
      continue
    }
    if (check.name === 'runtime session reply' || check.name === 'desktop chat UI scenario') {
      recommendations.add(
        'Drive the Electron UI to create a workspace chat and send the nonce prompt; rerun agent verification to discover it automatically, or pass --session-id to shorten polling.'
      )
      continue
    }
    recommendations.add(`Inspect failed check: ${check.name}.`)
  }
  return [...recommendations]
}

export const formatReleaseVerifyRunResult = (result: ReleaseVerifyRunResult) => {
  const failedChecks = result.checks.filter(check => !check.ok)
  return [
    `[release-verify] Verdict: ${result.ok ? 'PASS' : 'FAIL'} in ${result.elapsedMs}ms`,
    `[release-verify] Target: ${result.channel} ${result.version} (${result.scenario})`,
    ...(result.uiAction == null ? [] : [`[release-verify] UI action: ${result.uiAction}`]),
    `[release-verify] Evidence: ${
      result.checks.filter(check => check.ok).length
    }/${result.checks.length} checks passed`,
    ...result.checks.map(formatCheck),
    ...(failedChecks.length === 0
      ? []
      : [
        '[release-verify] Recommendations:',
        ...result.recommendations.map(item => `- ${item}`)
      ])
  ].join('\n')
}

const buildScenarioChecks = (input: {
  discoverSession?: boolean
  expectedReply?: string
  scenario: ReleaseVerifyScenario
  sessionId?: string
}, deps: ReleaseVerifyDeps) => {
  if (input.scenario !== 'desktop-chat') return []
  if (input.sessionId != null && input.sessionId.trim() !== '') return []
  if (input.discoverSession === true && input.expectedReply != null && input.expectedReply.trim() !== '') return []

  const startedAt = deps.now()
  const reply = input.expectedReply?.trim()
  const prompt = reply == null || reply === ''
    ? 'Open the Electron app, create a workspace chat, send a release verification nonce, then pass --session-id.'
    : `Open the Electron app, create a workspace chat, ask it to reply with "${reply}", then pass --session-id.`
  return [
    createTimedCheck('desktop chat UI scenario', false, prompt, startedAt, deps)
  ]
}

const createReleaseVerifyNonce = (input: {
  channel: string
  deps: ReleaseVerifyDeps
}) => (
  `OK_RELEASE_VERIFY_${input.channel.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_${
    input.deps.now().toString(36).toUpperCase()
  }`
)

const buildDesktopChatUiAction = (expectedReply: string) => (
  `In the installed Electron app, open a clean workspace chat and send: Please reply with exactly ${expectedReply}`
)

export const runReleaseVerifyBeta = async (
  input: ReleaseVerifyBetaInput,
  deps: ReleaseVerifyDeps = defaultDeps
): Promise<ReleaseVerifyResult> => {
  const startedAt = deps.now()
  const version = normalizeVersion(input.version)
  const tag = input.tag ?? 'beta'
  const stdout = input.stdout ?? process.stdout
  const npmPackages = input.npmPackages?.length ? input.npmPackages : DEFAULT_RELEASE_VERIFY_NPM_PACKAGES
  const runtimePackages = input.runtimePackages?.length
    ? input.runtimePackages
    : DEFAULT_RELEASE_VERIFY_RUNTIME_PACKAGES
  const desktopAppPath = input.desktopAppPath ?? DEFAULT_DESKTOP_APP_PATH
  const npmDistTagVersions = new Map<string, Promise<string>>()
  const getNpmDistTagVersion = (packageName: string) => {
    const existing = npmDistTagVersions.get(packageName)
    if (existing != null) return existing
    const next = readNpmDistTagVersion({ packageName, tag }, deps)
    npmDistTagVersions.set(packageName, next)
    return next
  }
  const runtimeExpectedVersionMode = input.runtimeVersionMode ?? 'dist-tag'
  const runtimeExpectedVersions = new Map(
    runtimePackages.map(packageName => [
      packageName,
      runtimeExpectedVersionMode === 'exact'
        ? Promise.resolve(version)
        : getNpmDistTagVersion(packageName)
    ])
  )
  const getRuntimeExpectedVersion = (packageName: string) => (
    runtimeExpectedVersions.get(packageName) ?? Promise.resolve(version)
  )
  const checks = await Promise.all([
    ...npmPackages.map(packageName =>
      timedCheck(`npm ${packageName}@${tag}`, deps, () =>
        verifyNpmPackageTag({
          packageName,
          tag,
          version,
          actualVersion: getNpmDistTagVersion(packageName)
        }))
    ),
    ...(runtimeExpectedVersionMode === 'dist-tag'
      ? runtimePackages.map(packageName =>
        timedCheck(`runtime dist-tag ${packageName}@${tag}`, deps, () =>
          verifyRuntimeExpectedVersion({
            packageName,
            tag,
            expectedVersion: getRuntimeExpectedVersion(packageName)
          }))
      )
      : []),
    ...(input.desktopRelease === false ? [] : [
      timedCheck('desktop GitHub release', deps, () =>
        verifyGithubDesktopRelease({
          repo: input.repo ?? DEFAULT_RELEASE_VERIFY_REPO,
          version,
          assetNames: resolveDesktopReleaseAssetNames({
            version,
            assetNames: input.desktopAssetNames,
            archs: input.desktopAssetArchs,
            exts: input.desktopAssetExts
          })
        }, deps))
    ]),
    ...(input.desktopApp === false ? [] : [
      timedCheck('installed desktop metadata', deps, () =>
        verifyInstalledDesktopMetadata({
          appPath: desktopAppPath,
          appName: input.desktopAppName ?? DEFAULT_DESKTOP_APP_NAME,
          bundleId: input.desktopBundleId ?? DEFAULT_DESKTOP_BUNDLE_ID,
          version
        }, deps)),
      timedCheck('installed desktop package', deps, () =>
        verifyInstalledDesktopPackageVersion({
          appPath: desktopAppPath,
          version
        })),
      timedCheck('installed desktop build source', deps, () =>
        verifyInstalledDesktopBuildSource({
          appPath: desktopAppPath,
          withoutBuildSource: input.withoutBuildSource ?? true
        })),
      ...runtimePackages.map(packageName =>
        timedCheck(`installed runtime ${packageName}`, deps, () =>
          verifyInstalledRuntimePackage({
            appPath: desktopAppPath,
            packageName,
            expectedVersion: getRuntimeExpectedVersion(packageName)
          }))
      )
    ]),
    ...(input.runtimeCache === false
      ? []
      : runtimePackages.map(packageName =>
        timedCheck(`runtime cache ${packageName}`, deps, () =>
          verifyRuntimeCachePackage({
            homeDir: input.runtimeCacheHome ?? deps.homeDir(),
            packageCacheRoot: input.packageCacheRoot,
            packageName,
            cacheVersion: version,
            expectedVersion: getRuntimeExpectedVersion(packageName)
          }))
      )),
    ...(input.sessionId == null ? [] : [
      timedCheck('runtime session reply', deps, () =>
        verifyRuntimeEvidenceReply({
          sessionId: input.sessionId ?? '',
          expectedReply: input.expectedReply,
          projectHome: input.projectHome,
          homeDir: input.runtimeCacheHome ?? deps.homeDir(),
          waitSessionMs: input.waitSessionMs ?? 60_000
        }, deps))
    ]),
    ...(input.sessionId == null && input.expectedReply != null && input.discoverSession === true
      ? [
        timedCheck('runtime session reply', deps, () =>
          verifyRuntimeEvidenceReply({
            expectedReply: input.expectedReply ?? '',
            projectHome: input.projectHome,
            homeDir: input.runtimeCacheHome ?? deps.homeDir(),
            waitSessionMs: input.waitSessionMs ?? 60_000
          }, deps))
      ]
      : []),
    ...(input.expectedReply != null && input.sessionId == null && input.discoverSession !== true
      ? [
        Promise.resolve(createCheck('runtime session reply', false, '--expected-reply requires --session-id'))
      ]
      : [])
  ])
  const result = {
    checks,
    elapsedMs: deps.now() - startedAt,
    ok: checks.every(check => check.ok)
  }

  if (input.emit !== false) {
    if (input.json) {
      stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      stdout.write(`${formatReleaseVerifyResult(result)}\n`)
    }
  }
  if (!result.ok && input.setExitCode !== false) {
    process.exitCode = 1
  }
  return result
}

export const runReleaseVerify = async (
  input: ReleaseVerifyRunInput,
  deps: ReleaseVerifyDeps = defaultDeps
): Promise<ReleaseVerifyRunResult> => {
  const channel = input.channel ?? input.tag ?? 'beta'
  const scenario = input.scenario ?? (input.sessionId == null ? 'desktop-installed' : 'desktop-chat')
  const version = await resolveReleaseVerifyVersion({
    channel,
    version: input.version
  }, deps)
  const probeResult = await runReleaseVerifyBeta({
    ...input,
    tag: channel,
    version,
    emit: false,
    setExitCode: false
  }, deps)
  const scenarioChecks = buildScenarioChecks({
    scenario,
    sessionId: input.sessionId,
    expectedReply: input.expectedReply,
    discoverSession: input.discoverSession
  }, deps)
  const checks = [
    ...probeResult.checks,
    ...scenarioChecks
  ]
  const result: ReleaseVerifyRunResult = {
    ...probeResult,
    channel,
    checks,
    expectedReply: input.expectedReply,
    ok: checks.every(check => check.ok),
    recommendations: [],
    scenario,
    uiAction: scenario === 'desktop-chat' && input.expectedReply != null
      ? buildDesktopChatUiAction(input.expectedReply)
      : undefined,
    version
  }
  result.recommendations = buildReleaseVerifyRecommendations(result)

  const stdout = input.stdout ?? process.stdout
  if (input.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    stdout.write(`${formatReleaseVerifyRunResult(result)}\n`)
  }
  if (!result.ok && input.setExitCode !== false) {
    process.exitCode = 1
  }

  return result
}

export const runReleaseVerifyAgent = async (
  input: ReleaseVerifyAgentInput,
  deps: ReleaseVerifyDeps = defaultDeps
) => {
  const channel = input.channel ?? input.tag ?? 'beta'
  const scenario = input.scenario ?? 'desktop-chat'
  const expectedReply = scenario === 'desktop-chat'
    ? input.expectedReply?.trim() || createReleaseVerifyNonce({ channel, deps })
    : input.sessionId == null
    ? undefined
    : input.expectedReply?.trim()
  const stdout = input.stdout ?? process.stdout
  const uiAction = scenario === 'desktop-chat' && expectedReply != null
    ? buildDesktopChatUiAction(expectedReply)
    : undefined

  if (!input.json && uiAction != null) {
    stdout.write(`[release-verify] UI action: ${uiAction}\n`)
    stdout.write('[release-verify] Waiting for runtime evidence; session id is optional.\n')
  }

  return await runReleaseVerify({
    ...input,
    channel,
    scenario,
    expectedReply,
    discoverSession: scenario === 'desktop-chat',
    stdout
  }, deps)
}
