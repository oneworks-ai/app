const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const { packager } = require('@electron/packager')
const { resolveProjectHomePath } = require('@oneworks/register/dotenv')
const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { resolveTargetArchs } = require('./desktop-archs.cjs')
const {
  DESKTOP_BUILD_SOURCE_FILE,
  writeDesktopBuildSourceFile
} = require('./desktop-build-source.cjs')
const { normalizeMacIconFormat, resolveDarwinPackagerIconPath } = require('./mac-icon-support.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')
const createWorkspaceRuntimeEnv = () => {
  const env = { ...process.env }
  delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceRoot
  return env
}
const workspaceEnv = createWorkspaceRuntimeEnv()
const packageDataRoot = resolveProjectHomePath(workspaceRoot, workspaceEnv, '.local', 'desktop-package')
const clientDistPath = path.resolve(desktopRoot, '../client/dist')
const outputDir = path.join(desktopRoot, 'out')
const releaseDir = path.join(desktopRoot, 'release')
const appUpdateConfigPath = path.join(desktopRoot, 'build', 'app-update.yml')
const packageIconDir = path.join(packageDataRoot, 'icons')
const buildSourcePath = path.join(packageDataRoot, DESKTOP_BUILD_SOURCE_FILE)
const electronVersion = require('electron/package.json').version
const packageJson = require('../package.json')
const appMetadata = resolveDesktopAppMetadata()
const appName = appMetadata.productName
const executableName = appMetadata.executableName

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')
let pnpmSupportsLegacyDeployCache

const printUsage = () => {
  console.log(`Usage: node scripts/package.cjs [--mac-icon auto|icns|icon] [--check-icons]

Options:
  --mac-icon auto   Use .icon when Xcode actool supports it, otherwise use .icns.
  --mac-icon icon   Require macOS Icon Composer assets and fail if unavailable.
  --mac-icon icns   Force legacy .icns packaging.
  --check-icons     Validate icon inputs and exit before staging or packaging.
`)
}

const resolveCliOptions = () => {
  let checkIcons = false
  let macIconFormat
  const args = process.argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    if (arg === '--mac-icon') {
      const value = args[index + 1]
      if (value == null || value.trim() === '') {
        throw new Error(`${arg} requires auto, icns, or icon`)
      }
      macIconFormat = normalizeMacIconFormat(value)
      index += 1
      continue
    }

    if (arg.startsWith('--mac-icon=')) {
      macIconFormat = normalizeMacIconFormat(arg.slice(arg.indexOf('=') + 1))
      continue
    }

    if (arg === '--check-icons') {
      checkIcons = true
      continue
    }

    throw new Error(`Unsupported package option: ${arg}`)
  }

  return { checkIcons, macIconFormat }
}

const cliOptions = resolveCliOptions()

const resolvePnpmInvocation = () => {
  const npmExecPath = process.env.npm_execpath?.trim()
  if (npmExecPath) {
    if (/\.(c|m)?js$/i.test(npmExecPath)) {
      return {
        args: [npmExecPath],
        command: process.execPath
      }
    }

    return {
      args: [],
      command: npmExecPath,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(npmExecPath)
    }
  }

  return process.platform === 'win32'
    ? {
      args: [],
      command: 'pnpm.cmd',
      shell: true
    }
    : {
      args: [],
      command: 'pnpm'
    }
}

const spawnPnpm = (args, options = {}) => {
  const { args: baseArgs, command, shell } = resolvePnpmInvocation()
  return spawnSync(command, [...baseArgs, ...args], {
    cwd: workspaceRoot,
    encoding: options.encoding,
    shell,
    stdio: options.stdio ?? 'inherit'
  })
}

