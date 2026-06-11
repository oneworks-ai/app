import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readdir, stat } from 'node:fs/promises'
import { homedir, platform, tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

import { notFound } from '#~/utils/http.js'

import { FILE_OPENER_DESCRIPTORS } from './file-opener-descriptors.js'

const execFileAsync = promisify(execFile)
const ICON_CONVERT_TIMEOUT_MS = 2500
const OPENER_ICON_ROUTE = '/api/workspace/opener-icon'

const pathExists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export const buildWorkspaceOpenerIconUrl = (opener: string) =>
  `${OPENER_ICON_ROUTE}?opener=${encodeURIComponent(opener)}`

export const resolveMacAppPath = async (appName: string) => {
  if (platform() !== 'darwin') return undefined

  const candidatePaths = [
    `/Applications/${appName}.app`,
    `/System/Applications/${appName}.app`,
    `/System/Applications/Utilities/${appName}.app`,
    `/System/Library/CoreServices/${appName}.app`,
    join(homedir(), 'Applications', `${appName}.app`)
  ]
  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath
    }
  }

  return undefined
}

const resolveAppPathForNames = async (appNames: string[] = []) => {
  for (const appName of appNames) {
    const appPath = await resolveMacAppPath(appName)
    if (appPath != null) return appPath
  }
  return undefined
}

const resolveIconName = async (appPath: string) => {
  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', [
      '-extract',
      'CFBundleIconFile',
      'raw',
      '-o',
      '-',
      join(appPath, 'Contents', 'Info.plist')
    ], {
      timeout: ICON_CONVERT_TIMEOUT_MS,
      windowsHide: true
    })
    const iconName = String(stdout).trim()
    return iconName === '' ? undefined : iconName
  } catch {
    return undefined
  }
}

const resolveMacAppIconSource = async (appPath: string) => {
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  const iconName = await resolveIconName(appPath)
  const iconCandidates = iconName == null
    ? []
    : [
      join(resourcesPath, iconName),
      join(resourcesPath, extname(iconName) === '' ? `${iconName}.icns` : iconName)
    ]
  for (const candidate of iconCandidates) {
    if (await pathExists(candidate)) return candidate
  }

  try {
    const resourceEntries = await readdir(resourcesPath)
    const appBaseName = basename(appPath, '.app').toLowerCase()
    const icnsEntries = resourceEntries.filter(entry => entry.toLowerCase().endsWith('.icns'))
    const preferredIcon = icnsEntries.find(entry => entry.toLowerCase().startsWith(appBaseName)) ?? icnsEntries[0]
    return preferredIcon == null ? undefined : join(resourcesPath, preferredIcon)
  } catch {
    return undefined
  }
}

const resolveAppPathForOpener = async (opener: string) => {
  if (opener === 'fileManager') return resolveMacAppPath('Finder')
  if (opener === 'terminal') return resolveMacAppPath('Terminal')
  if (opener === 'warp') return resolveMacAppPath('Warp')

  const descriptor = FILE_OPENER_DESCRIPTORS.find(item => item.id === opener)
  return resolveAppPathForNames(descriptor?.appNames)
}

export const resolveWorkspaceOpenerIconUrl = async (opener: string, appNames?: string[]) => {
  const appPath = await resolveAppPathForNames(appNames) ?? await resolveAppPathForOpener(opener)
  return appPath == null ? undefined : buildWorkspaceOpenerIconUrl(opener)
}

const convertIconToPng = async (sourceIconPath: string, opener: string) => {
  const cacheDir = join(tmpdir(), 'oneworks-opener-icons')
  await mkdir(cacheDir, { recursive: true })
  const cacheKey = createHash('sha1').update(`${opener}\0${sourceIconPath}`).digest('hex')
  const cachePath = join(cacheDir, `${cacheKey}.png`)
  if (await pathExists(cachePath)) return cachePath

  await execFileAsync('/usr/bin/sips', [
    '-s',
    'format',
    'png',
    sourceIconPath,
    '--out',
    cachePath
  ], {
    timeout: ICON_CONVERT_TIMEOUT_MS,
    windowsHide: true
  })
  return cachePath
}

export const resolveWorkspaceOpenerIconResource = async (opener: unknown) => {
  if (typeof opener !== 'string' || opener.trim() === '') {
    throw notFound('Workspace opener icon was not found', undefined, 'workspace_opener_icon_not_found')
  }
  const openerId = opener.trim()
  const appPath = await resolveAppPathForOpener(openerId)
  if (appPath == null) {
    throw notFound('Workspace opener icon was not found', { opener: openerId }, 'workspace_opener_icon_not_found')
  }

  const sourceIconPath = await resolveMacAppIconSource(appPath)
  if (sourceIconPath == null) {
    throw notFound('Workspace opener icon was not found', { opener: openerId }, 'workspace_opener_icon_not_found')
  }

  const filePath = await convertIconToPng(sourceIconPath, openerId)
  const fileStat = await stat(filePath)
  return {
    filePath,
    mimeType: 'image/png',
    size: fileStat.size
  }
}
