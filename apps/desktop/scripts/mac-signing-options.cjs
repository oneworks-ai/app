const path = require('node:path')

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

const readRequiredValue = (env, name) => {
  const value = env[name]?.trim()
  if (!value) {
    throw new Error(`[desktop] macOS app signing requires ${name} when ONEWORKS_DESKTOP_SIGN is enabled`)
  }
  return value
}

const resolveMacSigningOptions = ({
  appName,
  desktopRoot,
  env = process.env,
  platform = process.platform
}) => {
  if (platform !== 'darwin' || !isTruthy(env.ONEWORKS_DESKTOP_SIGN)) return {}

  const appleId = readRequiredValue(env, 'APPLE_ID')
  const appleIdPassword = readRequiredValue(env, 'APPLE_ID_PASSWORD')
  const teamId = readRequiredValue(env, 'APPLE_TEAM_ID')
  const keychain = readRequiredValue(env, 'ONEWORKS_DESKTOP_SIGNING_KEYCHAIN')
  const entitlements = path.join(desktopRoot, 'build', 'entitlements.mac.plist')

  return {
    osxNotarize: {
      appleId,
      appleIdPassword,
      teamId
    },
    osxSign: {
      continueOnError: false,
      identity: 'Developer ID Application',
      keychain,
      optionsForFile(filePath) {
        if (path.basename(filePath) === `${appName}.app`) {
          return { entitlements, hardenedRuntime: true }
        }
        return { hardenedRuntime: true }
      }
    }
  }
}

module.exports = {
  isTruthy,
  resolveMacSigningOptions
}
