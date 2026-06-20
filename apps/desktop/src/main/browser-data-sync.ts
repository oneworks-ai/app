/* eslint-disable max-lines -- browser data sync keeps parser, merge logic, and encrypted vault wiring together. */
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { BrowserWindow, app, clipboard, dialog, safeStorage, systemPreferences } from 'electron'
import type { WebContents } from 'electron'

type OtpType = 'hotp' | 'totp'

type SupportedBrowserPasswordPlatform = 'darwin' | 'win32'
type BrowserPasswordImportSourceId =
  | 'arc'
  | 'brave'
  | 'chromium'
  | 'google-chrome'
  | 'microsoft-edge'
  | 'vivaldi'
type BrowserPasswordSourceName =
  | 'Arc'
  | 'Brave'
  | 'Chromium'
  | 'Google Chrome'
  | 'Microsoft Edge'
  | 'Vivaldi'
type PasswordImportSourceId = BrowserPasswordImportSourceId | 'csv'
type PasswordSourceName = BrowserPasswordSourceName | 'CSV File'

interface AuthenticatorVaultEntry {
  accountName?: string
  algorithm: string
  counter?: number
  digits: number
  id: string
  importedAt: string
  issuer?: string
  period?: number
  secret: string
  type: OtpType
}

interface PasswordVaultEntry {
  actionUrl?: string
  dateCreated?: number
  id: string
  importedAt: string
  note?: string
  originUrl: string
  password: string
  signonRealm?: string
  sourceBrowser: PasswordSourceName
  sourceProfile: string
  updatedAt?: string
  username: string
}

interface BrowserDataVault {
  authenticatorEntries: AuthenticatorVaultEntry[]
  passwordEntries: PasswordVaultEntry[]
  updatedAt?: string
  version: 1
}

interface BrowserDataVaultFile {
  encryptedData: string
  encryption: 'electron-safe-storage'
  updatedAt?: string
  version: 1
}

export interface BrowserDataSyncState {
  authenticator: {
    total: number
    updatedAt?: string
  }
  savedPasswords: {
    total: number
    updatedAt?: string
  }
}

export interface AuthenticatorImportResult {
  canceled: boolean
  fileName?: string
  imported: number
  skipped: number
  total: number
  updated: number
}

export interface BrowserPasswordImportResult {
  canceled: boolean
  duplicates: number
  failed: number
  imported: number
  profiles: number
  sourceId: PasswordImportSourceId
  sourceName: PasswordSourceName
  skipped: number
  total: number
  updated: number
}

export type ChromePasswordImportResult = BrowserPasswordImportResult

export interface PasswordCsvImportResult extends BrowserPasswordImportResult {
  fileName?: string
  sourceId: 'csv'
  sourceName: 'CSV File'
}

export interface BrowserPasswordImportSource {
  icon: string
  id: BrowserPasswordImportSourceId
  name: BrowserPasswordSourceName
  profiles: number
}

export interface SavedPasswordRecord {
  actionUrl?: string
  dateCreated?: number
  id: string
  importedAt: string
  note?: string
  originUrl: string
  signonRealm?: string
  sourceBrowser: PasswordSourceName
  sourceProfile: string
  updatedAt?: string
  username: string
}

export interface SavedPasswordAccessAuthenticationResult {
  authenticated: boolean
  expiresAt: string
  method: 'cached' | 'touch-id'
}

type BrowserPasswordDuplicateResolution = 'ask' | 'overwrite' | 'skip'

interface BrowserPasswordImportOptions {
  duplicateResolution: BrowserPasswordDuplicateResolution
  sourceId: BrowserPasswordImportSourceId
}

interface BrowserPasswordImportSourceConfig {
  applicationPaths: Record<SupportedBrowserPasswordPlatform, (homeDirectory: string) => string[]>
  icon: string
  id: BrowserPasswordImportSourceId
  keychainAccount: string
  keychainService: string
  name: BrowserPasswordSourceName
  userDataDirectories: Record<SupportedBrowserPasswordPlatform, (homeDirectory: string) => string[]>
}

interface SavedPasswordUpdateInput {
  note?: string
  originUrl?: string
  password?: string
  username?: string
}

const browserDataVaultVersion = 1
const savedPasswordsAccessTtlMs = 5 * 60 * 1000
const execFileAsync = promisify(execFile)

let savedPasswordsAccessAuthenticatedUntil = 0
let savedPasswordsRuntimeSettings = {
  autoSignIn: true,
  requireAuth: true
}

const browserPasswordImportSourceConfigs: BrowserPasswordImportSourceConfig[] = [
  {
    applicationPaths: {
      darwin: homeDirectory => [
        '/Applications/Google Chrome.app',
        path.join(homeDirectory, 'Applications', 'Google Chrome.app')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          ...getWindowsProgramFilesDirectories().map(directory =>
            path.join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe')
          ),
          path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
        ]
      }
    },
    icon: 'public',
    id: 'google-chrome',
    keychainAccount: 'Chrome',
    keychainService: 'Chrome Safe Storage',
    name: 'Google Chrome',
    userDataDirectories: {
      darwin: homeDirectory => [path.join(homeDirectory, 'Library', 'Application Support', 'Google', 'Chrome')],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [path.join(localAppData, 'Google', 'Chrome', 'User Data')]
      }
    }
  },
  {
    applicationPaths: {
      darwin: homeDirectory => [
        '/Applications/Microsoft Edge.app',
        path.join(homeDirectory, 'Applications', 'Microsoft Edge.app')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          ...getWindowsProgramFilesDirectories().map(directory =>
            path.join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
          ),
          path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ]
      }
    },
    icon: 'travel_explore',
    id: 'microsoft-edge',
    keychainAccount: 'Microsoft Edge',
    keychainService: 'Microsoft Edge Safe Storage',
    name: 'Microsoft Edge',
    userDataDirectories: {
      darwin: homeDirectory => [path.join(homeDirectory, 'Library', 'Application Support', 'Microsoft Edge')],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [path.join(localAppData, 'Microsoft', 'Edge', 'User Data')]
      }
    }
  },
  {
    applicationPaths: {
      darwin: homeDirectory => [
        '/Applications/Brave Browser.app',
        path.join(homeDirectory, 'Applications', 'Brave Browser.app')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          ...getWindowsProgramFilesDirectories().map(directory =>
            path.join(directory, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
          ),
          path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
        ]
      }
    },
    icon: 'shield',
    id: 'brave',
    keychainAccount: 'Brave',
    keychainService: 'Brave Safe Storage',
    name: 'Brave',
    userDataDirectories: {
      darwin: homeDirectory => [
        path.join(homeDirectory, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data')]
      }
    }
  },
  {
    applicationPaths: {
      darwin: homeDirectory => [
        '/Applications/Arc.app',
        path.join(homeDirectory, 'Applications', 'Arc.app')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          path.join(localAppData, 'Microsoft', 'WindowsApps', 'Arc.exe'),
          path.join(
            localAppData,
            'Packages',
            'TheBrowserCompany.Arc_ttt1ap7aakyb4',
            'LocalCache',
            'Local',
            'Microsoft',
            'WindowsApps',
            'Arc.exe'
          )
        ]
      }
    },
    icon: 'gesture',
    id: 'arc',
    keychainAccount: 'Arc',
    keychainService: 'Arc Safe Storage',
    name: 'Arc',
    userDataDirectories: {
      darwin: homeDirectory => [
        path.join(homeDirectory, 'Library', 'Application Support', 'Arc', 'User Data'),
        path.join(homeDirectory, 'Library', 'Application Support', 'Arc')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          path.join(
            localAppData,
            'Packages',
            'TheBrowserCompany.Arc_ttt1ap7aakyb4',
            'LocalCache',
            'Local',
            'Arc',
            'User Data'
          ),
          path.join(localAppData, 'Arc', 'User Data')
        ]
      }
    }
  },
  {
    applicationPaths: {
      darwin: homeDirectory => [
        '/Applications/Vivaldi.app',
        path.join(homeDirectory, 'Applications', 'Vivaldi.app')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          ...getWindowsProgramFilesDirectories().map(directory =>
            path.join(directory, 'Vivaldi', 'Application', 'vivaldi.exe')
          ),
          path.join(localAppData, 'Vivaldi', 'Application', 'vivaldi.exe')
        ]
      }
    },
    icon: 'explore',
    id: 'vivaldi',
    keychainAccount: 'Vivaldi',
    keychainService: 'Vivaldi Safe Storage',
    name: 'Vivaldi',
    userDataDirectories: {
      darwin: homeDirectory => [path.join(homeDirectory, 'Library', 'Application Support', 'Vivaldi')],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [path.join(localAppData, 'Vivaldi', 'User Data')]
      }
    }
  },
  {
    applicationPaths: {
      darwin: homeDirectory => [
        '/Applications/Chromium.app',
        path.join(homeDirectory, 'Applications', 'Chromium.app')
      ],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [
          ...getWindowsProgramFilesDirectories().map(directory =>
            path.join(directory, 'Chromium', 'Application', 'chrome.exe')
          ),
          path.join(localAppData, 'Chromium', 'Application', 'chrome.exe')
        ]
      }
    },
    icon: 'hub',
    id: 'chromium',
    keychainAccount: 'Chromium',
    keychainService: 'Chromium Safe Storage',
    name: 'Chromium',
    userDataDirectories: {
      darwin: homeDirectory => [path.join(homeDirectory, 'Library', 'Application Support', 'Chromium')],
      win32: () => {
        const localAppData = getWindowsLocalAppDataDirectory()
        return [path.join(localAppData, 'Chromium', 'User Data')]
      }
    }
  }
]

