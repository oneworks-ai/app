const fs = require('node:fs')
const path = require('node:path')

const { refreshNativeAuthorityManifest } = require('../../../packages/fs-authority-native/manifest.cjs')

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

const readRequiredValue = (env, name) => {
  const value = env[name]?.trim()
  if (!value) {
    throw new Error(`[desktop] macOS app signing requires ${name} when ONEWORKS_DESKTOP_SIGN is enabled`)
  }
  return value
}

const resolveOuterAppPath = (filePath, appName) => {
  const normalized = path.resolve(filePath)
  const marker = `${path.sep}${appName}.app`
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex < 0) return undefined
  const markerEnd = markerIndex + marker.length
  if (normalized.length > markerEnd && normalized[markerEnd] !== path.sep) return undefined
  return normalized.slice(0, markerEnd)
}

const isStrictDescendant = (root, target) => {
  const relative = path.relative(root, target)
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

const resolvePackagedAuthorityRoot = appPath => {
  const appStat = fs.lstatSync(appPath)
  if (!appStat.isDirectory() || appStat.isSymbolicLink()) {
    throw new Error('[desktop] root application bundle is unsafe')
  }
  const realAppPath = fs.realpathSync(appPath)
  const packagedAppRoot = fs.realpathSync(path.join(realAppPath, 'Contents', 'Resources', 'app'))
  if (!isStrictDescendant(realAppPath, packagedAppRoot)) {
    throw new Error('[desktop] packaged application resources escape the root application')
  }
  const authorityRoot = fs.realpathSync(path.join(
    packagedAppRoot,
    'node_modules',
    '.pnpm',
    'node_modules',
    '@oneworks',
    'fs-authority-native'
  ))
  if (!isStrictDescendant(packagedAppRoot, authorityRoot)) {
    throw new Error('[desktop] packaged native authority escapes the root application')
  }
  return authorityRoot
}

const resolveMacSigningOptions = ({
  appName,
  desktopRoot,
  env = process.env,
  platform = process.platform
}) => {
  if (platform !== 'darwin' || !isTruthy(env.ONEWORKS_DESKTOP_SIGN)) return {}

  const keychain = readRequiredValue(env, 'ONEWORKS_DESKTOP_SIGNING_KEYCHAIN')
  const entitlements = path.join(desktopRoot, 'build', 'entitlements.mac.plist')
  let refreshedAppPath

  return {
    osxSign: {
      continueOnError: false,
      identity: 'Developer ID Application',
      keychain,
      optionsForFile(filePath) {
        const normalizedFilePath = path.resolve(filePath)
        const rootAppPath = resolveOuterAppPath(normalizedFilePath, appName)
        if (rootAppPath != null && normalizedFilePath === rootAppPath) {
          if (refreshedAppPath !== rootAppPath) {
            refreshNativeAuthorityManifest(resolvePackagedAuthorityRoot(rootAppPath))
            refreshedAppPath = rootAppPath
          }
          return { entitlements, hardenedRuntime: true }
        }
        return { hardenedRuntime: true }
      }
    }
  }
}

module.exports = {
  isTruthy,
  resolveOuterAppPath,
  resolveMacSigningOptions
}
