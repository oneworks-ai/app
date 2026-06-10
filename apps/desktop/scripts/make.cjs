/* eslint-disable max-lines -- desktop make script coordinates builder args, signing env, and update metadata. */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')

const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { resolveTargetArchs, toBuilderArchArg } = require('./desktop-archs.cjs')
const {
  assertPrepackagedDarwinIcon,
  darwinBuilderIconConfigArgs,
  resolveDarwinBuilderIconFormat
} = require('./mac-icon-support.cjs')
const { mergeMacUpdateInfo } = require('./mac-update-info.cjs')
const { buildTargetArgs, parseMakeCliOptions } = require('./make-targets.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const outputDir = path.join(desktopRoot, 'out')
const releaseDir = path.join(desktopRoot, 'release')
const builderConfigPath = path.join(desktopRoot, 'electron-builder.yml')
const packageJson = require('../package.json')
const appMetadata = resolveDesktopAppMetadata()
const appName = appMetadata.productName
const electronBuilderRequire = createRequire(require.resolve('electron-builder/package.json'))
const yaml = electronBuilderRequire('js-yaml')
const desktopUpdateChannels = new Set(['stable', 'rc', 'beta', 'alpha'])

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

const resolveAppVersion = () => {
  const requestedVersion = process.env.ONEWORKS_DESKTOP_VERSION?.trim()
  const version = requestedVersion || packageJson.version
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid desktop app version: ${version}`)
  }
  return version
}

const resolveUpdateChannel = (appVersion) => {
  const requestedChannel = process.env.ONEWORKS_DESKTOP_UPDATE_CHANNEL?.trim()
  if (requestedChannel) {
    if (!desktopUpdateChannels.has(requestedChannel)) {
      throw new Error(`Invalid desktop update channel: ${requestedChannel}`)
    }
    return requestedChannel
  }

  const channel = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z]+)(?:[.-][0-9A-Za-z.-]+)?)?$/u.exec(appVersion)?.[1] ?? 'stable'
  if (!desktopUpdateChannels.has(channel)) {
    throw new Error(`Desktop prerelease versions must use alpha, beta, or rc channel: ${appVersion}`)
  }
  return channel
}

const getMacUpdateInfoFileName = updateChannel => `${updateChannel === 'stable' ? 'latest' : updateChannel}-mac.yml`

const printUsage = () => {
  console.log(`Usage: node scripts/make.cjs [--target <target>[,<target>...]] [--mac-icon auto|icns|icon]

Examples:
  node scripts/make.cjs
  node scripts/make.cjs --target pkg
  node scripts/make.cjs dmg,pkg
  node scripts/make.cjs --target pkg --mac-icon icon

Environment:
  ONEWORKS_DESKTOP_MAKE_TARGETS  Optional fallback target list for CI and ad-hoc runs.
`)
}

const cliOptions = parseMakeCliOptions({
  args: process.argv.slice(2),
  printUsage
})

let resolvedMacIconFormat

const resolveMacIconFormat = () => {
  if (process.platform !== 'darwin') return undefined
  if (resolvedMacIconFormat != null) return resolvedMacIconFormat

  resolvedMacIconFormat = resolveDarwinBuilderIconFormat({
    desktopRoot,
    requestedFormat: cliOptions.macIconFormat ?? 'auto'
  })
  return resolvedMacIconFormat
}

const macIconConfigArgs = () => darwinBuilderIconConfigArgs(resolveMacIconFormat())

const resolvePackageDirForArch = (targetArch) => {
  const packageDirs = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(`${appName}-`))
    .map(entry => path.join(outputDir, entry.name))
    .sort()

  if (packageDirs.length === 0) {
    throw new Error('Desktop app package was not found. Run `pnpm desktop:package` first.')
  }

  const packageDir = packageDirs.find(candidate => candidate.endsWith(`-${targetArch}`))
  if (packageDir == null) {
    throw new Error(`Desktop app package for arch ${targetArch} was not found. Run \`pnpm desktop:package\` first.`)
  }
  return packageDir
}

const resolvePrepackagedPath = (targetArch) => {
  const packageDir = resolvePackageDirForArch(targetArch)
  if (process.platform === 'darwin') {
    const appPath = path.join(packageDir, `${appName}.app`)
    if (!fs.existsSync(appPath)) {
      throw new Error(`macOS app bundle was not found at ${appPath}`)
    }
    assertPrepackagedDarwinIcon({
      appPath,
      requiredFormat: resolveMacIconFormat()
    })
    return appPath
  }

  return packageDir
}

const buildElectronBuilderArgs = ({ appVersion, publishMode, targetArch, updateChannel }) => {
  const builderCliPath = require.resolve('electron-builder/cli.js')
  const builderChannel = updateChannel === 'stable' ? 'latest' : updateChannel
  return [
    builderCliPath,
    '--projectDir',
    desktopRoot,
    '--config',
    builderConfigPath,
    `--config.appId=${appMetadata.appId}`,
    `--config.productName=${appMetadata.productName}`,
    `--config.artifactName=${appMetadata.artifactName}`,
    `--config.nsis.shortcutName=${appMetadata.productName}`,
    `--config.nsisWeb.shortcutName=${appMetadata.productName}`,
    `--config.extraMetadata.version=${appVersion}`,
    `--config.publish.channel=${builderChannel}`,
    ...(updateChannel === 'stable' ? [] : ['--config.publish.releaseType=prerelease']),
    ...macIconConfigArgs(),
    '--prepackaged',
    resolvePrepackagedPath(targetArch),
    ...buildTargetArgs({
      envTargets: process.env.ONEWORKS_DESKTOP_MAKE_TARGETS,
      platform: process.platform,
      requestedTargets: cliOptions.targets
    }),
    toBuilderArchArg(targetArch),
    '--publish',
    publishMode
  ]
}

const runElectronBuilder = () => {
  const appVersion = resolveAppVersion()
  const updateChannel = resolveUpdateChannel(appVersion)
  const publishMode = process.env.ONEWORKS_DESKTOP_PUBLISH ?? 'never'
  if (process.platform === 'darwin') {
    resolveMacIconFormat()
  }
  const env = {
    ...process.env
  }
  const targetArchs = resolveTargetArchs()

  fs.rmSync(releaseDir, { recursive: true, force: true })

  if (!isTruthy(process.env.ONEWORKS_DESKTOP_SIGN)) {
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    delete env.CSC_KEY_PASSWORD
    delete env.CSC_LINK
    delete env.WIN_CSC_KEY_PASSWORD
    delete env.WIN_CSC_LINK
  }

  for (const targetArch of targetArchs) {
    const args = buildElectronBuilderArgs({
      appVersion,
      publishMode,
      targetArch,
      updateChannel
    })

    const result = spawnSync(process.execPath, args, {
      cwd: desktopRoot,
      env,
      stdio: 'inherit'
    })

    if (result.error != null) {
      throw result.error
    }
    if (result.status !== 0) {
      throw new Error(`electron-builder failed with exit code ${result.status}`)
    }

    if (process.platform === 'darwin') {
      const macUpdateInfoPath = path.join(releaseDir, getMacUpdateInfoFileName(updateChannel))
      if (fs.existsSync(macUpdateInfoPath)) {
        fs.copyFileSync(macUpdateInfoPath, path.join(releaseDir, `${updateChannel}-mac-${targetArch}.yml`))
      }
    }
  }

  if (process.platform === 'darwin') {
    mergeMacUpdateInfo({
      releaseDir,
      targetArchs,
      updateChannel,
      yaml
    })
  }
}

try {
  runElectronBuilder()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