const getBrowserDataVaultPath = () => path.join(app.getPath('userData'), 'browser-data-vault.json')

const emptyVault = (): BrowserDataVault => ({
  authenticatorEntries: [],
  passwordEntries: [],
  version: browserDataVaultVersion
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isPasswordSourceName = (value: unknown): value is PasswordSourceName => (
  typeof value === 'string' &&
  (value === 'CSV File' || browserPasswordImportSourceConfigs.some(source => source.name === value))
)

const isBrowserPasswordImportSourceId = (value: unknown): value is BrowserPasswordImportSourceId => (
  typeof value === 'string' &&
  browserPasswordImportSourceConfigs.some(source => source.id === value)
)

const readVaultFile = async (): Promise<BrowserDataVaultFile | undefined> => {
  try {
    const rawValue = await readFile(getBrowserDataVaultPath(), 'utf8')
    const parsed = JSON.parse(rawValue) as unknown
    if (!isRecord(parsed) || parsed.version !== browserDataVaultVersion) return undefined
    if (parsed.encryption !== 'electron-safe-storage' || typeof parsed.encryptedData !== 'string') return undefined
    return {
      encryptedData: parsed.encryptedData,
      encryption: 'electron-safe-storage',
      ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
      version: browserDataVaultVersion
    }
  } catch {
    return undefined
  }
}

const readVault = async (): Promise<BrowserDataVault> => {
  const vaultFile = await readVaultFile()
  if (vaultFile == null) return emptyVault()

  try {
    const decrypted = safeStorage.decryptString(Buffer.from(vaultFile.encryptedData, 'base64'))
    const parsed = JSON.parse(decrypted) as unknown
    if (!isRecord(parsed) || parsed.version !== browserDataVaultVersion) return emptyVault()
    const authenticatorEntries = Array.isArray(parsed.authenticatorEntries)
      ? parsed.authenticatorEntries.flatMap(normalizeStoredAuthenticatorEntry)
      : []
    const passwordEntries = Array.isArray(parsed.passwordEntries)
      ? parsed.passwordEntries.flatMap(normalizeStoredPasswordEntry)
      : []
    return {
      authenticatorEntries,
      passwordEntries,
      ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : vaultFile.updatedAt == null
        ? {}
        : { updatedAt: vaultFile.updatedAt }),
      version: browserDataVaultVersion
    }
  } catch {
    return emptyVault()
  }
}

const writeVault = async (vault: BrowserDataVault) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Desktop secure storage is unavailable.')
  }

  const updatedAt = new Date().toISOString()
  const normalizedVault: BrowserDataVault = {
    authenticatorEntries: vault.authenticatorEntries,
    passwordEntries: vault.passwordEntries,
    updatedAt,
    version: browserDataVaultVersion
  }
  const encryptedData = safeStorage.encryptString(JSON.stringify(normalizedVault)).toString('base64')
  const vaultFile: BrowserDataVaultFile = {
    encryptedData,
    encryption: 'electron-safe-storage',
    updatedAt,
    version: browserDataVaultVersion
  }
  const vaultPath = getBrowserDataVaultPath()
  await mkdir(path.dirname(vaultPath), { recursive: true })
  await writeFile(vaultPath, `${JSON.stringify(vaultFile, null, 2)}\n`)
}

const normalizePositiveInteger = (
  value: unknown,
  fallback: number,
  input: {
    max?: number
    min?: number
  } = {}
) => {
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string'
    ? Number.parseInt(value, 10)
    : Number.NaN
  const min = input.min ?? 1
  const max = input.max ?? Number.MAX_SAFE_INTEGER
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) return fallback
  return normalized
}

const normalizeSecret = (value: string) => value.replace(/\s+/g, '').toUpperCase()

const normalizeAlgorithm = (value: string | null) => {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'SHA256' || normalized === 'SHA512') return normalized
  return 'SHA1'
}

const decodeOtpLabel = (pathname: string) => {
  const label = pathname.replace(/^\/+/, '')
  try {
    return decodeURIComponent(label)
  } catch {
    return label
  }
}

const splitOtpLabel = (label: string) => {
  const separatorIndex = label.indexOf(':')
  if (separatorIndex < 0) {
    return {
      accountName: label.trim() || undefined,
      issuer: undefined
    }
  }

  return {
    accountName: label.slice(separatorIndex + 1).trim() || undefined,
    issuer: label.slice(0, separatorIndex).trim() || undefined
  }
}

const buildAuthenticatorEntryId = (entry: Omit<AuthenticatorVaultEntry, 'id' | 'importedAt'>) => (
  createHash('sha256')
    .update([
      entry.type,
      entry.issuer ?? '',
      entry.accountName ?? '',
      entry.secret,
      entry.algorithm,
      String(entry.digits),
      String(entry.period ?? ''),
      String(entry.counter ?? '')
    ].join('\n'))
    .digest('hex')
)

const normalizeStoredAuthenticatorEntry = (value: unknown): AuthenticatorVaultEntry[] => {
  if (!isRecord(value)) return []
  if (value.type !== 'totp' && value.type !== 'hotp') return []
  if (typeof value.secret !== 'string' || normalizeSecret(value.secret) === '') return []
  if (typeof value.id !== 'string' || value.id.trim() === '') return []
  if (typeof value.importedAt !== 'string' || value.importedAt.trim() === '') return []

  const entry: AuthenticatorVaultEntry = {
    algorithm: normalizeAlgorithm(typeof value.algorithm === 'string' ? value.algorithm : null),
    digits: normalizePositiveInteger(value.digits, 6, { max: 10, min: 1 }),
    id: value.id,
    importedAt: value.importedAt,
    secret: normalizeSecret(value.secret),
    type: value.type
  }
  if (typeof value.accountName === 'string' && value.accountName.trim() !== '') {
    entry.accountName = value.accountName.trim()
  }
  if (typeof value.issuer === 'string' && value.issuer.trim() !== '') {
    entry.issuer = value.issuer.trim()
  }
  if (value.type === 'totp') {
    entry.period = normalizePositiveInteger(value.period, 30, { max: 3600, min: 1 })
  }
  if (value.type === 'hotp') {
    entry.counter = normalizePositiveInteger(value.counter, 0, { min: 0 })
  }
  return [entry]
}

