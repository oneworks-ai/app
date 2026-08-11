const { spawnSync } = require('node:child_process')
const path = require('node:path')

const {
  assertPortableAppBundleSymlinks,
  findPrepackagedAppBundles
} = require('./mac-adhoc-seal.cjs')

const run = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (result.error != null) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n')
    )
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

const verifySignedMacAppBundle = ({ appPath, runCommand = run }) => {
  assertPortableAppBundleSymlinks(appPath)
  runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
  const details = runCommand('codesign', ['-d', '--verbose=4', appPath])
  if (!/^Authority=Developer ID Application:/mu.test(details)) {
    throw new Error(`Expected a Developer ID Application signature for ${appPath}.`)
  }
  if (!/^TeamIdentifier=(?!not set$).+/mu.test(details)) {
    throw new Error(`Expected an Apple Developer Team identifier for ${appPath}.`)
  }
  if (!/^Timestamp=.+/mu.test(details)) {
    throw new Error(`Expected a trusted signing timestamp for ${appPath}.`)
  }
  if (!/^Runtime Version=.+/mu.test(details)) {
    throw new Error(`Expected hardened runtime signing for ${appPath}.`)
  }
  runCommand('xcrun', ['stapler', 'validate', appPath])
  runCommand('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
  return details
}

const verifySignedMacAppBundles = ({ outputDir, runCommand = run }) => {
  const appPaths = findPrepackagedAppBundles(outputDir)
  if (appPaths.length === 0) {
    throw new Error(`No prepackaged macOS app bundles were found in ${outputDir}.`)
  }
  for (const appPath of appPaths) {
    verifySignedMacAppBundle({ appPath, runCommand })
    console.log(`[desktop] verified signed and notarized app ${appPath}`)
  }
  return appPaths
}

const runCli = () => {
  const outputDir = path.resolve(process.argv[2] ?? 'apps/desktop/out')
  verifySignedMacAppBundles({ outputDir })
}

if (require.main === module) {
  try {
    runCli()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

module.exports = {
  verifySignedMacAppBundle,
  verifySignedMacAppBundles
}
