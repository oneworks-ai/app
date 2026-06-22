/* eslint-disable max-lines -- desktop adapter cache seeding keeps hashing, copy, and path helpers together. */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const BUILTIN_ADAPTER_PACKAGES = [
  '@oneworks/adapter-claude-code',
  '@oneworks/adapter-codex',
  '@oneworks/adapter-copilot',
  '@oneworks/adapter-gemini',
  '@oneworks/adapter-kimi',
  '@oneworks/adapter-opencode'
]

const BUILTIN_PLUGIN_PACKAGES = [
  '@oneworks/plugin-logger',
  '@oneworks/plugin-standard-dev'
]

const MANIFEST_FILE = '.oneworks-adapter-cache.json'
const NPM_PACKAGE_MANIFEST_FILE = '.oneworks-package-cache.json'
const BUILTIN_ADAPTER_PACKAGE_ENV = '__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__'
const SKIPPED_PACKAGE_ENTRIES = new Set(['node_modules'])
const CACHE_LAYOUT_VERSION = 2

const normalizeEnvPath = value => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const sanitizePackageName = packageName => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

const splitPackageName = packageName => packageName.split('/')

const resolveRealHomeDir = (env = process.env) => (
  normalizeEnvPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeEnvPath(env.HOME) ??
    normalizeEnvPath(env.USERPROFILE) ??
    os.homedir()
)

const resolvePackageCacheRootDir = (env = process.env, homeDir = resolveRealHomeDir(env)) => (
  normalizeEnvPath(env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__) ?? path.join(homeDir, '.oneworks', 'bootstrap')
)

const resolveAdapterPackagesRoot = (homeDir = resolveRealHomeDir(), packageCacheRootDir) => (
  path.join(packageCacheRootDir ?? path.join(homeDir, '.oneworks', 'bootstrap'), 'adapter-packages')
)

const resolveAdapterPackageCacheDir = (packageName, version, homeDir = resolveRealHomeDir(), packageCacheRootDir) => (
  path.join(resolveAdapterPackagesRoot(homeDir, packageCacheRootDir), sanitizePackageName(packageName), version)
)

const resolveAdapterPackageInstallDir = (cacheDir, packageName) => (
  path.join(cacheDir, 'node_modules', ...splitPackageName(packageName))
)

const resolveNpmPackageCacheDir = (packageName, version, homeDir = resolveRealHomeDir(), packageCacheRootDir) => (
  path.join(
    packageCacheRootDir ?? path.join(homeDir, '.oneworks', 'bootstrap'),
    'npm',
    sanitizePackageName(packageName),
    version
  )
)

const resolveNpmPackageInstallDir = (cacheDir, packageName) => (
  path.join(cacheDir, 'node_modules', ...splitPackageName(packageName))
)

const readPackageInfo = (packageDir) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined
    }
  } catch {
    return undefined
  }
}

const listPackageFiles = (rootDir, relativeDir = '') => {
  const currentDir = path.join(rootDir, relativeDir)
  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    .filter(entry => !SKIPPED_PACKAGE_ENTRIES.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))

  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      return listPackageFiles(rootDir, relativePath)
    }
    if (entry.isFile()) {
      return [relativePath]
    }
    return []
  })
}

const hashPackageDirectory = (packageDir) => {
  const hash = crypto.createHash('sha256')
  for (const relativePath of listPackageFiles(packageDir)) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(packageDir, relativePath)))
    hash.update('\0')
  }
  return `sha256-${hash.digest('hex')}`
}

const resolvePackageDependencyEntries = (packageDir) => {
  const packageInfoPath = path.join(packageDir, 'package.json')
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(packageInfoPath, 'utf8'))
  } catch {
    return []
  }

  const dependencies = Object.keys(parsed.dependencies ?? {})
    .map(name => ({ name, optional: false }))
  const optionalDependencies = Object.keys(parsed.optionalDependencies ?? {})
    .filter(name => !Object.hasOwn(parsed.dependencies ?? {}, name))
    .map(name => ({ name, optional: true }))

  return [
    ...dependencies,
    ...optionalDependencies
  ].sort((left, right) => left.name.localeCompare(right.name))
}

const resolveDependencyPackageDir = (packageDir, dependencyName) => {
  try {
    const packageJsonPath = require.resolve(`${dependencyName}/package.json`, {
      paths: [packageDir]
    })
    return fs.realpathSync(path.dirname(packageJsonPath))
  } catch {
    // Some packages intentionally do not export package.json. Resolve the package
    // entry first, then walk back to the owning package root.
    try {
      const entryPath = require.resolve(dependencyName, { paths: [packageDir] })
      return resolvePackageDirFromEntryPath(entryPath, dependencyName)
    } catch {
      return resolvePackageDirFromNodeModules(packageDir, dependencyName)
    }
  }
}