const normalizeStoredPasswordEntry = (value: unknown): PasswordVaultEntry[] => {
  if (!isRecord(value)) return []
  if (typeof value.id !== 'string' || value.id.trim() === '') return []
  if (!isPasswordSourceName(value.sourceBrowser)) return []
  if (typeof value.sourceProfile !== 'string' || value.sourceProfile.trim() === '') return []
  if (typeof value.originUrl !== 'string' || value.originUrl.trim() === '') return []
  if (typeof value.username !== 'string') return []
  if (typeof value.password !== 'string' || value.password === '') return []
  if (typeof value.importedAt !== 'string' || value.importedAt.trim() === '') return []

  const entry: PasswordVaultEntry = {
    id: value.id,
    importedAt: value.importedAt,
    originUrl: value.originUrl,
    password: value.password,
    sourceBrowser: value.sourceBrowser,
    sourceProfile: value.sourceProfile,
    username: value.username
  }
  if (typeof value.actionUrl === 'string' && value.actionUrl.trim() !== '') {
    entry.actionUrl = value.actionUrl
  }
  if (typeof value.note === 'string' && value.note.trim() !== '') {
    entry.note = value.note.trim()
  }
  if (typeof value.signonRealm === 'string' && value.signonRealm.trim() !== '') {
    entry.signonRealm = value.signonRealm
  }
  if (typeof value.dateCreated === 'number' && Number.isFinite(value.dateCreated)) {
    entry.dateCreated = value.dateCreated
  }
  if (typeof value.updatedAt === 'string' && value.updatedAt.trim() !== '') {
    entry.updatedAt = value.updatedAt
  }
  return [entry]
}

const parseOtpAuthUri = (value: string): AuthenticatorVaultEntry | undefined => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  if (url.protocol !== 'otpauth:') return undefined
  const type = url.hostname.toLowerCase()
  if (type !== 'totp' && type !== 'hotp') return undefined

  const secret = normalizeSecret(url.searchParams.get('secret') ?? '')
  if (!/^[A-Z2-7]+=*$/.test(secret)) return undefined

  const labelParts = splitOtpLabel(decodeOtpLabel(url.pathname))
  const issuer = url.searchParams.get('issuer')?.trim() || labelParts.issuer
  const accountName = labelParts.accountName
  const entryWithoutId = {
    ...(accountName == null ? {} : { accountName }),
    algorithm: normalizeAlgorithm(url.searchParams.get('algorithm')),
    ...(type === 'hotp'
      ? { counter: normalizePositiveInteger(url.searchParams.get('counter'), 0, { min: 0 }) }
      : { period: normalizePositiveInteger(url.searchParams.get('period'), 30, { max: 3600, min: 1 }) }),
    digits: normalizePositiveInteger(url.searchParams.get('digits'), 6, { max: 10, min: 1 }),
    ...(issuer == null ? {} : { issuer }),
    secret,
    type
  } satisfies Omit<AuthenticatorVaultEntry, 'id' | 'importedAt'>

  return {
    ...entryWithoutId,
    id: buildAuthenticatorEntryId(entryWithoutId),
    importedAt: new Date().toISOString()
  }
}

const extractOtpAuthCandidates = (content: string) => {
  const candidates = new Set<string>()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.toLowerCase().startsWith('otpauth://')) {
      candidates.add(trimmed)
    }
  }

  for (const match of content.match(/otpauth:\/\/[^\s"'<>]+/gi) ?? []) {
    candidates.add(match.trim().replace(/[,;\]]+$/u, ''))
  }
  return [...candidates]
}

const parseAuthenticatorBackup = (content: string) => (
  extractOtpAuthCandidates(content).flatMap(candidate => {
    const entry = parseOtpAuthUri(candidate)
    return entry == null ? [] : [entry]
  })
)

const mergeAuthenticatorEntries = (
  currentEntries: AuthenticatorVaultEntry[],
  importedEntries: AuthenticatorVaultEntry[]
) => {
  const entriesById = new Map(currentEntries.map(entry => [entry.id, entry]))
  let imported = 0
  let skipped = 0
  let updated = 0

  for (const entry of importedEntries) {
    const existing = entriesById.get(entry.id)
    if (existing == null) {
      entriesById.set(entry.id, entry)
      imported += 1
      continue
    }
    if (
      existing.issuer === entry.issuer &&
      existing.accountName === entry.accountName &&
      existing.algorithm === entry.algorithm &&
      existing.digits === entry.digits &&
      existing.period === entry.period &&
      existing.counter === entry.counter
    ) {
      skipped += 1
      continue
    }
    entriesById.set(entry.id, {
      ...existing,
      ...entry,
      importedAt: existing.importedAt
    })
    updated += 1
  }

  return {
    entries: [...entriesById.values()],
    imported,
    skipped,
    updated
  }
}

const runCommand = async (
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
  } = {}
) => {
  const { stdout } = await execFileAsync(command, args, {
    env: options.env,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  })
  return String(stdout)
}

const pathExists = async (filePath: string) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const readJsonFile = async (filePath: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

const getSupportedBrowserPasswordPlatform = (): SupportedBrowserPasswordPlatform => {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  throw new Error('Browser password sync is not supported on this platform yet.')
}

const getWindowsLocalAppDataDirectory = () => {
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData == null || localAppData.trim() === '') {
    throw new Error('LOCALAPPDATA is not available.')
  }
  return localAppData
}

const getWindowsProgramFilesDirectories = () =>
  [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)']
  ].flatMap(directory => directory == null || directory.trim() === '' ? [] : [directory])

const getBrowserPasswordImportSourceConfig = (sourceId: BrowserPasswordImportSourceId) => {
  const source = browserPasswordImportSourceConfigs.find(item => item.id === sourceId)
  if (source == null) {
    throw new Error('Unsupported browser password source.')
  }
  return source
}

const getBrowserUserDataDirectoryCandidates = (
  source: BrowserPasswordImportSourceConfig,
  platform: SupportedBrowserPasswordPlatform
) => source.userDataDirectories[platform](app.getPath('home'))

const getBrowserApplicationPathCandidates = (
  source: BrowserPasswordImportSourceConfig,
  platform: SupportedBrowserPasswordPlatform
) => source.applicationPaths[platform](app.getPath('home'))

const isBrowserApplicationInstalled = async (
  source: BrowserPasswordImportSourceConfig,
  platform: SupportedBrowserPasswordPlatform
) => {
  for (const applicationPath of getBrowserApplicationPathCandidates(source, platform)) {
    if (await pathExists(applicationPath)) return true
  }
  return false
}

const getExistingBrowserUserDataDirectories = async (
  source: BrowserPasswordImportSourceConfig,
  platform: SupportedBrowserPasswordPlatform
) => {
  const directories: string[] = []
  for (const directory of getBrowserUserDataDirectoryCandidates(source, platform)) {
    if (directories.includes(directory)) continue
    if (await pathExists(directory)) {
      directories.push(directory)
    }
  }
  return directories
}

