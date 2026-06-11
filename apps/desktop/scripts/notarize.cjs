const path = require('node:path')

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

exports.default = async function notarizeMacApp(context) {
  if (context.electronPlatformName !== 'darwin') return

  if (!isTruthy(process.env.ONEWORKS_DESKTOP_SIGN)) {
    console.log('[desktop] skipping notarization; ONEWORKS_DESKTOP_SIGN is not enabled')
    return
  }

  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_ID_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID
  const missingNames = [
    ['APPLE_ID', appleId],
    ['APPLE_ID_PASSWORD', appleIdPassword],
    ['APPLE_TEAM_ID', teamId]
  ].filter(([, value]) => value == null || value.trim() === '').map(([name]) => name)
  if (missingNames.length > 0) {
    throw new Error(
      `[desktop] notarization requires ${missingNames.join(', ')} when ONEWORKS_DESKTOP_SIGN is enabled`
    )
  }

  const { notarize } = require('@electron/notarize')
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)

  console.log(`[desktop] notarizing ${appPath}`)
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId
  })
}
