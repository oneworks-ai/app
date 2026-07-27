const path = require('node:path')

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

const resolveNotarizationArtifactPaths = buildResult => (
  (buildResult?.artifactPaths ?? [])
    .filter(artifactPath => ['.dmg', '.pkg'].includes(path.extname(artifactPath).toLowerCase()))
)

const readNotarizationCredentials = () => {
  const credentials = {
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  }
  const missingNames = [
    ['APPLE_ID', credentials.appleId],
    ['APPLE_ID_PASSWORD', credentials.appleIdPassword],
    ['APPLE_TEAM_ID', credentials.teamId]
  ].filter(([, value]) => value == null || value.trim() === '').map(([name]) => name)
  if (missingNames.length > 0) {
    throw new Error(
      `[desktop] installer notarization requires ${missingNames.join(', ')} when ONEWORKS_DESKTOP_SIGN is enabled`
    )
  }
  return credentials
}

exports.resolveNotarizationArtifactPaths = resolveNotarizationArtifactPaths

exports.default = async function notarizeMacArtifacts(buildResult) {
  const artifactPaths = resolveNotarizationArtifactPaths(buildResult)
  if (artifactPaths.length === 0) return []

  if (!isTruthy(process.env.ONEWORKS_DESKTOP_SIGN)) {
    console.log('[desktop] skipping installer notarization; ONEWORKS_DESKTOP_SIGN is not enabled')
    return []
  }

  const { notarize } = require('@electron/notarize')
  const credentials = readNotarizationCredentials()
  for (const artifactPath of artifactPaths) {
    console.log(`[desktop] notarizing installer ${artifactPath}`)
    await notarize({
      appPath: artifactPath,
      ...credentials
    })
  }
  return []
}