interface ChromeProfileDescriptor {
  dirName: string
  loginDataPath: string
  name: string
}

const getChromeProfileDescriptorsForDirectory = async (
  userDataDirectory: string,
  localState: unknown
): Promise<ChromeProfileDescriptor[]> => {
  const profileInfoCache = isRecord(localState) &&
      isRecord(localState.profile) &&
      isRecord(localState.profile.info_cache)
    ? localState.profile.info_cache
    : {}
  const descriptorsByDir = new Map<string, ChromeProfileDescriptor>()
  for (const [dirName, profileInfo] of Object.entries(profileInfoCache)) {
    if (dirName.trim() === '') continue
    const loginDataPath = path.join(userDataDirectory, dirName, 'Login Data')
    if (!await pathExists(loginDataPath)) continue
    descriptorsByDir.set(dirName, {
      dirName,
      loginDataPath,
      name: isRecord(profileInfo) && typeof profileInfo.name === 'string' && profileInfo.name.trim() !== ''
        ? profileInfo.name.trim()
        : dirName
    })
  }

  const entries = await readdir(userDataDirectory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name !== 'Default' && !/^Profile \d+$/u.test(entry.name)) continue
    if (descriptorsByDir.has(entry.name)) continue
    const loginDataPath = path.join(userDataDirectory, entry.name, 'Login Data')
    if (!await pathExists(loginDataPath)) continue
    descriptorsByDir.set(entry.name, {
      dirName: entry.name,
      loginDataPath,
      name: entry.name
    })
  }

  return [...descriptorsByDir.values()]
}

const getBrowserProfileDescriptors = async (
  source: BrowserPasswordImportSourceConfig,
  platform: SupportedBrowserPasswordPlatform
) => {
  const descriptors: Array<ChromeProfileDescriptor & { userDataDirectory: string }> = []
  const directories = await getExistingBrowserUserDataDirectories(source, platform)
  for (const userDataDirectory of directories) {
    const localState = await readJsonFile(path.join(userDataDirectory, 'Local State'))
    const profiles = await getChromeProfileDescriptorsForDirectory(userDataDirectory, localState)
    descriptors.push(...profiles.map(profile => ({ ...profile, userDataDirectory })))
  }
  return descriptors
}

const getBrowserProfileDescriptorGroups = async (
  source: BrowserPasswordImportSourceConfig,
  platform: SupportedBrowserPasswordPlatform
) => {
  const groups: Array<{
    localState: unknown
    profiles: ChromeProfileDescriptor[]
    userDataDirectory: string
  }> = []
  const directories = await getExistingBrowserUserDataDirectories(source, platform)
  for (const userDataDirectory of directories) {
    const localState = await readJsonFile(path.join(userDataDirectory, 'Local State'))
    const profiles = await getChromeProfileDescriptorsForDirectory(userDataDirectory, localState)
    if (profiles.length === 0) continue
    groups.push({
      localState,
      profiles,
      userDataDirectory
    })
  }
  return groups
}

const sqliteQuotePath = (filePath: string) => `'${filePath.replace(/'/gu, "''")}'`

const ensureSqliteCommand = async () => {
  try {
    await runCommand('sqlite3', ['-version'])
  } catch {
    throw new Error('sqlite3 is required to read Chromium browser password storage.')
  }
}

const backupSqliteDatabase = async (sourcePath: string, targetPath: string) => {
  try {
    await runCommand('sqlite3', ['-readonly', sourcePath, `.backup ${sqliteQuotePath(targetPath)}`])
  } catch {
    await copyFile(sourcePath, targetPath)
  }
}

interface ChromeLoginRow {
  actionUrl?: string
  dateCreated?: number
  originUrl: string
  passwordValueHex: string
  signonRealm?: string
  username?: string
}

const normalizeChromeLoginRow = (value: unknown): ChromeLoginRow[] => {
  if (!isRecord(value)) return []
  if (typeof value.originUrl !== 'string' || value.originUrl.trim() === '') return []
  if (typeof value.passwordValueHex !== 'string' || value.passwordValueHex.trim() === '') return []
  return [{
    ...(typeof value.actionUrl === 'string' && value.actionUrl.trim() !== '' ? { actionUrl: value.actionUrl } : {}),
    ...(typeof value.dateCreated === 'number' && Number.isFinite(value.dateCreated)
      ? { dateCreated: value.dateCreated }
      : {}),
    originUrl: value.originUrl,
    passwordValueHex: value.passwordValueHex,
    ...(typeof value.signonRealm === 'string' && value.signonRealm.trim() !== ''
      ? { signonRealm: value.signonRealm }
      : {}),
    username: typeof value.username === 'string' ? value.username : ''
  }]
}

const queryChromeLoginRows = async (loginDataPath: string): Promise<ChromeLoginRow[]> => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'oneworks-chrome-passwords-'))
  const tempDbPath = path.join(tempDirectory, 'Login Data')
  try {
    await backupSqliteDatabase(loginDataPath, tempDbPath)
    const output = await runCommand('sqlite3', [
      '-readonly',
      '-json',
      tempDbPath,
      `SELECT
        origin_url AS originUrl,
        action_url AS actionUrl,
        username_value AS username,
        hex(password_value) AS passwordValueHex,
        signon_realm AS signonRealm,
        date_created AS dateCreated
      FROM logins
      WHERE blacklisted_by_user = 0
        AND length(password_value) > 0`
    ])
    const parsed = JSON.parse(output.trim() === '' ? '[]' : output) as unknown
    return Array.isArray(parsed) ? parsed.flatMap(normalizeChromeLoginRow) : []
  } finally {
    await rm(tempDirectory, { force: true, recursive: true })
  }
}

const hasChromeEncryptedValuePrefix = (encryptedValue: Buffer) => (
  encryptedValue.length > 3 &&
  /^v\d\d$/u.test(encryptedValue.subarray(0, 3).toString('utf8'))
)

const decryptAesCbc = (encryptedValue: Buffer, key: Buffer) => {
  const payload = hasChromeEncryptedValuePrefix(encryptedValue)
    ? encryptedValue.subarray(3)
    : encryptedValue
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
}

