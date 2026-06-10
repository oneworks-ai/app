import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { BrowserWindow, app, nativeImage, nativeTheme } from 'electron'
import type { NativeImage } from 'electron'

import {
  DEFAULT_DESKTOP_ICON_THEME,
  normalizeDesktopIconAppearance,
  normalizeDesktopIconBackground,
  normalizeDesktopIconTheme,
  resolveDesktopIconMode
} from './desktop-icon-settings'
import type {
  DesktopIconBackground,
  DesktopIconMode,
  DesktopIconSettings,
  DesktopIconTheme
} from './desktop-icon-settings'

const iconImageCache = new Map<string, NativeImage>()
const iconDataUrlCache = new Map<string, string>()
const warnedIconPaths = new Set<string>()

const warnOnce = (key: string, message: string) => {
  if (warnedIconPaths.has(key)) return
  warnedIconPaths.add(key)
  console.warn(message)
}

const getResourcesPath = () => {
  const electronProcess = process as typeof process & { resourcesPath?: string }
  return typeof electronProcess.resourcesPath === 'string'
    ? electronProcess.resourcesPath
    : undefined
}

const getIconRootCandidates = () => {
  const resourcesPath = getResourcesPath()
  return Array.from(
    new Set([
      path.join(app.getAppPath(), 'build', 'icons'),
      ...(resourcesPath == null
        ? []
        : [
          path.join(resourcesPath, 'app', 'build', 'icons'),
          path.join(resourcesPath, 'build', 'icons')
        ])
    ])
  )
}

const desktopIconPlatformDir = () => {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

const getRelativeIconPaths = (
  theme: DesktopIconTheme,
  mode: DesktopIconMode,
  iconBackground: DesktopIconBackground,
  platformDir: string
) => {
  if (iconBackground === 'textured') {
    return [
      path.join(theme, platformDir, `${mode}.png`),
      path.join(theme, `${mode}.png`)
    ]
  }

  const backgroundDir = iconBackground === 'solid' ? 'solid' : 'transparent'
  return [
    path.join(theme, backgroundDir, platformDir, `${mode}.png`),
    path.join(theme, backgroundDir, `${mode}.png`)
  ]
}

const resolveExistingIconPath = (
  theme: DesktopIconTheme,
  mode: DesktopIconMode,
  iconBackground: DesktopIconBackground
) => {
  const platformDir = desktopIconPlatformDir()
  const relativeIconPaths = getRelativeIconPaths(theme, mode, iconBackground, platformDir)
  for (const root of getIconRootCandidates()) {
    for (const relativeIconPath of relativeIconPaths) {
      const candidate = path.join(root, relativeIconPath)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return undefined
}

export const resolveDesktopIconAssetPath = (
  settings: Partial<DesktopIconSettings>,
  shouldUseDarkColors = nativeTheme.shouldUseDarkColors
) => {
  const iconTheme = normalizeDesktopIconTheme(settings.iconTheme)
  const iconAppearance = normalizeDesktopIconAppearance(settings.iconAppearance)
  const iconBackground = normalizeDesktopIconBackground(settings.iconBackground)
  const iconMode = resolveDesktopIconMode(iconAppearance, shouldUseDarkColors)
  return resolveExistingIconPath(iconTheme, iconMode, iconBackground) ??
    resolveExistingIconPath(iconTheme, iconMode, 'textured') ??
    resolveExistingIconPath(DEFAULT_DESKTOP_ICON_THEME, 'dark', 'textured')
}

const loadDesktopIconImage = (settings: Partial<DesktopIconSettings>) => {
  const iconPath = resolveDesktopIconAssetPath(settings)
  if (iconPath == null) {
    warnOnce('missing-icon-assets', '[oneworks-desktop] desktop icon assets are missing')
    return undefined
  }

  const cachedImage = iconImageCache.get(iconPath)
  if (cachedImage != null && !cachedImage.isEmpty()) return cachedImage

  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    warnOnce(iconPath, `[oneworks-desktop] desktop icon asset is empty: ${iconPath}`)
    return undefined
  }

  iconImageCache.set(iconPath, image)
  return image
}

export const readDesktopIconPreviewDataUrl = (settings: Partial<DesktopIconSettings>) => {
  const iconPath = resolveDesktopIconAssetPath(settings)
  if (iconPath == null) {
    warnOnce('missing-icon-preview-assets', '[oneworks-desktop] desktop icon preview assets are missing')
    return undefined
  }

  const cachedDataUrl = iconDataUrlCache.get(iconPath)
  if (cachedDataUrl != null) return cachedDataUrl

  try {
    const dataUrl = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`
    iconDataUrlCache.set(iconPath, dataUrl)
    return dataUrl
  } catch (error) {
    warnOnce(iconPath, `[oneworks-desktop] failed to read desktop icon preview asset: ${iconPath}`)
    console.warn(error)
    return undefined
  }
}

const setWindowIcon = (window: BrowserWindow, image: NativeImage) => {
  if (window.isDestroyed()) return

  try {
    window.setIcon(image)
  } catch (error) {
    console.warn('[oneworks-desktop] failed to apply desktop window icon', error)
  }
}

export const applyDesktopIconToWindow = (
  window: BrowserWindow,
  settings: Partial<DesktopIconSettings>
) => {
  const image = loadDesktopIconImage(settings)
  if (image == null) return false

  setWindowIcon(window, image)
  return true
}

export const applyDesktopIconToAllWindows = (settings: Partial<DesktopIconSettings>) => {
  const image = loadDesktopIconImage(settings)
  if (image == null) return false

  for (const window of BrowserWindow.getAllWindows()) {
    setWindowIcon(window, image)
  }

  if (process.platform === 'darwin' && app.dock != null) {
    app.dock.setIcon(image)
  }

  return true
}