const resolvePackageDirFromEntryPath = (entryPath, packageName) => {
  let currentDir = fs.realpathSync(path.dirname(entryPath))
  while (currentDir !== path.dirname(currentDir)) {
    const packageInfo = readPackageInfo(currentDir)
    if (packageInfo?.name === packageName) {
      return currentDir
    }
    currentDir = path.dirname(currentDir)
  }
  return undefined
}

const resolveNodeModuleLookupDirs = (fromDir) => {
  const lookupDirs = []
  let currentDir = fromDir
  while (currentDir !== path.dirname(currentDir)) {
    lookupDirs.push(path.join(currentDir, 'node_modules'))
    currentDir = path.dirname(currentDir)
  }
  return lookupDirs
}

const resolvePackageDirFromNodeModules = (packageDir, packageName) => {
  for (const nodeModulesDir of resolveNodeModuleLookupDirs(packageDir)) {
    const candidatePackageDir = path.join(nodeModulesDir, ...splitPackageName(packageName))
    const packageInfo = readPackageInfo(candidatePackageDir)
    if (packageInfo?.name === packageName) {
      return fs.realpathSync(candidatePackageDir)
    }
  }
  return undefined
}

const resolvePackageClosure = (packageName, packageDir) => {
  const packages = []
  const seen = new Set()
  const queue = [{ packageDir, packageName }]

  while (queue.length > 0) {
    const current = queue.shift()
    const packageInfo = readPackageInfo(current.packageDir)
    if (packageInfo?.name !== current.packageName) continue

    const key = `${packageInfo.name}@${packageInfo.version ?? ''}:${current.packageDir}`
    if (seen.has(key)) continue
    seen.add(key)
    packages.push(current)

    for (const dependency of resolvePackageDependencyEntries(current.packageDir)) {
      const dependencyDir = resolveDependencyPackageDir(current.packageDir, dependency.name)
      if (dependencyDir == null && !dependency.optional) {
        throw new Error(`Failed to resolve dependency ${dependency.name} for ${current.packageName}.`)
      }
      if (dependencyDir != null) {
        queue.push({
          packageDir: dependencyDir,
          packageName: dependency.name
        })
      }
    }
  }

  return packages.sort((left, right) => left.packageName.localeCompare(right.packageName))
}

const hashPackageClosure = (packageName, packageDir) => {
  const hash = crypto.createHash('sha256')
  for (const item of resolvePackageClosure(packageName, packageDir)) {
    hash.update(item.packageName)
    hash.update('\0')
    hash.update(hashPackageDirectory(item.packageDir))
    hash.update('\0')
  }
  return `sha256-${hash.digest('hex')}`
}

const readManifest = (cacheDir, manifestFile = MANIFEST_FILE) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cacheDir, manifestFile), 'utf8'))
    return parsed != null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