const decryptAesGcm = (encryptedValue: Buffer, key: Buffer) => {
  if (!hasChromeEncryptedValuePrefix(encryptedValue) || encryptedValue.length <= 31) {
    throw new Error('Unsupported Chromium browser AES-GCM password payload.')
  }
  const nonce = encryptedValue.subarray(3, 15)
  const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16)
  const authTag = encryptedValue.subarray(encryptedValue.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

const getMacBrowserSafeStoragePassword = async (source: BrowserPasswordImportSourceConfig) => {
  const attempts = [
    ['find-generic-password', '-w', '-s', source.keychainService, '-a', source.keychainAccount],
    ['find-generic-password', '-w', '-s', source.keychainService]
  ]
  for (const args of attempts) {
    try {
      const output = await runCommand('security', args)
      const password = output.trim()
      if (password !== '') return password
    } catch {
      // Try the next keychain lookup shape.
    }
  }
  throw new Error(`${source.name} Safe Storage key was not available in Keychain.`)
}

const createMacBrowserPasswordDecryptor = async (source: BrowserPasswordImportSourceConfig) => {
  const keychainPassword = await getMacBrowserSafeStoragePassword(source)
  const key = pbkdf2Sync(Buffer.from(keychainPassword, 'utf8'), Buffer.from('saltysalt'), 1003, 16, 'sha1')
  return (encryptedValue: Buffer) => decryptAesCbc(encryptedValue, key)
}

const getWindowsPowerShellCommand = () => (
  process.env.SystemRoot == null || process.env.SystemRoot.trim() === ''
    ? 'powershell.exe'
    : path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
)

const decryptWindowsDpapi = async (encryptedValue: Buffer) => {
  const script = [
    'Add-Type -AssemblyName System.Security;',
    '$bytes = [Convert]::FromBase64String($env:ONEWORKS_DPAPI_INPUT);',
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect(',
    '$bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Convert]::ToBase64String($plain)'
  ].join('')
  const output = await runCommand(getWindowsPowerShellCommand(), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ], {
    env: {
      ...process.env,
      ONEWORKS_DPAPI_INPUT: encryptedValue.toString('base64')
    }
  })
  return Buffer.from(output.trim(), 'base64')
}

const getWindowsBrowserAesKey = async (localState: unknown, source: BrowserPasswordImportSourceConfig) => {
  const encryptedKey = isRecord(localState) &&
      isRecord(localState.os_crypt) &&
      typeof localState.os_crypt.encrypted_key === 'string'
    ? localState.os_crypt.encrypted_key
    : ''
  if (encryptedKey.trim() === '') {
    throw new Error(`${source.name} encrypted key is not available.`)
  }

  const rawKey = Buffer.from(encryptedKey, 'base64')
  const dpapiPayload = rawKey.subarray(0, 5).toString('utf8') === 'DPAPI'
    ? rawKey.subarray(5)
    : rawKey
  return await decryptWindowsDpapi(dpapiPayload)
}

const createWindowsBrowserPasswordDecryptor = async (
  localState: unknown,
  source: BrowserPasswordImportSourceConfig
) => {
  const aesKey = await getWindowsBrowserAesKey(localState, source)
  return async (encryptedValue: Buffer) => {
    if (hasChromeEncryptedValuePrefix(encryptedValue)) {
      return decryptAesGcm(encryptedValue, aesKey)
    }
    return (await decryptWindowsDpapi(encryptedValue)).toString('utf8')
  }
}

const createBrowserPasswordDecryptor = async (
  platform: SupportedBrowserPasswordPlatform,
  localState: unknown,
  source: BrowserPasswordImportSourceConfig
) => {
  if (platform === 'darwin') return await createMacBrowserPasswordDecryptor(source)
  return await createWindowsBrowserPasswordDecryptor(localState, source)
}

const buildPasswordEntryId = (input: Pick<PasswordVaultEntry, 'originUrl' | 'signonRealm' | 'username'>) => (
  createHash('sha256')
    .update([
      input.originUrl,
      input.signonRealm ?? '',
      input.username
    ].join('\n'))
    .digest('hex')
)

const buildPasswordEntry = (
  row: ChromeLoginRow,
  password: string,
  profile: ChromeProfileDescriptor,
  source: BrowserPasswordImportSourceConfig
): PasswordVaultEntry => {
  const entryWithoutId = {
    ...(row.actionUrl == null ? {} : { actionUrl: row.actionUrl }),
    ...(row.dateCreated == null ? {} : { dateCreated: row.dateCreated }),
    importedAt: new Date().toISOString(),
    originUrl: row.originUrl,
    password,
    ...(row.signonRealm == null ? {} : { signonRealm: row.signonRealm }),
    sourceBrowser: source.name,
    sourceProfile: profile.name,
    username: row.username ?? ''
  }
  return {
    ...entryWithoutId,
    id: buildPasswordEntryId(entryWithoutId)
  }
}

const parseCsvRows = (content: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const nextChar = content[index + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        cell += '"'
        index += 1
        continue
      }
      if (char === '"') {
        inQuotes = false
        continue
      }
      cell += char
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      row.push(cell)
      if (row.some(value => value.trim() !== '')) {
        rows.push(row)
      }
      row = []
      cell = ''
      continue
    }
    cell += char
  }

  row.push(cell)
  if (row.some(value => value.trim() !== '')) {
    rows.push(row)
  }
  return rows
}

const normalizeCsvHeader = (value: string) =>
  value.replace(/^\uFEFF/u, '').trim().toLowerCase().replace(/[\s-]+/gu, '_')

const getCsvHeaderIndex = (headers: string[], aliases: string[]) => {
  const normalizedAliases = new Set(aliases.map(normalizeCsvHeader))
  return headers.findIndex(header => normalizedAliases.has(header))
}

const getCsvCell = (row: string[], headerIndexes: number[], fallback = '') => {
  for (const index of headerIndexes) {
    if (index < 0) continue
    const value = row[index]?.trim()
    if (value != null && value !== '') return value
  }
  return fallback
}

