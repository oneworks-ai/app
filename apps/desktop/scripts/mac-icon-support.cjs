const fs = require('node:fs')
const path = require('node:path')

const { applyIconComposerDeveloperDir, inspectIconComposerSupport } = require('./mac-actool-support.cjs')

const SUPPORTED_MAC_ICON_FORMATS = new Set(['auto', 'icns', 'icon'])

const normalizeMacIconFormat = (value) => {
  const normalized = value.trim().toLowerCase()
  if (!SUPPORTED_MAC_ICON_FORMATS.has(normalized)) {
    throw new Error(`Unsupported mac icon format "${value}". Supported formats: auto, icns, icon`)
  }
  return normalized
}

const resolveIconComposerChoice = ({
  desktopRoot,
  iconMessage,
  legacyMessage,
  requestedFormat
}) => {
  const iconPath = path.join(desktopRoot, 'build', 'icon.icns')
  const iconComposerPath = path.join(desktopRoot, 'build', 'icon.icon')
  const iconComposer = inspectIconComposerSupport(iconComposerPath)
  if (requestedFormat === 'icon' && !iconComposer.supported) {
    throw new Error(`Cannot use macOS .icon assets: ${iconComposer.reason}`)
  }

  const format = requestedFormat === 'auto'
    ? (iconComposer.supported ? 'icon' : 'icns')
    : requestedFormat

  if (format === 'icon') {
    applyIconComposerDeveloperDir(iconComposer)
    if (iconMessage != null) {
      console.log(iconMessage)
    }
  } else if (requestedFormat === 'auto' && !iconComposer.supported && legacyMessage != null) {
    console.log(legacyMessage(iconComposer.reason))
  }

  return {
    format,
    iconComposerPath,
    iconPath
  }
}

const copyLegacyDarwinPackageIcon = ({ iconPath, packageIconDir }) => {
  fs.mkdirSync(packageIconDir, { recursive: true })
  const legacyIconPath = path.join(packageIconDir, 'icon-legacy.icns')
  fs.copyFileSync(iconPath, legacyIconPath)
  return legacyIconPath
}

const resolveDarwinPackagerIconPath = ({ desktopRoot, packageIconDir, requestedFormat }) => {
  const choice = resolveIconComposerChoice({
    desktopRoot,
    iconMessage: '[desktop] packaging with macOS Icon Composer asset build/icon.icon',
    legacyMessage: reason => `[desktop] Apple Icon Composer .icon unavailable (${reason}); packaging with .icns only`,
    requestedFormat
  })

  if (choice.format === 'icon') {
    return [choice.iconPath, choice.iconComposerPath]
  }

  if (requestedFormat === 'icns') {
    console.log('[desktop] packaging with legacy .icns only')
  }
  return copyLegacyDarwinPackageIcon({
    iconPath: choice.iconPath,
    packageIconDir
  })
}

const resolveDarwinBuilderIconFormat = ({ desktopRoot, requestedFormat }) =>
  resolveIconComposerChoice({
    desktopRoot,
    iconMessage: '[desktop] using macOS Icon Composer asset build/icon.icon',
    legacyMessage: reason => `[desktop] Apple Icon Composer .icon unavailable (${reason}); using build/icon.icns`,
    requestedFormat
  }).format

const darwinBuilderIconConfigArgs = format => (
  format === 'icon'
    ? ['--config.mac.icon=build/icon.icon', '--config.dmg.icon=build/icon.icns']
    : []
)

const readPlistStringValue = (plistPath, key) => {
  const content = fs.readFileSync(plistPath, 'utf8')
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]*)</string>`).exec(content)
  return match?.[1]
}

const assertPrepackagedDarwinIcon = ({ appPath, requiredFormat }) => {
  if (process.platform !== 'darwin' || requiredFormat !== 'icon') {
    return
  }

  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist')
  const assetsCarPath = path.join(appPath, 'Contents', 'Resources', 'Assets.car')
  if (!fs.existsSync(assetsCarPath) || readPlistStringValue(infoPlistPath, 'CFBundleIconName') !== 'Icon') {
    throw new Error(
      `Prepackaged macOS app is missing Icon Composer assets at ${appPath}. Run \`pnpm desktop:package:icon\` first.`
    )
  }
}

module.exports = {
  assertPrepackagedDarwinIcon,
  darwinBuilderIconConfigArgs,
  inspectIconComposerSupport,
  normalizeMacIconFormat,
  resolveDarwinBuilderIconFormat,
  resolveDarwinPackagerIconPath
}