const writeManifest = (cacheDir, manifest, manifestFile = MANIFEST_FILE) => {
  fs.writeFileSync(path.join(cacheDir, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

const copyPackageBody = (sourcePackageDir, targetPackageDir) => {
  fs.mkdirSync(targetPackageDir, { recursive: true })
  for (const entry of fs.readdirSync(sourcePackageDir, { withFileTypes: true })) {
    if (SKIPPED_PACKAGE_ENTRIES.has(entry.name)) continue

    fs.cpSync(
      path.join(sourcePackageDir, entry.name),
      path.join(targetPackageDir, entry.name),
      {
        dereference: true,
        recursive: true
      }
    )
  }
}

const resolveTargetPackageDir = (targetNodeModulesDir, packageName) => (
  path.join(targetNodeModulesDir, ...splitPackageName(packageName))
)

const copyPackageClosure = (packageName, sourcePackageDir, targetNodeModulesDir) => {
  const packages = resolvePackageClosure(packageName, sourcePackageDir)
  const primaryPackageDirs = new Map()
  for (const item of packages) {
    if (!primaryPackageDirs.has(item.packageName)) {
      primaryPackageDirs.set(item.packageName, item.packageDir)
    }
  }

  for (const [currentPackageName, currentPackageDir] of primaryPackageDirs) {
    copyPackageBody(currentPackageDir, resolveTargetPackageDir(targetNodeModulesDir, currentPackageName))
  }

  const copiedDependencyTargets = new Set()
  const copyNestedDependencies = (currentPackageDir, targetPackageDir, sourceStack = new Set()) => {
    if (sourceStack.has(currentPackageDir)) return
    const nextSourceStack = new Set(sourceStack)
    nextSourceStack.add(currentPackageDir)

    for (const dependency of resolvePackageDependencyEntries(currentPackageDir)) {
      const dependencyDir = resolveDependencyPackageDir(currentPackageDir, dependency.name)
      if (dependencyDir == null && !dependency.optional) {
        throw new Error(`Failed to resolve dependency ${dependency.name} for ${currentPackageDir}.`)
      }
      if (dependencyDir == null) continue

      const primaryPackageDir = primaryPackageDirs.get(dependency.name)
      const dependencyTargetDir = primaryPackageDir === dependencyDir
        ? resolveTargetPackageDir(targetNodeModulesDir, dependency.name)
        : path.join(targetPackageDir, 'node_modules', ...splitPackageName(dependency.name))

      const targetKey = `${dependencyDir}\0${dependencyTargetDir}`
      if (primaryPackageDir !== dependencyDir && !copiedDependencyTargets.has(targetKey)) {
        copyPackageBody(dependencyDir, dependencyTargetDir)
        copiedDependencyTargets.add(targetKey)
      }

      copyNestedDependencies(dependencyDir, dependencyTargetDir, nextSourceStack)
    }
  }

  copyNestedDependencies(sourcePackageDir, resolveTargetPackageDir(targetNodeModulesDir, packageName))
}

const isCurrentCachedPackage = ({ cacheDir, integrity, packageName, version }) => {
  const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
  const packageInfo = readPackageInfo(packageDir)
  if (packageInfo?.name !== packageName || packageInfo.version !== version) {
    return false
  }

  const manifest = readManifest(cacheDir)
  if (
    manifest?.source === 'builtin' &&
    manifest.layoutVersion === CACHE_LAYOUT_VERSION &&
    manifest.name === packageName &&
    manifest.version === version &&
    manifest.integrity === integrity
  ) {
    return true
  }

  try {
    return hashPackageClosure(packageName, packageDir) === integrity
  } catch {
    return false
  }
}

const isCurrentCachedNpmPackage = ({ cacheDir, cacheVersion, integrity, packageName, version }) => {
  const packageDir = resolveNpmPackageInstallDir(cacheDir, packageName)
  const packageInfo = readPackageInfo(packageDir)
  if (packageInfo?.name !== packageName || packageInfo.version !== version) {
    return false
  }

  const manifest = readManifest(cacheDir)
  if (
    manifest?.source === 'builtin' &&
    manifest.cacheVersion === cacheVersion &&
    manifest.layoutVersion === CACHE_LAYOUT_VERSION &&
    manifest.name === packageName &&
    manifest.version === version &&
    manifest.integrity === integrity
  ) {
    return true
  }

  try {
    return hashPackageClosure(packageName, packageDir) === integrity
  } catch {
    return false
  }
}

const materializeBuiltinAdapterPackage = ({ homeDir, packageCacheRootDir, packageName, sourcePackageDir }) => {
  const packageInfo = readPackageInfo(sourcePackageDir)
  if (packageInfo?.name !== packageName || packageInfo.version == null) {
    throw new Error(`Invalid built-in adapter package: ${packageName}`)
  }

  const integrity = hashPackageClosure(packageName, sourcePackageDir)
  const cacheDir = resolveAdapterPackageCacheDir(packageName, packageInfo.version, homeDir, packageCacheRootDir)
  if (
    isCurrentCachedPackage({
      cacheDir,
      integrity,
      packageName,
      version: packageInfo.version
    })
  ) {
    return {
      cacheDir,
      packageDir: resolveAdapterPackageInstallDir(cacheDir, packageName),
      seeded: false,
      version: packageInfo.version
    }
  }

  const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  try {
    copyPackageClosure(packageName, sourcePackageDir, path.join(stagingDir, 'node_modules'))
    writeManifest(stagingDir, {
      createdAt: new Date().toISOString(),
      integrity,
      layoutVersion: CACHE_LAYOUT_VERSION,
      name: packageName,
      source: 'builtin',
      version: packageInfo.version
    })

    fs.mkdirSync(path.dirname(cacheDir), { recursive: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
    fs.renameSync(stagingDir, cacheDir)
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }

  return {
    cacheDir,
    packageDir: resolveAdapterPackageInstallDir(cacheDir, packageName),
    seeded: true,
    version: packageInfo.version
  }
}

const materializeBuiltinPluginPackage = ({
  cacheVersion = 'latest',
  homeDir,
  packageCacheRootDir,
  packageName,
  sourcePackageDir
}) => {
  const packageInfo = readPackageInfo(sourcePackageDir)
  if (packageInfo?.name !== packageName || packageInfo.version == null) {
    throw new Error(`Invalid built-in plugin package: ${packageName}`)
  }

  const integrity = hashPackageClosure(packageName, sourcePackageDir)
  const cacheDir = resolveNpmPackageCacheDir(packageName, cacheVersion, homeDir, packageCacheRootDir)
  if (
    isCurrentCachedNpmPackage({
      cacheDir,
      cacheVersion,
      integrity,
      packageName,
      version: packageInfo.version
    })
  ) {
    return {
      cacheDir,
      packageDir: resolveNpmPackageInstallDir(cacheDir, packageName),
      seeded: false
    }
  }

  const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })
  try {
    copyPackageClosure(packageName, sourcePackageDir, path.join(stagingDir, 'node_modules'))
    writeManifest(stagingDir, {
      cacheVersion,
      createdAt: new Date().toISOString(),
      integrity,
      layoutVersion: CACHE_LAYOUT_VERSION,
      name: packageName,
      source: 'builtin',
      version: packageInfo.version
    }, NPM_PACKAGE_MANIFEST_FILE)

    fs.mkdirSync(path.dirname(cacheDir), { recursive: true })
    fs.rmSync(cacheDir, { recursive: true, force: true })
    fs.renameSync(stagingDir, cacheDir)
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }

  return {
    cacheDir,
    packageDir: resolveNpmPackageInstallDir(cacheDir, packageName),
    seeded: true
  }
}

const resolveBuiltinAdapterPackageDir = (packageName) => (
  fs.realpathSync(path.dirname(require.resolve(`${packageName}/package.json`)))
)

const resolveBuiltinPluginPackageDir = (packageName) => (
  fs.realpathSync(path.dirname(require.resolve(`${packageName}/package.json`)))
)

const ensureBuiltinAdapterPackageCache = (options = {}) => {
  const homeDir = options.homeDir ?? resolveRealHomeDir(options.env)
  const packageCacheRootDir = options.packageCacheRootDir ?? resolvePackageCacheRootDir(options.env, homeDir)
  const packages = options.packages ?? BUILTIN_ADAPTER_PACKAGES
  const seededPackages = packages.map((packageName) =>
    materializeBuiltinAdapterPackage({
      homeDir,
      packageCacheRootDir,
      packageName,
      sourcePackageDir: options.resolvePackageDir?.(packageName) ?? resolveBuiltinAdapterPackageDir(packageName)
    })
  )
  const packageMetadata = Object.fromEntries(
    packages.map((packageName, index) => {
      const seededPackage = seededPackages[index]
      return [
        packageName,
        {
          cacheDir: seededPackage.cacheDir,
          packageDir: seededPackage.packageDir,
          version: seededPackage.version
        }
      ]
    })
  )
  process.env[BUILTIN_ADAPTER_PACKAGE_ENV] = JSON.stringify(packageMetadata)
  return seededPackages
}

const ensureBuiltinPluginPackageCache = (options = {}) => {
  const homeDir = options.homeDir ?? resolveRealHomeDir(options.env)
  const packageCacheRootDir = options.packageCacheRootDir ?? resolvePackageCacheRootDir(options.env, homeDir)
  const packages = options.packages ?? BUILTIN_PLUGIN_PACKAGES
  return packages.flatMap((packageName) => {
    const sourcePackageDir = options.resolvePackageDir?.(packageName) ?? resolveBuiltinPluginPackageDir(packageName)
    const packageInfo = readPackageInfo(sourcePackageDir)
    if (packageInfo?.version == null) {
      throw new Error(`Invalid built-in plugin package: ${packageName}`)
    }

    const cacheVersions = ['latest', packageInfo.version]
      .filter((version, index, versions) => versions.indexOf(version) === index)
    return cacheVersions.map(cacheVersion =>
      materializeBuiltinPluginPackage({
        cacheVersion,
        homeDir,
        packageCacheRootDir,
        packageName,
        sourcePackageDir
      })
    )
  })
}

module.exports = {
  BUILTIN_ADAPTER_PACKAGES,
  BUILTIN_ADAPTER_PACKAGE_ENV,
  BUILTIN_PLUGIN_PACKAGES,
  CACHE_LAYOUT_VERSION,
  MANIFEST_FILE,
  NPM_PACKAGE_MANIFEST_FILE,
  ensureBuiltinAdapterPackageCache,
  ensureBuiltinPluginPackageCache,
  hashPackageDirectory,
  hashPackageClosure,
  materializeBuiltinAdapterPackage,
  materializeBuiltinPluginPackage,
  resolveAdapterPackageCacheDir,
  resolveAdapterPackageInstallDir,
  resolveAdapterPackagesRoot,
  resolveNpmPackageCacheDir,
  resolveNpmPackageInstallDir,
  resolvePackageCacheRootDir,
  resolveRealHomeDir,
  sanitizePackageName
}
