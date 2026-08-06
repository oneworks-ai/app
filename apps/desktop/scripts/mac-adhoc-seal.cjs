/* eslint-disable max-lines -- bundle portability, sealing, and quarantine checks form one fail-closed contract. */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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

const assess = (command, args) => spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' })

const visitSymlinks = (rootPath, visitor) => {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name)
    const stat = fs.lstatSync(entryPath)
    if (stat.isSymbolicLink()) {
      visitor(entryPath, fs.readlinkSync(entryPath))
    } else if (stat.isDirectory()) {
      visitSymlinks(entryPath, visitor)
    }
  }
}

const normalizeAppBundleSymlinks = appPath => {
  const normalized = []
  visitSymlinks(appPath, (entryPath, target) => {
    if (!path.isAbsolute(target)) return
    const portableTarget = path.join(path.dirname(entryPath), path.basename(target))
    if (portableTarget === entryPath || !fs.existsSync(portableTarget)) {
      throw new Error(
        `App bundle contains an external absolute symlink without a packaged sibling target: ${entryPath} -> ${target}`
      )
    }
    fs.unlinkSync(entryPath)
    fs.symlinkSync(path.basename(portableTarget), entryPath)
    normalized.push(entryPath)
  })
  return normalized
}

const assertPortableAppBundleSymlinks = appPath => {
  visitSymlinks(appPath, (entryPath, target) => {
    if (path.isAbsolute(target)) {
      throw new Error(`App bundle contains a non-portable absolute symlink: ${entryPath} -> ${target}`)
    }
    if (!fs.existsSync(entryPath)) {
      throw new Error(`App bundle contains a broken symlink: ${entryPath} -> ${target}`)
    }
  })
}

const verifyAdHocAppBundle = ({ appPath, runCommand = run }) => {
  assertPortableAppBundleSymlinks(appPath)
  runCommand('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
  const details = runCommand('codesign', ['-d', '--verbose=4', appPath])
  if (!/^Signature=adhoc$/mu.test(details)) {
    throw new Error(`Expected an ad-hoc signature for ${appPath}.`)
  }
  if (/^TeamIdentifier=(?!not set$)/mu.test(details)) {
    throw new Error(`Ad-hoc app unexpectedly has a Developer Team identifier: ${appPath}.`)
  }
  if (/^Info\.plist=not bound$/mu.test(details) || /^Sealed Resources=none$/mu.test(details)) {
    throw new Error(`App bundle is only linker-signed and is not resource sealed: ${appPath}.`)
  }
  return details
}

const verifyQuarantinedAdHocBoundary = ({
  assessCommand = assess,
  appPath,
  runCommand = run,
  verifyBundle = verifyAdHocAppBundle
}) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oneworks-adhoc-quarantine-'))
  const copiedAppPath = path.join(temporaryRoot, path.basename(appPath))
  try {
    runCommand('ditto', [appPath, copiedAppPath])
    runCommand('xattr', [
      '-w',
      'com.apple.quarantine',
      `0081;${Math.floor(Date.now() / 1000).toString(16)};OneWorks CI;`,
      copiedAppPath
    ])
    const quarantine = runCommand('xattr', ['-p', 'com.apple.quarantine', copiedAppPath])
    if (!quarantine.trim()) {
      throw new Error(`Failed to apply a quarantine marker to ${copiedAppPath}.`)
    }
    verifyBundle({ appPath: copiedAppPath, runCommand })

    const assessment = assessCommand(
      'spctl',
      ['--assess', '--type', 'execute', '--verbose=4', copiedAppPath]
    )
    if (assessment.error != null) throw assessment.error
    const assessmentText = `${assessment.stdout ?? ''}${assessment.stderr ?? ''}`
    const malformed =
      /code has no resources|resource envelope is obsolete|unsealed contents|invalid signature|modified or invalid/iu
        .test(assessmentText)
    const expectedUnsignedRejection = assessment.status === 3 && /:\s*rejected\s*$/imu.test(assessmentText)
    if (malformed) {
      throw new Error(`Gatekeeper classified the ad-hoc app as malformed:\n${assessmentText}`)
    }
    if (assessment.status !== 0 && !expectedUnsignedRejection) {
      throw new Error(
        `Gatekeeper assessment failed unexpectedly with status ${assessment.status}:\n${assessmentText}`
      )
    }
    console.log(
      assessment.status === 0
        ? '[desktop] quarantined ad-hoc app is locally approved by Gatekeeper'
        : '[desktop] quarantined ad-hoc app is structurally valid but still requires manual Gatekeeper approval'
    )
    return { assessmentStatus: assessment.status, assessmentText }
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true })
  }
}