const resolveAppVersion = () => {
  const requestedVersion = process.env.ONEWORKS_DESKTOP_VERSION?.trim()
  const version = requestedVersion || packageJson.version
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid desktop app version: ${version}`)
  }
  return version
}

const runPnpm = (args) => {
  const result = spawnPnpm(args)

  if (result.error != null) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

const pnpmSupportsLegacyDeploy = () => {
  if (pnpmSupportsLegacyDeployCache != null) {
    return pnpmSupportsLegacyDeployCache
  }

  const result = spawnPnpm(['deploy', '--help'], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (result.error != null || result.status !== 0) {
    pnpmSupportsLegacyDeployCache = false
    return pnpmSupportsLegacyDeployCache
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  pnpmSupportsLegacyDeployCache = output.includes('--legacy')
  return pnpmSupportsLegacyDeployCache
}

const buildDeployArgs = (stagingDir) => {
  const args = [
    '--filter',
    '@oneworks/desktop',
    'deploy'
  ]

  if (pnpmSupportsLegacyDeploy()) {
    args.push('--legacy')
  } else {
    console.log('[desktop] pnpm deploy --legacy is not supported by this pnpm, using default deploy implementation')
  }

  args.push('--prod', stagingDir)
  return args
}

const resolveStagingPaths = (arch) => {
  const suffix = arch === process.arch ? '' : `-${arch}`
  const stagingRoot = resolveProjectHomePath(workspaceRoot, workspaceEnv, '.local', 'desktop-package-staging')
  return {
    desktopStagingDir: path.join(stagingRoot, `desktop${suffix}`),
    stagingDir: path.join(stagingRoot, `app${suffix}`)
  }
}

const removeStagingDirs = ({ desktopStagingDir, stagingDir }) => {
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.rmSync(desktopStagingDir, { recursive: true, force: true })
}

const removeIfExists = (targetPath) => {
  if (!fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, { recursive: true, force: true })
}

const workspacePackageSourceIgnoreNames = new Set([
  '.git',
  '.turbo',
  'coverage',
  'node_modules'
])

const readJsonFile = (filePath) => {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

const resolveWorkspacePackageSources = () => {
  const result = spawnPnpm(['m', 'ls', '-r', '--depth', '-1', '--json'], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (result.error != null) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`pnpm m ls -r --depth -1 --json failed with exit code ${result.status}`)
  }

  const packages = JSON.parse(result.stdout)
  if (!Array.isArray(packages)) {
    throw new TypeError('pnpm workspace package list did not return an array')
  }

  const sources = new Map()
  for (const item of packages) {
    if (typeof item?.name !== 'string' || typeof item?.path !== 'string') {
      continue
    }
    if (item.path !== workspaceRoot && !item.path.startsWith(`${workspaceRoot}${path.sep}`)) {
      continue
    }
    sources.set(item.name, item.path)
  }
  return sources
}

const collectPnpmPackageRoots = (stagingDir) => {
  const pnpmDir = path.join(stagingDir, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmDir)) {
    return []
  }

  const packageRoots = []
  const seen = new Set()
  const addPackageRoot = (packageRoot) => {
    if (seen.has(packageRoot)) return
    seen.add(packageRoot)
    packageRoots.push(packageRoot)
  }

  for (const entry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const packageNodeModules = path.join(pnpmDir, entry.name, 'node_modules')
    if (!fs.existsSync(packageNodeModules)) {
      continue
    }

    for (const packageEntry of fs.readdirSync(packageNodeModules, { withFileTypes: true })) {
      const packageEntryPath = path.join(packageNodeModules, packageEntry.name)
      if (packageEntry.isDirectory() && packageEntry.name.startsWith('@')) {
        for (const scopedEntry of fs.readdirSync(packageEntryPath, { withFileTypes: true })) {
          const packageRoot = path.join(packageEntryPath, scopedEntry.name)
          if (
            scopedEntry.isDirectory() &&
            !fs.lstatSync(packageRoot).isSymbolicLink() &&
            fs.existsSync(path.join(packageRoot, 'package.json'))
          ) {
            addPackageRoot(packageRoot)
          }
        }
        continue
      }

      const packageRoot = packageEntryPath
      if (
        packageEntry.isDirectory() &&
        !fs.lstatSync(packageRoot).isSymbolicLink() &&
        fs.existsSync(path.join(packageRoot, 'package.json'))
      ) {
        addPackageRoot(packageRoot)
      }
    }
  }

  return packageRoots
}

const copyWorkspacePackageSource = (sourceDir, targetDir) => {
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue
    }
    fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true })
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (workspacePackageSourceIgnoreNames.has(entry.name)) {
      continue
    }
    fs.cpSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), {
      dereference: false,
      force: true,
      recursive: true
    })
  }
}

const overlayWorkspacePackages = (stagingDir) => {
  const workspacePackageSources = resolveWorkspacePackageSources()
  const packageRoots = collectPnpmPackageRoots(stagingDir)
  const overlaid = []

  for (const packageRoot of packageRoots) {
    const packageJson = readJsonFile(path.join(packageRoot, 'package.json'))
    const sourceDir = workspacePackageSources.get(packageJson.name)
    if (sourceDir == null) {
      continue
    }

    copyWorkspacePackageSource(sourceDir, packageRoot)
    overlaid.push(packageJson.name)
  }

  if (overlaid.length > 0) {
    const packageList = [...new Set(overlaid)].sort().join(', ')
    console.log(`[desktop] overlaid local workspace packages: ${packageList}`)
  }
}

const ensureExecutableIfExists = (targetPath) => {
  if (!fs.existsSync(targetPath)) return

  const mode = fs.statSync(targetPath).mode & 0o777
  if ((mode & 0o111) !== 0) return

  fs.chmodSync(targetPath, mode | 0o755)
}

const prepareDesktopBuildSourceResources = () => {
  const buildSource = writeDesktopBuildSourceFile({
    cwd: workspaceRoot,
    outputPath: buildSourcePath
  })
  if (buildSource == null) {
    return []
  }

  const shortHash = buildSource.gitHash === 'unknown'
    ? buildSource.gitHash
    : buildSource.gitHash.slice(0, 12)
  console.log(`[desktop] embedding build source ${shortHash} on ${buildSource.branch} at ${buildSource.buildTime}`)
  return [buildSourcePath]
}

const prepareBundledClientRuntimePackage = (stagingDir) => {
  const clientPackageJson = readJsonFile(path.join(workspaceRoot, 'apps', 'client', 'package.json'))
  const targetDir = path.join(stagingDir, 'runtime-packages', '@oneworks', 'client')
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    `${
      JSON.stringify(
        {
          name: clientPackageJson.name,
          type: clientPackageJson.type,
          version: clientPackageJson.version
        },
        null,
        2
      )
    }\n`
  )
  fs.cpSync(clientDistPath, path.join(targetDir, 'dist'), {
    dereference: true,
    force: true,
    recursive: true
  })
}

const resolveStagingPackageRoot = (stagingDir, packageName) => {
  const pnpmDir = path.join(stagingDir, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmDir)) {
    return undefined
  }

  for (const entry of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const packageRoot = path.join(pnpmDir, entry.name, 'node_modules', packageName)
    if (fs.existsSync(path.join(packageRoot, 'package.json'))) {
      return packageRoot
    }
  }

  return undefined
}

const pruneNodePtyPrebuilds = (stagingDir, targetArch) => {
  const packageRoot = resolveStagingPackageRoot(stagingDir, 'node-pty')
  if (packageRoot == null) return

  const prebuildsDir = path.join(packageRoot, 'prebuilds')
  const targetPrebuildName = `${process.platform}-${targetArch}`
  if (fs.existsSync(prebuildsDir)) {
    for (const entry of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === targetPrebuildName) {
        continue
      }
      removeIfExists(path.join(prebuildsDir, entry.name))
    }
  }

  if (process.platform !== 'win32') {
    removeIfExists(path.join(packageRoot, 'third_party'))
    ensureExecutableIfExists(path.join(packageRoot, 'build', 'Release', 'spawn-helper'))
    ensureExecutableIfExists(path.join(packageRoot, 'build', 'Debug', 'spawn-helper'))
    ensureExecutableIfExists(path.join(packageRoot, 'prebuilds', targetPrebuildName, 'spawn-helper'))
  }
}

const pruneNodeNotifierVendors = (stagingDir) => {
  const packageRoot = resolveStagingPackageRoot(stagingDir, 'node-notifier')
  if (packageRoot == null) return

  const vendorDir = path.join(packageRoot, 'vendor')
  if (!fs.existsSync(vendorDir)) return

  const removableVendors = process.platform === 'win32'
    ? ['mac.noindex']
    : ['notifu', 'snoreToast']

  for (const vendorName of removableVendors) {
    removeIfExists(path.join(vendorDir, vendorName))
  }
}

const pruneUnusedPlatformBinaries = (stagingDir, targetArch) => {
  pruneNodePtyPrebuilds(stagingDir, targetArch)
  pruneNodeNotifierVendors(stagingDir)
}

const resolvePackagedAppRoot = (appPath) => {
  if (process.platform === 'darwin') {
    return path.join(appPath, `${appName}.app`, 'Contents', 'Resources', 'app')
  }

  return path.join(appPath, 'resources', 'app')
}

let packageIconPath

const resolvePackageIconPath = () => {
  if (packageIconPath != null) return packageIconPath

  if (process.platform === 'darwin') {
    packageIconPath = resolveDarwinPackagerIconPath({
      desktopRoot,
      packageIconDir,
      requestedFormat: cliOptions.macIconFormat ?? 'auto'
    })
    return packageIconPath
  }

  if (process.platform === 'win32') {
    packageIconPath = path.join(desktopRoot, 'build', 'icon.ico')
    return packageIconPath
  }

  packageIconPath = path.join(desktopRoot, 'build', 'icon.png')
  return packageIconPath
}

const assertIconPaths = (iconPath) => {
  const iconPaths = Array.isArray(iconPath) ? iconPath : [iconPath]
  for (const candidate of iconPaths) {
    if (!fs.existsSync(candidate)) {
      throw new Error(`Desktop package icon is missing: ${candidate}`)
    }
  }
}

const resolvePackagedSymlinkTarget = (target, packagedAppRoot, stagingDir) => {
  if (target === stagingDir || target.startsWith(`${stagingDir}${path.sep}`)) {
    return path.join(packagedAppRoot, path.relative(stagingDir, target))
  }

  if (target === desktopRoot || target.startsWith(`${desktopRoot}${path.sep}`)) {
    return path.join(packagedAppRoot, path.relative(desktopRoot, target))
  }

  return undefined
}

const rewriteStagingSymlinks = (rootDir, packagedAppRoot, stagingDir) => {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name)
    const stat = fs.lstatSync(entryPath)

    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(entryPath)
      if (path.isAbsolute(target)) {
        const packagedTarget = resolvePackagedSymlinkTarget(target, packagedAppRoot, stagingDir)
        if (packagedTarget == null) continue
        const relativeTarget = path.relative(path.dirname(entryPath), packagedTarget)
        fs.unlinkSync(entryPath)
        fs.symlinkSync(relativeTarget, entryPath)
      }
      continue
    }

    if (stat.isDirectory()) {
      rewriteStagingSymlinks(entryPath, packagedAppRoot, stagingDir)
    }
  }
}

const packageDesktopArch = async (targetArch, { buildSourceResources }) => {
  const { desktopStagingDir, stagingDir } = resolveStagingPaths(targetArch)

  removeStagingDirs({ desktopStagingDir, stagingDir })

  try {
    console.log(`[desktop] preparing production app staging (${targetArch})`)
    runPnpm(buildDeployArgs(stagingDir))
    overlayWorkspacePackages(stagingDir)
    prepareBundledClientRuntimePackage(stagingDir)
    pruneUnusedPlatformBinaries(stagingDir, targetArch)

    const iconPath = resolvePackageIconPath()
    const appVersion = resolveAppVersion()
    const enableAutoUpdate = isTruthy(process.env.ONEWORKS_DESKTOP_ENABLE_AUTO_UPDATE)
    assertIconPaths(iconPath)
    if (enableAutoUpdate && !fs.existsSync(appUpdateConfigPath)) {
      throw new Error(`Desktop auto-update config is missing: ${appUpdateConfigPath}`)
    }
    if (!enableAutoUpdate) {
      console.log('[desktop] auto-update config disabled for this package')
    }

    const appPaths = await packager({
      appBundleId: appMetadata.appId,
      appCategoryType: 'public.app-category.developer-tools',
      appCopyright: 'Copyright One Works contributors',
      appVersion,
      arch: targetArch,
      asar: false,
      derefSymlinks: false,
      dir: stagingDir,
      electronVersion,
      executableName,
      extendInfo: {
        CFBundleDisplayName: appName,
        CFBundleIconFile: 'icon.icns'
      },
      extraResource: [
        ...(enableAutoUpdate ? [appUpdateConfigPath] : []),
        ...buildSourceResources,
        clientDistPath
      ],
      icon: iconPath,
      ignore: [
        /^\/out($|\/)/,
        /^\/scripts($|\/)/
      ],
      name: appName,
      out: outputDir,
      overwrite: true,
      platform: process.platform,
      prune: false
    })

    for (const appPath of appPaths) {
      const packagedAppRoot = resolvePackagedAppRoot(appPath)
      rewriteStagingSymlinks(packagedAppRoot, packagedAppRoot, stagingDir)
      console.log(`[desktop] packaged ${appPath}`)
    }
  } finally {
    removeStagingDirs({ desktopStagingDir, stagingDir })
  }
}

async function main() {
  const targetArchs = resolveTargetArchs()
  fs.rmSync(packageIconDir, { recursive: true, force: true })
  assertIconPaths(resolvePackageIconPath())
  if (cliOptions.checkIcons) {
    console.log('[desktop] package icon inputs are available')
    return
  }
  if (appMetadata.isDevBuild) {
    console.log(`[desktop] using local dev app identity: ${appMetadata.productName} (${appMetadata.appId})`)
  }
  const buildSourceResources = prepareDesktopBuildSourceResources()
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.rmSync(releaseDir, { recursive: true, force: true })

  for (const targetArch of targetArchs) {
    await packageDesktopArch(targetArch, { buildSourceResources })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