const normalizeCsvPasswordUrl = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  try {
    return new URL(trimmed).href
  } catch {
    if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/iu.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`).href
      } catch {
        return trimmed
      }
    }
    return trimmed
  }
}

const parsePasswordCsv = (
  content: string,
  input: {
    sourceProfile: string
  }
) => {
  const rows = parseCsvRows(content)
  const rawHeaders = rows[0]
  if (rawHeaders == null) return []

  const headers = rawHeaders.map(normalizeCsvHeader)
  const urlIndexes = [
    getCsvHeaderIndex(headers, ['url', 'origin_url', 'origin', 'website', 'site', 'login_uri', 'login_url'])
  ]
  const usernameIndexes = [
    getCsvHeaderIndex(headers, ['username', 'user', 'login', 'login_username', 'email', 'account'])
  ]
  const passwordIndexes = [
    getCsvHeaderIndex(headers, ['password', 'pass', 'login_password', 'secret'])
  ]
  const noteIndexes = [
    getCsvHeaderIndex(headers, ['note', 'notes'])
  ]

  if (urlIndexes.every(index => index < 0) || passwordIndexes.every(index => index < 0)) {
    return []
  }

  return rows.slice(1).flatMap((row): PasswordVaultEntry[] => {
    const originUrl = normalizeCsvPasswordUrl(getCsvCell(row, urlIndexes))
    const password = getCsvCell(row, passwordIndexes)
    if (originUrl === '' || password === '') return []

    const note = getCsvCell(row, noteIndexes)
    const entryWithoutId = {
      importedAt: new Date().toISOString(),
      ...(note === '' ? {} : { note }),
      originUrl,
      password,
      sourceBrowser: 'CSV File' as const,
      sourceProfile: input.sourceProfile,
      username: getCsvCell(row, usernameIndexes)
    }

    return [{
      ...entryWithoutId,
      id: buildPasswordEntryId(entryWithoutId)
    }]
  })
}

const getUrlOrigin = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

const normalizePasswordUsername = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

const getPasswordEntrySiteKey = (entry: Pick<PasswordVaultEntry, 'originUrl' | 'signonRealm'>) => {
  const signonRealmOrigin = entry.signonRealm == null ? undefined : getUrlOrigin(entry.signonRealm)
  const origin = getUrlOrigin(entry.originUrl)
  return (signonRealmOrigin ?? origin ?? entry.signonRealm ?? entry.originUrl).toLowerCase()
}

const getPasswordEntryDuplicateKey = (
  entry: Pick<PasswordVaultEntry, 'originUrl' | 'signonRealm' | 'username'>
) =>
  [
    getPasswordEntrySiteKey(entry),
    normalizePasswordUsername(entry.username)
  ].join('\n')

const isPasswordEntryImportEqual = (left: PasswordVaultEntry, right: PasswordVaultEntry) => (
  left.password === right.password &&
  left.actionUrl === right.actionUrl &&
  left.sourceProfile === right.sourceProfile &&
  left.note === right.note
)

const findSimilarPasswordEntry = (
  entries: PasswordVaultEntry[],
  importedEntry: PasswordVaultEntry
) => {
  const duplicateKey = getPasswordEntryDuplicateKey(importedEntry)
  return entries.find(entry => entry.id !== importedEntry.id && getPasswordEntryDuplicateKey(entry) === duplicateKey)
}

const countPasswordImportDuplicates = (
  currentEntries: PasswordVaultEntry[],
  importedEntries: PasswordVaultEntry[]
) => {
  const entriesById = new Map(currentEntries.map(entry => [entry.id, entry]))
  const knownEntries = [...currentEntries]
  let duplicates = 0

  for (const entry of importedEntries) {
    const existing = entriesById.get(entry.id)
    if (existing != null) {
      if (!isPasswordEntryImportEqual(existing, entry)) duplicates += 1
      continue
    }

    const similar = findSimilarPasswordEntry(knownEntries, entry)
    if (similar != null) {
      duplicates += 1
      continue
    }

    knownEntries.push(entry)
    entriesById.set(entry.id, entry)
  }

  return duplicates
}

const confirmBrowserPasswordDuplicateResolution = async (
  duplicateCount: number,
  sourceName: string,
  webContents?: WebContents
): Promise<BrowserPasswordDuplicateResolution | 'cancel'> => {
  if (duplicateCount <= 0) return 'skip'

  const parentWindow = webContents == null || webContents.isDestroyed()
    ? null
    : BrowserWindow.fromWebContents(webContents)
  const options: Electron.MessageBoxOptions = {
    buttons: ['Overwrite duplicates', 'Skip duplicates', 'Cancel'],
    cancelId: 2,
    defaultId: 1,
    detail: `${duplicateCount} ${sourceName} password accounts look duplicated or changed. ` +
      `Overwrite updates the OneWorks vault with ${sourceName} data. Skip keeps the current saved data.`,
    message: 'Duplicate accounts found while syncing passwords',
    noLink: true,
    title: 'Sync passwords',
    type: 'question'
  }
  const result = parentWindow == null
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(parentWindow, options)
  if (result.response === 0) return 'overwrite'
  if (result.response === 1) return 'skip'
  return 'cancel'
}

const normalizePasswordDuplicateResolution = (value: unknown): BrowserPasswordDuplicateResolution => {
  if (
    isRecord(value) &&
    (value.duplicateResolution === 'overwrite' || value.duplicateResolution === 'skip')
  ) {
    return value.duplicateResolution
  }
  return 'ask'
}

const normalizeBrowserPasswordImportOptions = (value: unknown): BrowserPasswordImportOptions => {
  const sourceId = isRecord(value) && isBrowserPasswordImportSourceId(value.sourceId)
    ? value.sourceId
    : 'google-chrome'
  return {
    duplicateResolution: normalizePasswordDuplicateResolution(value),
    sourceId
  }
}

const mergePasswordEntries = async (
  currentEntries: PasswordVaultEntry[],
  importedEntries: PasswordVaultEntry[],
  input: {
    duplicateResolution: BrowserPasswordDuplicateResolution
    sourceName: string
    webContents?: WebContents
  }
) => {
  const entriesById = new Map(currentEntries.map(entry => [entry.id, entry]))
  const duplicateCount = countPasswordImportDuplicates(currentEntries, importedEntries)
  const duplicateResolution = input.duplicateResolution === 'ask'
    ? await confirmBrowserPasswordDuplicateResolution(duplicateCount, input.sourceName, input.webContents)
    : input.duplicateResolution
  if (duplicateResolution === 'cancel') {
    return {
      canceled: true,
      duplicates: duplicateCount,
      entries: currentEntries,
      imported: 0,
      skipped: 0,
      updated: 0
    }
  }

  let imported = 0
  let skipped = 0
  let updated = 0

  for (const entry of importedEntries) {
    const existing = entriesById.get(entry.id)
    if (existing != null) {
      if (isPasswordEntryImportEqual(existing, entry)) {
        skipped += 1
        continue
      }
      if (duplicateResolution === 'skip') {
        skipped += 1
        continue
      }
      entriesById.set(entry.id, {
        ...existing,
        ...entry,
        importedAt: existing.importedAt,
        updatedAt: new Date().toISOString()
      })
      updated += 1
      continue
    }

    const similarEntry = findSimilarPasswordEntry([...entriesById.values()], entry)
    if (similarEntry != null) {
      if (duplicateResolution === 'skip') {
        skipped += 1
        continue
      }
      entriesById.set(similarEntry.id, {
        ...similarEntry,
        ...entry,
        id: similarEntry.id,
        importedAt: similarEntry.importedAt,
        updatedAt: new Date().toISOString()
      })
      updated += 1
      continue
    }

    entriesById.set(entry.id, entry)
    imported += 1
  }

  return {
    canceled: false,
    duplicates: duplicateCount,
    entries: [...entriesById.values()],
    imported,
    skipped,
    updated
  }
}

const normalizeSavedPasswordUpdateInput = (value: unknown): SavedPasswordUpdateInput => {
  if (!isRecord(value)) return {}
  const input: SavedPasswordUpdateInput = {}
  if (typeof value.originUrl === 'string' && value.originUrl.trim() !== '') {
    input.originUrl = value.originUrl.trim()
  }
  if (typeof value.username === 'string') {
    input.username = value.username
  }
  if (typeof value.password === 'string' && value.password !== '') {
    input.password = value.password
  }
  if (typeof value.note === 'string') {
    input.note = value.note.trim()
  }
  return input
}

const buildUpdatedPasswordEntry = (existing: PasswordVaultEntry, input: SavedPasswordUpdateInput) => {
  const next: PasswordVaultEntry = {
    ...existing,
    ...(input.originUrl == null ? {} : { originUrl: input.originUrl }),
    ...(input.password == null ? {} : { password: input.password }),
    ...(input.username == null ? {} : { username: input.username }),
    ...(input.note == null || input.note === '' ? {} : { note: input.note }),
    id: existing.id,
    importedAt: existing.importedAt,
    sourceBrowser: existing.sourceBrowser,
    sourceProfile: existing.sourceProfile,
    updatedAt: new Date().toISOString()
  }
  if (input.note === '') {
    delete next.note
  }
  next.id = buildPasswordEntryId(next)
  return next
}

const updatePasswordEntryInVault = (
  currentEntries: PasswordVaultEntry[],
  id: string,
  input: SavedPasswordUpdateInput
) => {
  const existingIndex = currentEntries.findIndex(entry => entry.id === id)
  if (existingIndex < 0) throw new Error('Saved password not found.')
  const updatedEntry = buildUpdatedPasswordEntry(currentEntries[existingIndex]!, input)
  const conflictingEntry = currentEntries.find((entry, index) =>
    index !== existingIndex && entry.id === updatedEntry.id
  )
  if (conflictingEntry != null) {
    throw new Error('A saved password for this website and username already exists.')
  }
  return {
    entries: currentEntries.map((entry, index) => index === existingIndex ? updatedEntry : entry),
    entry: updatedEntry
  }
}

const deletePasswordEntryFromVault = (currentEntries: PasswordVaultEntry[], id: string) => {
  const nextEntries = currentEntries.filter(entry => entry.id !== id)
  if (nextEntries.length === currentEntries.length) throw new Error('Saved password not found.')
  return nextEntries
}

const getSavedPasswordsAccessExpiresAt = () => new Date(savedPasswordsAccessAuthenticatedUntil).toISOString()

const extendSavedPasswordsAccess = () => {
  savedPasswordsAccessAuthenticatedUntil = Date.now() + savedPasswordsAccessTtlMs
  return getSavedPasswordsAccessExpiresAt()
}

const isSavedPasswordsAccessAuthenticated = () => Date.now() < savedPasswordsAccessAuthenticatedUntil

const assertSavedPasswordsAccessAuthenticated = () => {
  if (!savedPasswordsRuntimeSettings.requireAuth) return
  if (!isSavedPasswordsAccessAuthenticated()) {
    throw new Error('Saved password access requires recent confirmation.')
  }
}

const isPasswordEntryMatchingUrl = (entry: PasswordVaultEntry, targetUrl: string) => {
  const targetOrigin = getUrlOrigin(targetUrl)
  if (targetOrigin == null) return false
  return [
    entry.originUrl,
    entry.actionUrl,
    entry.signonRealm
  ].some(value => value != null && getUrlOrigin(value) === targetOrigin)
}

const findAutofillPasswordEntry = async (targetUrl: string) => {
  const vault = await readVault()
  const matchingEntries = vault.passwordEntries.filter(entry => isPasswordEntryMatchingUrl(entry, targetUrl))
  return matchingEntries.length === 1 ? matchingEntries[0] : undefined
}

const toSavedPasswordRecord = (entry: PasswordVaultEntry): SavedPasswordRecord => ({
  ...(entry.actionUrl == null ? {} : { actionUrl: entry.actionUrl }),
  ...(entry.dateCreated == null ? {} : { dateCreated: entry.dateCreated }),
  id: entry.id,
  importedAt: entry.importedAt,
  ...(entry.note == null ? {} : { note: entry.note }),
  originUrl: entry.originUrl,
  ...(entry.signonRealm == null ? {} : { signonRealm: entry.signonRealm }),
  sourceBrowser: entry.sourceBrowser,
  sourceProfile: entry.sourceProfile,
  ...(entry.updatedAt == null ? {} : { updatedAt: entry.updatedAt }),
  username: entry.username
})

const matchesSavedPasswordQuery = (entry: PasswordVaultEntry, query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return true
  return [
    entry.originUrl,
    entry.username,
    entry.signonRealm ?? '',
    entry.sourceProfile
  ].some(value => value.toLowerCase().includes(normalizedQuery))
}

const findSavedPasswordById = async (id: unknown) => {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TypeError('A saved password id is required.')
  }
  const vault = await readVault()
  const entry = vault.passwordEntries.find(item => item.id === id)
  if (entry == null) throw new Error('Saved password not found.')
  return entry
}

const buildPasswordAutofillScript = (entry: PasswordVaultEntry) => `
(() => {
  const credential = ${JSON.stringify({ password: entry.password, username: entry.username })};
  const isInput = value => value instanceof HTMLInputElement;
  const isFillable = input => !input.disabled && !input.readOnly && input.type !== 'hidden';
  const setValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const isUsernameCandidate = input => {
    if (!isFillable(input)) return false;
    const type = input.type || 'text';
    if (!['email', 'search', 'tel', 'text', 'url'].includes(type)) return false;
    const key = [
      input.autocomplete,
      input.name,
      input.id,
      input.getAttribute('aria-label') || '',
      input.placeholder
    ].join(' ').toLowerCase();
    return (
      key.includes('email') ||
      key.includes('login') ||
      key.includes('user') ||
      key.includes('account') ||
      input.autocomplete === 'username'
    );
  };
  const passwordInputs = [...document.querySelectorAll('input[type="password"]')]
    .filter(input => isInput(input) && isFillable(input));
  const passwordInput = passwordInputs.find(input => input.offsetParent != null) || passwordInputs[0];
  if (!passwordInput) return false;
  const formInputs = passwordInput.form == null
    ? [...document.querySelectorAll('input')]
    : [...passwordInput.form.querySelectorAll('input')];
  const passwordIndex = formInputs.indexOf(passwordInput);
  const usernameInput = formInputs
    .slice(0, passwordIndex < 0 ? formInputs.length : passwordIndex)
    .reverse()
    .find(input => isInput(input) && isUsernameCandidate(input));
  let changed = false;
  if (usernameInput && usernameInput.value === '' && credential.username !== '') {
    setValue(usernameInput, credential.username);
    changed = true;
  }
  if (passwordInput.value === '') {
    setValue(passwordInput, credential.password);
    changed = true;
  }
  return changed;
})()
`

const importBrowserProfilePasswords = async (
  profile: ChromeProfileDescriptor,
  decryptPassword: (encryptedValue: Buffer) => Promise<string> | string,
  source: BrowserPasswordImportSourceConfig
) => {
  const rows = await queryChromeLoginRows(profile.loginDataPath)
  const entries: PasswordVaultEntry[] = []
  let failed = 0
  for (const row of rows) {
    try {
      const encryptedValue = Buffer.from(row.passwordValueHex, 'hex')
      const password = await decryptPassword(encryptedValue)
      if (password === '') {
        failed += 1
        continue
      }
      entries.push(buildPasswordEntry(row, password, profile, source))
    } catch {
      failed += 1
    }
  }
  return { entries, failed }
}

export const autofillWebContentsSavedPassword = async (webContents: WebContents) => {
  if (!savedPasswordsRuntimeSettings.autoSignIn) return false
  if (webContents.isDestroyed()) return false
  const entry = await findAutofillPasswordEntry(webContents.getURL())
  if (entry == null || webContents.isDestroyed()) return false
  return await webContents.executeJavaScript(buildPasswordAutofillScript(entry), true) as boolean
}

export const listSavedPasswords = async (query: unknown): Promise<SavedPasswordRecord[]> => {
  const normalizedQuery = typeof query === 'string' ? query : ''
  const vault = await readVault()
  return vault.passwordEntries
    .filter(entry => matchesSavedPasswordQuery(entry, normalizedQuery))
    .sort((left, right) => left.originUrl.localeCompare(right.originUrl) || left.username.localeCompare(right.username))
    .map(toSavedPasswordRecord)
}

export const revealSavedPassword = async (id: unknown) => {
  assertSavedPasswordsAccessAuthenticated()
  const entry = await findSavedPasswordById(id)
  return entry.password
}

export const copySavedPasswordField = async (id: unknown, field: unknown) => {
  assertSavedPasswordsAccessAuthenticated()
  if (field !== 'username' && field !== 'password') {
    throw new TypeError('Unsupported saved password field.')
  }
  const entry = await findSavedPasswordById(id)
  clipboard.writeText(field === 'password' ? entry.password : entry.username)
}

export const updateSavedPassword = async (id: unknown, input: unknown): Promise<SavedPasswordRecord> => {
  assertSavedPasswordsAccessAuthenticated()
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TypeError('A saved password id is required.')
  }
  const vault = await readVault()
  const updated = updatePasswordEntryInVault(
    vault.passwordEntries,
    id,
    normalizeSavedPasswordUpdateInput(input)
  )
  await writeVault({
    ...vault,
    passwordEntries: updated.entries
  })
  return toSavedPasswordRecord(updated.entry)
}

export const deleteSavedPassword = async (id: unknown) => {
  assertSavedPasswordsAccessAuthenticated()
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TypeError('A saved password id is required.')
  }
  const vault = await readVault()
  await writeVault({
    ...vault,
    passwordEntries: deletePasswordEntryFromVault(vault.passwordEntries, id)
  })
}

export const authenticateSavedPasswordsAccess = async (
  reason: unknown
): Promise<SavedPasswordAccessAuthenticationResult> => {
  if (!savedPasswordsRuntimeSettings.requireAuth) {
    return {
      authenticated: true,
      expiresAt: extendSavedPasswordsAccess(),
      method: 'cached'
    }
  }

  if (isSavedPasswordsAccessAuthenticated()) {
    return {
      authenticated: true,
      expiresAt: extendSavedPasswordsAccess(),
      method: 'cached'
    }
  }

  if (process.platform !== 'darwin' || !systemPreferences.canPromptTouchID()) {
    throw new Error('System password confirmation is unavailable on this device.')
  }

  await systemPreferences.promptTouchID(
    typeof reason === 'string' && reason.trim() !== ''
      ? reason
      : 'Confirm to view saved passwords.'
  )
  return {
    authenticated: true,
    expiresAt: extendSavedPasswordsAccess(),
    method: 'touch-id'
  }
}

export const updateSavedPasswordsRuntimeSettings = (settings: {
  autoSignIn?: boolean
  requireAuth?: boolean
}) => {
  savedPasswordsRuntimeSettings = {
    ...savedPasswordsRuntimeSettings,
    ...(typeof settings.autoSignIn === 'boolean' ? { autoSignIn: settings.autoSignIn } : {}),
    ...(typeof settings.requireAuth === 'boolean' ? { requireAuth: settings.requireAuth } : {})
  }
}

const showAuthenticatorBackupDialog = async (webContents: WebContents) => {
  const parentWindow = BrowserWindow.fromWebContents(webContents)
  const options: Electron.OpenDialogOptions = {
    filters: [
      { extensions: ['txt', 'json'], name: 'Authenticator backup' },
      { extensions: ['*'], name: 'All files' }
    ],
    properties: ['openFile'],
    title: 'Import Authenticator backup'
  }
  return parentWindow == null
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parentWindow, options)
}

const showPasswordCsvDialog = async (webContents: WebContents) => {
  const parentWindow = BrowserWindow.fromWebContents(webContents)
  const options: Electron.OpenDialogOptions = {
    filters: [
      { extensions: ['csv'], name: 'Password CSV' },
      { extensions: ['*'], name: 'All files' }
    ],
    properties: ['openFile'],
    title: 'Import password CSV'
  }
  return parentWindow == null
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parentWindow, options)
}

export const getBrowserDataSyncState = async (): Promise<BrowserDataSyncState> => {
  const vault = await readVault()
  return {
    authenticator: {
      total: vault.authenticatorEntries.length,
      ...(vault.updatedAt == null ? {} : { updatedAt: vault.updatedAt })
    },
    savedPasswords: {
      total: vault.passwordEntries.length,
      ...(vault.updatedAt == null ? {} : { updatedAt: vault.updatedAt })
    }
  }
}

export const listBrowserPasswordImportSources = async (): Promise<BrowserPasswordImportSource[]> => {
  const platform = getSupportedBrowserPasswordPlatform()
  const sources: BrowserPasswordImportSource[] = []
  for (const source of browserPasswordImportSourceConfigs) {
    const [isInstalled, userDataDirectories] = await Promise.all([
      isBrowserApplicationInstalled(source, platform),
      getExistingBrowserUserDataDirectories(source, platform)
    ])
    if (!isInstalled && userDataDirectories.length === 0) continue
    const profiles = await getBrowserProfileDescriptors(source, platform)
    sources.push({
      icon: source.icon,
      id: source.id,
      name: source.name,
      profiles: profiles.length
    })
  }
  return sources
}

export const importBrowserPasswords = async (
  webContents?: WebContents,
  input?: unknown
): Promise<BrowserPasswordImportResult> => {
  const options = normalizeBrowserPasswordImportOptions(input)
  const source = getBrowserPasswordImportSourceConfig(options.sourceId)
  const platform = getSupportedBrowserPasswordPlatform()
  await ensureSqliteCommand()

  const profileGroups = await getBrowserProfileDescriptorGroups(source, platform)
  if (profileGroups.length === 0) {
    throw new Error(`${source.name} profile directory with saved passwords was not found.`)
  }

  const importedEntries: PasswordVaultEntry[] = []
  let failed = 0
  let profileCount = 0
  for (const profileGroup of profileGroups) {
    const decryptPassword = await createBrowserPasswordDecryptor(platform, profileGroup.localState, source)
    profileCount += profileGroup.profiles.length
    for (const profile of profileGroup.profiles) {
      const result = await importBrowserProfilePasswords(profile, decryptPassword, source)
      importedEntries.push(...result.entries)
      failed += result.failed
    }
  }

  const vault = await readVault()
  const merged = await mergePasswordEntries(vault.passwordEntries, importedEntries, {
    duplicateResolution: options.duplicateResolution,
    sourceName: source.name,
    webContents
  })
  if (!merged.canceled) {
    await writeVault({
      ...vault,
      passwordEntries: merged.entries
    })
  }

  return {
    canceled: merged.canceled,
    duplicates: merged.duplicates,
    failed,
    imported: merged.imported,
    profiles: profileCount,
    sourceId: source.id,
    sourceName: source.name,
    skipped: merged.skipped,
    total: merged.entries.length,
    updated: merged.updated
  }
}

export const importChromePasswords = async (
  webContents?: WebContents,
  input?: unknown
): Promise<ChromePasswordImportResult> => (
  await importBrowserPasswords(webContents, {
    ...(isRecord(input) ? input : {}),
    sourceId: 'google-chrome'
  })
)

export const importPasswordCsv = async (
  webContents: WebContents,
  input?: unknown
): Promise<PasswordCsvImportResult> => {
  const result = await showPasswordCsvDialog(webContents)
  if (result.canceled || result.filePaths[0] == null) {
    return {
      canceled: true,
      duplicates: 0,
      failed: 0,
      imported: 0,
      profiles: 1,
      sourceId: 'csv',
      sourceName: 'CSV File',
      skipped: 0,
      total: (await readVault()).passwordEntries.length,
      updated: 0
    }
  }

  const filePath = result.filePaths[0]
  const importedEntries = parsePasswordCsv(await readFile(filePath, 'utf8'), {
    sourceProfile: path.basename(filePath)
  })
  if (importedEntries.length === 0) {
    throw new Error('No supported password rows were found in this CSV file.')
  }

  const vault = await readVault()
  const merged = await mergePasswordEntries(vault.passwordEntries, importedEntries, {
    duplicateResolution: normalizePasswordDuplicateResolution(input),
    sourceName: 'CSV File',
    webContents
  })
  if (!merged.canceled) {
    await writeVault({
      ...vault,
      passwordEntries: merged.entries
    })
  }

  return {
    canceled: merged.canceled,
    duplicates: merged.duplicates,
    failed: 0,
    fileName: path.basename(filePath),
    imported: merged.imported,
    profiles: 1,
    sourceId: 'csv',
    sourceName: 'CSV File',
    skipped: merged.skipped,
    total: merged.entries.length,
    updated: merged.updated
  }
}

export const importAuthenticatorBackup = async (webContents: WebContents): Promise<AuthenticatorImportResult> => {
  const result = await showAuthenticatorBackupDialog(webContents)
  if (result.canceled || result.filePaths[0] == null) {
    return {
      canceled: true,
      imported: 0,
      skipped: 0,
      total: (await readVault()).authenticatorEntries.length,
      updated: 0
    }
  }

  const filePath = result.filePaths[0]
  const content = await readFile(filePath, 'utf8')
  const importedEntries = parseAuthenticatorBackup(content)
  if (importedEntries.length === 0) {
    throw new Error('No supported otpauth entries were found in this backup.')
  }

  const vault = await readVault()
  const merged = mergeAuthenticatorEntries(vault.authenticatorEntries, importedEntries)
  await writeVault({
    ...vault,
    authenticatorEntries: merged.entries
  })

  return {
    canceled: false,
    fileName: path.basename(filePath),
    imported: merged.imported,
    skipped: merged.skipped,
    total: merged.entries.length,
    updated: merged.updated
  }
}