const sealAdHocAppBundle = ({ appPath, runCommand = run }) => {
  if (process.platform !== 'darwin') {
    throw new Error('macOS ad-hoc sealing can only run on darwin.')
  }
  if (!fs.statSync(appPath).isDirectory() || path.extname(appPath) !== '.app') {
    throw new Error(`Expected a macOS app bundle path, got ${appPath}.`)
  }

  const normalizedSymlinks = normalizeAppBundleSymlinks(appPath)
  assertPortableAppBundleSymlinks(appPath)
  if (normalizedSymlinks.length > 0) {
    console.log(`[desktop] normalized ${normalizedSymlinks.length} absolute app-bundle symlink(s)`)
  }

  runCommand('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    appPath
  ])
  return verifyAdHocAppBundle({ appPath, runCommand })
}

const findPrepackagedAppBundles = outputDir => {
  if (!fs.existsSync(outputDir)) return []
  return fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const packageDir = path.join(outputDir, entry.name)
      return fs.readdirSync(packageDir, { withFileTypes: true })
        .filter(child => child.isDirectory() && child.name.endsWith('.app'))
        .map(child => path.join(packageDir, child.name))
    })
    .sort()
}

const sealPrepackagedAppBundles = ({ outputDir, runCommand = run }) => {
  const appPaths = findPrepackagedAppBundles(outputDir)
  if (appPaths.length === 0) {
    throw new Error(`No prepackaged macOS app bundles were found in ${outputDir}.`)
  }
  for (const appPath of appPaths) {
    sealAdHocAppBundle({ appPath, runCommand })
    console.log(`[desktop] ad-hoc sealed ${appPath}`)
  }
  return appPaths
}

const resolveInstalledAppPath = ({
  applicationsRoot = '/Applications',
  metadataResolver = () => require('./desktop-app-metadata.cjs').resolveDesktopAppMetadata()
} = {}) => path.join(applicationsRoot, `${metadataResolver().productName}.app`)

const runCli = () => {
  const [command, requestedPath] = process.argv.slice(2)
  if (command === 'seal-output') {
    const outputDir = path.resolve(requestedPath ?? 'apps/desktop/out')
    sealPrepackagedAppBundles({ outputDir })
    return
  }
  if (command === 'seal-app') {
    if (!requestedPath) throw new Error('seal-app requires an app bundle path.')
    sealAdHocAppBundle({ appPath: path.resolve(requestedPath) })
    return
  }
  if (command === 'verify-app') {
    if (!requestedPath) throw new Error('verify-app requires an app bundle path.')
    verifyAdHocAppBundle({ appPath: path.resolve(requestedPath) })
    return
  }
  if (command === 'verify-quarantine-app') {
    if (!requestedPath) throw new Error('verify-quarantine-app requires an app bundle path.')
    verifyQuarantinedAdHocBoundary({ appPath: path.resolve(requestedPath) })
    return
  }
  if (command === 'verify-quarantine-installed') {
    verifyQuarantinedAdHocBoundary({ appPath: resolveInstalledAppPath() })
    return
  }
  throw new Error(
    'Usage: node mac-adhoc-seal.cjs <seal-app|seal-output|verify-app|verify-quarantine-app|verify-quarantine-installed> [path]'
  )
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
  assertPortableAppBundleSymlinks,
  findPrepackagedAppBundles,
  normalizeAppBundleSymlinks,
  resolveInstalledAppPath,
  sealAdHocAppBundle,
  sealPrepackagedAppBundles,
  verifyAdHocAppBundle,
  verifyQuarantinedAdHocBoundary
}
