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
  '@oneworks/plugin-relay'
]
const BUILTIN_RUNTIME_CLI_PACKAGE = '@oneworks/cli'
const BUILTIN_RUNTIME_SERVER_PACKAGE = '@oneworks/server'
const BUILTIN_RUNTIME_CLIENT_PACKAGE = '@oneworks/client'

const MANIFEST_FILE = '.oneworks-adapter-cache.json'
const NPM_PACKAGE_MANIFEST_FILE = '.oneworks-package-cache.json'
const PACKAGE_CACHE_LAYOUT_VERSION = 4
const BUILTIN_ADAPTER_PACKAGE_ENV = '__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__'
const RUNTIME_PACKAGE_CACHE_VERSION_ENV = '__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__'
const PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV = 'ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION'
const DESKTOP_DEV_RUNTIME_VERSION_ENV = '__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__'
const PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV = 'ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION'
const BUILTIN_PACKAGE_CACHE_PREPARED_ENV = '__ONEWORKS_DESKTOP_BUILTIN_PACKAGE_CACHE_PREPARED__'
const RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV = '__ONEWORKS_DESKTOP_RUNTIME_PACKAGE_BUILD_FINGERPRINT__'
const TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV = '__ONEWORKS_DESKTOP_TRUST_DEV_RUNTIME_CACHE_MANIFEST__'
const PACKAGE_CACHE_VERSION_PATTERN = /^[\w.+-]+$/u
const SKIPPED_PACKAGE_ENTRIES = new Set(['node_modules'])

const normalizeEnvPath = value => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizePackageCacheVersion = (value) => {
  const normalized = normalizeEnvPath(value)
  if (normalized == null) return undefined
  if (!PACKAGE_CACHE_VERSION_PATTERN.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`Runtime package cache version contains unsupported characters: ${normalized}.`)
  }
  return normalized
}

const sanitizePackageName = packageName => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

const splitPackageName = packageName => packageName.split('/')

const hashString = value => crypto.createHash('sha256').update(value).digest('hex')

const resolveRealHomeDir = (env = process.env) => (
  normalizeEnvPath(env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeEnvPath(env.HOME) ??
    normalizeEnvPath(env.USERPROFILE) ??
    os.homedir()
)

const resolvePackageCacheRootDir = (env = process.env, homeDir = resolveRealHomeDir(env)) => (
  normalizeEnvPath(env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__) ?? path.join(homeDir, '.oneworks', 'bootstrap')
)

const resolveDesktopDevRuntimeVersion = (env = process.env) => (
  normalizePackageCacheVersion(env[RUNTIME_PACKAGE_CACHE_VERSION_ENV]) ??
    normalizePackageCacheVersion(env[PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]) ??
    normalizePackageCacheVersion(env[DESKTOP_DEV_RUNTIME_VERSION_ENV]) ??
    normalizePackageCacheVersion(env[PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV])
)

const resolveRuntimePackageBuildFingerprint = (options = {}) => (
  normalizePackageCacheVersion(options.sourceCacheVersion) ??
    normalizePackageCacheVersion(options.env?.[RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV])
)

const shouldTrustPackageCacheManifest = ({
  cacheVersion,
  env = process.env,
  sourceCacheVersion,
  trustManifest = false
}) => (
  trustManifest === true &&
  (
    (
      sourceCacheVersion != null &&
      env[TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV] === '1'
    ) ||
    (
      sourceCacheVersion == null &&
      !cacheVersion?.startsWith('dev-')
    )
  )
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
  const peerDependencies = Object.keys(parsed.peerDependencies ?? {})
    .filter(name =>
      !Object.hasOwn(parsed.dependencies ?? {}, name) &&
      !Object.hasOwn(parsed.optionalDependencies ?? {}, name)
    )
    .map(name => ({
      name,
      optional: parsed.peerDependenciesMeta?.[name]?.optional === true
    }))

  return [
    ...dependencies,
    ...optionalDependencies,
    ...peerDependencies
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
  const queue = [{ packageDir, packageName, root: true }]

  while (queue.length > 0) {
    const current = queue.shift()
    const packageInfo = readPackageInfo(current.packageDir)
    if (packageInfo?.name == null) continue
    if (current.root && packageInfo.name !== current.packageName) continue

    const key = `${packageInfo.name}@${packageInfo.version ?? ''}:${current.packageDir}`
    if (seen.has(key)) continue
    seen.add(key)
    packages.push({
      packageDir: current.packageDir,
      packageName: packageInfo.name
    })

    for (const dependency of resolvePackageDependencyEntries(current.packageDir)) {
      const dependencyDir = resolveDependencyPackageDir(current.packageDir, dependency.name)
      if (dependencyDir == null && !dependency.optional) {
        throw new Error(`Failed to resolve dependency ${dependency.name} for ${current.packageName}.`)
      }
      if (dependencyDir != null) {
        queue.push({
          packageDir: dependencyDir,
          packageName: dependency.name,
          root: false
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

const resolveTrustedPackageIntegrity = ({
  arch,
  cacheVersion,
  packageName,
  platform,
  sourcePackageDir,
  sourceCacheVersion,
  version
}) =>
  `trusted-${
    hashString([
      arch,
      cacheVersion,
      packageName,
      platform,
      sourcePackageDir == null ? '' : fs.realpathSync(sourcePackageDir),
      sourceCacheVersion ?? '',
      version
    ].join('\0'))
  }`

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
        mode: fs.constants.COPYFILE_FICLONE,
        recursive: true
      }
    )
  }
}

const createPackageStoreDirName = ({ packageDir, packageInfo }) => (
  `${sanitizePackageName(packageInfo.name)}@${packageInfo.version ?? 'unknown'}-${hashString(packageDir).slice(0, 16)}`
)

const resolvePackageStoreDir = ({ packageDir, packageInfo, targetNodeModulesDir }) => (
  path.join(
    targetNodeModulesDir,
    '.oneworks-packages',
    createPackageStoreDirName({ packageDir, packageInfo }),
    'node_modules',
    ...splitPackageName(packageInfo.name)
  )
)

const createPackageGraphEntries = (packageName, sourcePackageDir, targetNodeModulesDir) => (
  resolvePackageClosure(packageName, sourcePackageDir).map((item) => {
    const packageDir = fs.realpathSync(item.packageDir)
    const packageInfo = readPackageInfo(packageDir)
    if (packageInfo?.name !== item.packageName) {
      throw new Error(`Invalid package dependency ${item.packageName}.`)
    }

    return {
      packageDir,
      packageInfo,
      packageName: item.packageName,
      storePackageDir: resolvePackageStoreDir({
        packageDir,
        packageInfo,
        targetNodeModulesDir
      })
    }
  })
)

const symlinkPackageDir = (targetPackageDir, sourcePackageDir) => {
  fs.rmSync(targetPackageDir, { force: true, recursive: true })
  fs.mkdirSync(path.dirname(targetPackageDir), { recursive: true })
  const linkTarget = process.platform === 'win32'
    ? sourcePackageDir
    : path.relative(path.dirname(targetPackageDir), sourcePackageDir) || '.'
  fs.symlinkSync(linkTarget, targetPackageDir, process.platform === 'win32' ? 'junction' : 'dir')
}

const copyPackageClosure = (packageName, sourcePackageDir, targetNodeModulesDir) => {
  const entries = createPackageGraphEntries(packageName, sourcePackageDir, targetNodeModulesDir)
  const entryByPackageDir = new Map(entries.map(entry => [entry.packageDir, entry]))

  for (const entry of entries) {
    copyPackageBody(entry.packageDir, entry.storePackageDir)
  }

  for (const entry of entries) {
    for (const dependency of resolvePackageDependencyEntries(entry.packageDir)) {
      const dependencyDir = resolveDependencyPackageDir(entry.packageDir, dependency.name)
      if (dependencyDir == null && !dependency.optional) {
        throw new Error(`Failed to resolve dependency ${dependency.name} for ${entry.packageName}.`)
      }
      if (dependencyDir == null) continue

      const dependencyEntry = entryByPackageDir.get(fs.realpathSync(dependencyDir))
      if (dependencyEntry == null) continue
      symlinkPackageDir(
        path.join(entry.storePackageDir, 'node_modules', ...splitPackageName(dependency.name)),
        dependencyEntry.storePackageDir
      )
    }
  }

  const rootEntry = entryByPackageDir.get(fs.realpathSync(sourcePackageDir))
  if (rootEntry == null) {
    throw new Error(`Failed to materialize package graph for ${packageName}.`)
  }
  symlinkPackageDir(
    path.join(targetNodeModulesDir, ...splitPackageName(packageName)),
    rootEntry.storePackageDir
  )
}

const isCurrentCachedPackage = ({ cacheDir, cacheVersion, integrity, packageName, version }) => {
  const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
  const packageInfo = readPackageInfo(packageDir)
  if (packageInfo?.name !== packageName || packageInfo.version !== version) {
    return false
  }

  const manifest = readManifest(cacheDir)
  if (
    manifest?.source === 'builtin' &&
    (manifest.cacheVersion ?? manifest.version) === cacheVersion &&
    manifest.layoutVersion === PACKAGE_CACHE_LAYOUT_VERSION &&
    manifest.name === packageName &&
    manifest.version === version &&
    manifest.integrity === integrity
  ) {
    return true
  }

  if (manifest?.source === 'builtin') return false

  if (cacheVersion !== version) return false

  try {
    return hashPackageClosure(packageName, packageDir) === integrity
  } catch {
    return false
  }
}

const isCurrentCachedPackageManifest = (
  { arch, cacheDir, cacheVersion, manifestFile = MANIFEST_FILE, packageName, platform, sourceCacheVersion, version }
) => {
  const packageDir = manifestFile === MANIFEST_FILE
    ? resolveAdapterPackageInstallDir(cacheDir, packageName)
    : resolveNpmPackageInstallDir(cacheDir, packageName)
  const packageInfo = readPackageInfo(packageDir)
  if (packageInfo?.name !== packageName || packageInfo.version !== version) {
    return false
  }

  const manifest = readManifest(cacheDir, manifestFile)
  return manifest?.source === 'builtin' &&
    manifest.arch === arch &&
    (manifest.cacheVersion ?? manifest.version) === cacheVersion &&
    manifest.layoutVersion === PACKAGE_CACHE_LAYOUT_VERSION &&
    manifest.name === packageName &&
    manifest.platform === platform &&
    (
      sourceCacheVersion == null
        ? manifest.sourceCacheVersion == null
        : manifest.sourceCacheVersion === sourceCacheVersion
    ) &&
    manifest.version === version
}

const isCurrentCachedNpmPackage = ({ cacheDir, cacheVersion, integrity, packageName, version }) => {
  const packageDir = resolveNpmPackageInstallDir(cacheDir, packageName)
  const packageInfo = readPackageInfo(packageDir)
  if (packageInfo?.name !== packageName || packageInfo.version !== version) {
    return false
  }

  const manifest = readManifest(cacheDir, NPM_PACKAGE_MANIFEST_FILE)
  if (
    manifest?.source === 'builtin' &&
    manifest.cacheVersion === cacheVersion &&
    manifest.layoutVersion === PACKAGE_CACHE_LAYOUT_VERSION &&
    manifest.name === packageName &&
    manifest.version === version &&
    manifest.integrity === integrity
  ) {
    return true
  }

  if (manifest?.source === 'builtin') return false

  try {
    return hashPackageClosure(packageName, packageDir) === integrity
  } catch {
    return false
  }
}

const materializeBuiltinAdapterPackage = ({
  arch = process.arch,
  cacheVersion,
  homeDir,
  packageCacheRootDir,
  packageName,
  platform = process.platform,
  sourceCacheVersion,
  sourcePackageDir,
  trustManifest = false
}) => {
  const packageInfo = readPackageInfo(sourcePackageDir)
  if (packageInfo?.name !== packageName || packageInfo.version == null) {
    throw new Error(`Invalid built-in adapter package: ${packageName}`)
  }

  const resolvedCacheVersion = normalizePackageCacheVersion(cacheVersion) ?? packageInfo.version
  const cacheDir = resolveAdapterPackageCacheDir(packageName, resolvedCacheVersion, homeDir, packageCacheRootDir)
  if (
    trustManifest === true &&
    isCurrentCachedPackageManifest({
      arch,
      cacheDir,
      cacheVersion: resolvedCacheVersion,
      packageName,
      platform,
      sourceCacheVersion,
      version: packageInfo.version
    })
  ) {
    return {
      cacheVersion: resolvedCacheVersion,
      cacheDir,
      packageDir: resolveAdapterPackageInstallDir(cacheDir, packageName),
      seeded: false,
      version: packageInfo.version
    }
  }

  const integrity = trustManifest
    ? resolveTrustedPackageIntegrity({
      arch,
      cacheVersion: resolvedCacheVersion,
      packageName,
      platform,
      sourceCacheVersion,
      version: packageInfo.version
    })
    : hashPackageClosure(packageName, sourcePackageDir)
  if (
    isCurrentCachedPackage({
      cacheDir,
      cacheVersion: resolvedCacheVersion,
      integrity,
      packageName,
      version: packageInfo.version
    })
  ) {
    const manifest = readManifest(cacheDir)
    if (
      manifest?.arch !== arch ||
      manifest?.platform !== platform ||
      manifest?.sourceCacheVersion !== sourceCacheVersion
    ) {
      writeManifest(cacheDir, {
        arch,
        cacheVersion: resolvedCacheVersion,
        createdAt: manifest?.createdAt ?? new Date().toISOString(),
        integrity,
        layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
        name: packageName,
        platform,
        source: 'builtin',
        ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
        version: packageInfo.version
      })
    }
    return {
      cacheVersion: resolvedCacheVersion,
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
      arch,
      cacheVersion: resolvedCacheVersion,
      createdAt: new Date().toISOString(),
      integrity,
      layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
      name: packageName,
      platform,
      source: 'builtin',
      ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
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
    cacheVersion: resolvedCacheVersion,
    cacheDir,
    packageDir: resolveAdapterPackageInstallDir(cacheDir, packageName),
    seeded: true,
    version: packageInfo.version
  }
}

const materializeBuiltinPluginPackage = ({
  arch = process.arch,
  cacheVersion = 'latest',
  homeDir,
  packageCacheRootDir,
  packageName,
  platform = process.platform,
  sourceCacheVersion,
  sourcePackageDir,
  trustManifest = false
}) => {
  const packageInfo = readPackageInfo(sourcePackageDir)
  if (packageInfo?.name !== packageName || packageInfo.version == null) {
    throw new Error(`Invalid built-in plugin package: ${packageName}`)
  }

  const cacheDir = resolveNpmPackageCacheDir(packageName, cacheVersion, homeDir, packageCacheRootDir)
  const integrity = trustManifest
    ? resolveTrustedPackageIntegrity({
      arch,
      cacheVersion,
      packageName,
      platform,
      sourcePackageDir,
      sourceCacheVersion,
      version: packageInfo.version
    })
    : hashPackageClosure(packageName, sourcePackageDir)
  if (
    isCurrentCachedNpmPackage({
      cacheDir,
      cacheVersion,
      integrity,
      packageName,
      version: packageInfo.version
    })
  ) {
    const manifest = readManifest(cacheDir, NPM_PACKAGE_MANIFEST_FILE)
    if (
      manifest?.arch !== arch ||
      manifest?.platform !== platform ||
      manifest?.sourceCacheVersion !== sourceCacheVersion
    ) {
      writeManifest(cacheDir, {
        arch,
        cacheVersion,
        createdAt: manifest?.createdAt ?? new Date().toISOString(),
        integrity,
        layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
        name: packageName,
        platform,
        source: 'builtin',
        ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
        version: packageInfo.version
      }, NPM_PACKAGE_MANIFEST_FILE)
    }
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
    if (trustManifest) {
      symlinkPackageDir(
        resolveNpmPackageInstallDir(stagingDir, packageName),
        sourcePackageDir
      )
    } else {
      copyPackageClosure(packageName, sourcePackageDir, path.join(stagingDir, 'node_modules'))
    }
    writeManifest(stagingDir, {
      arch,
      cacheVersion,
      createdAt: new Date().toISOString(),
      integrity,
      layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
      name: packageName,
      platform,
      source: 'builtin',
      ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
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

const linkBuiltinPluginPackageCache = ({
  arch = process.arch,
  cacheVersion,
  homeDir,
  packageCacheRootDir,
  packageName,
  platform = process.platform,
  sourceCacheDir,
  sourceCacheVersion,
  version
}) => {
  const sourceManifest = readManifest(sourceCacheDir, NPM_PACKAGE_MANIFEST_FILE)
  if (sourceManifest?.source !== 'builtin' || typeof sourceManifest.integrity !== 'string') {
    throw new Error(`Invalid source cache for built-in plugin: ${packageName}`)
  }

  const cacheDir = resolveNpmPackageCacheDir(packageName, cacheVersion, homeDir, packageCacheRootDir)
  const manifest = readManifest(cacheDir, NPM_PACKAGE_MANIFEST_FILE)
  if (
    isCurrentCachedPackageManifest({
      arch,
      cacheDir,
      cacheVersion,
      manifestFile: NPM_PACKAGE_MANIFEST_FILE,
      packageName,
      platform,
      sourceCacheVersion,
      version
    }) &&
    manifest?.integrity === sourceManifest.integrity
  ) {
    return {
      cacheDir,
      packageDir: resolveNpmPackageInstallDir(cacheDir, packageName),
      seeded: false
    }
  }

  const stagingDir = `${cacheDir}.tmp-${process.pid}-${Date.now()}`
  fs.rmSync(stagingDir, { recursive: true, force: true })
  try {
    fs.mkdirSync(stagingDir, { recursive: true })
    symlinkPackageDir(
      path.join(stagingDir, 'node_modules'),
      path.join(sourceCacheDir, 'node_modules')
    )
    writeManifest(stagingDir, {
      arch,
      cacheVersion,
      createdAt: new Date().toISOString(),
      integrity: sourceManifest.integrity,
      layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
      name: packageName,
      platform,
      source: 'builtin',
      ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
      version
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

const materializeBuiltinStaticNpmPackage = ({
  arch = process.arch,
  cacheVersion,
  homeDir,
  packageCacheRootDir,
  packageName,
  platform = process.platform,
  sourceCacheVersion,
  sourcePackageDir,
  trustManifest = false
}) => {
  const packageInfo = readPackageInfo(sourcePackageDir)
  if (packageInfo?.name !== packageName || packageInfo.version == null) {
    throw new Error(`Invalid built-in static package: ${packageName}`)
  }

  const cacheDir = resolveNpmPackageCacheDir(packageName, cacheVersion, homeDir, packageCacheRootDir)
  if (
    trustManifest === true &&
    isCurrentCachedPackageManifest({
      arch,
      cacheDir,
      cacheVersion,
      manifestFile: NPM_PACKAGE_MANIFEST_FILE,
      packageName,
      platform,
      sourceCacheVersion,
      version: packageInfo.version
    })
  ) {
    return {
      cacheDir,
      packageDir: resolveNpmPackageInstallDir(cacheDir, packageName),
      seeded: false
    }
  }

  const integrity = trustManifest
    ? resolveTrustedPackageIntegrity({
      arch,
      cacheVersion,
      packageName,
      platform,
      sourceCacheVersion,
      version: packageInfo.version
    })
    : hashPackageDirectory(sourcePackageDir)
  if (
    isCurrentCachedNpmPackage({
      cacheDir,
      cacheVersion,
      integrity,
      packageName,
      version: packageInfo.version
    })
  ) {
    const manifest = readManifest(cacheDir, NPM_PACKAGE_MANIFEST_FILE)
    if (
      manifest?.arch !== arch ||
      manifest?.platform !== platform ||
      manifest?.sourceCacheVersion !== sourceCacheVersion
    ) {
      writeManifest(cacheDir, {
        arch,
        cacheVersion,
        createdAt: manifest?.createdAt ?? new Date().toISOString(),
        integrity,
        layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
        name: packageName,
        platform,
        source: 'builtin',
        ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
        version: packageInfo.version
      }, NPM_PACKAGE_MANIFEST_FILE)
    }
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
    const targetPackageDir = resolveNpmPackageInstallDir(stagingDir, packageName)
    copyPackageBody(sourcePackageDir, targetPackageDir)
    writeManifest(stagingDir, {
      arch,
      cacheVersion,
      createdAt: new Date().toISOString(),
      integrity,
      layoutVersion: PACKAGE_CACHE_LAYOUT_VERSION,
      name: packageName,
      platform,
      source: 'builtin',
      ...(sourceCacheVersion == null ? {} : { sourceCacheVersion }),
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

const resolveBundledRuntimeClientPackageDir = () => {
  const packageDir = path.resolve(__dirname, '..', 'runtime-packages', '@oneworks', 'client')
  return fs.existsSync(path.join(packageDir, 'package.json')) ? packageDir : undefined
}

const ensureBuiltinAdapterPackageCache = (options = {}) => {
  const homeDir = options.homeDir ?? resolveRealHomeDir(options.env)
  const packageCacheRootDir = options.packageCacheRootDir ?? resolvePackageCacheRootDir(options.env, homeDir)
  const packages = options.packages ?? BUILTIN_ADAPTER_PACKAGES
  const cacheVersion = options.cacheVersion ?? resolveDesktopDevRuntimeVersion(options.env)
  const sourceCacheVersion = resolveRuntimePackageBuildFingerprint(options)
  const trustManifest = shouldTrustPackageCacheManifest({
    cacheVersion,
    env: options.env,
    sourceCacheVersion,
    trustManifest: options.trustManifest
  })
  const seededPackages = packages.map((packageName) =>
    materializeBuiltinAdapterPackage({
      arch: options.arch,
      cacheVersion,
      homeDir,
      packageCacheRootDir,
      packageName,
      platform: options.platform,
      sourceCacheVersion: trustManifest ? sourceCacheVersion : undefined,
      sourcePackageDir: options.resolvePackageDir?.(packageName) ?? resolveBuiltinAdapterPackageDir(packageName),
      trustManifest
    })
  )
  const packageMetadata = Object.fromEntries(
    packages.map((packageName, index) => {
      const seededPackage = seededPackages[index]
      return [
        packageName,
        {
          cacheVersion: seededPackage.cacheVersion,
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
  const runtimeCacheVersion = normalizePackageCacheVersion(options.cacheVersion) ??
    resolveDesktopDevRuntimeVersion(options.env)
  const sourceCacheVersion = resolveRuntimePackageBuildFingerprint(options)
  const trustManifest = shouldTrustPackageCacheManifest({
    cacheVersion: runtimeCacheVersion,
    env: options.env,
    sourceCacheVersion,
    trustManifest: options.trustManifest
  })
  return packages.flatMap((packageName) => {
    const sourcePackageDir = options.resolvePackageDir?.(packageName) ?? resolveBuiltinPluginPackageDir(packageName)
    const packageInfo = readPackageInfo(sourcePackageDir)
    if (packageInfo?.version == null) {
      throw new Error(`Invalid built-in plugin package: ${packageName}`)
    }

    const versionCache = materializeBuiltinPluginPackage({
      arch: options.arch,
      cacheVersion: packageInfo.version,
      homeDir,
      packageCacheRootDir,
      packageName,
      platform: options.platform,
      sourceCacheVersion: trustManifest ? sourceCacheVersion : undefined,
      sourcePackageDir,
      trustManifest
    })
    if (packageInfo.version === 'latest') return [versionCache]

    const latestCache = linkBuiltinPluginPackageCache({
      arch: options.arch,
      cacheVersion: 'latest',
      homeDir,
      packageCacheRootDir,
      packageName,
      platform: options.platform,
      sourceCacheDir: versionCache.cacheDir,
      sourceCacheVersion: trustManifest ? sourceCacheVersion : undefined,
      version: packageInfo.version
    })
    return [latestCache, versionCache]
  })
}

const ensureBuiltinRuntimePackageCache = (options = {}) => {
  const cacheVersion = normalizePackageCacheVersion(options.cacheVersion) ??
    resolveDesktopDevRuntimeVersion(options.env)
  if (cacheVersion == null) return []

  const homeDir = options.homeDir ?? resolveRealHomeDir(options.env)
  const packageCacheRootDir = options.packageCacheRootDir ?? resolvePackageCacheRootDir(options.env, homeDir)
  const sourceCacheVersion = resolveRuntimePackageBuildFingerprint(options)
  const trustManifest = shouldTrustPackageCacheManifest({
    cacheVersion,
    env: options.env,
    sourceCacheVersion,
    trustManifest: options.trustManifest
  })
  const seeded = []

  const cliPackageDir = options.resolvePackageDir?.(BUILTIN_RUNTIME_CLI_PACKAGE) ??
    resolveBuiltinPluginPackageDir(BUILTIN_RUNTIME_CLI_PACKAGE)
  seeded.push(materializeBuiltinPluginPackage({
    arch: options.arch,
    cacheVersion,
    homeDir,
    packageCacheRootDir,
    packageName: BUILTIN_RUNTIME_CLI_PACKAGE,
    platform: options.platform,
    sourceCacheVersion: trustManifest ? sourceCacheVersion : undefined,
    sourcePackageDir: cliPackageDir,
    trustManifest
  }))

  const serverPackageDir = options.resolvePackageDir?.(BUILTIN_RUNTIME_SERVER_PACKAGE) ??
    resolveBuiltinPluginPackageDir(BUILTIN_RUNTIME_SERVER_PACKAGE)
  seeded.push(materializeBuiltinPluginPackage({
    arch: options.arch,
    cacheVersion,
    homeDir,
    packageCacheRootDir,
    packageName: BUILTIN_RUNTIME_SERVER_PACKAGE,
    platform: options.platform,
    sourceCacheVersion: trustManifest ? sourceCacheVersion : undefined,
    sourcePackageDir: serverPackageDir,
    trustManifest
  }))

  const clientPackageDir = options.resolvePackageDir?.(BUILTIN_RUNTIME_CLIENT_PACKAGE) ??
    resolveBundledRuntimeClientPackageDir()
  if (clientPackageDir != null) {
    seeded.push(materializeBuiltinStaticNpmPackage({
      arch: options.arch,
      cacheVersion,
      homeDir,
      packageCacheRootDir,
      packageName: BUILTIN_RUNTIME_CLIENT_PACKAGE,
      platform: options.platform,
      sourceCacheVersion: trustManifest ? sourceCacheVersion : undefined,
      sourcePackageDir: clientPackageDir,
      trustManifest
    }))
  }

  return seeded
}

const runBuiltinPackageCachePreparationOnce = ({
  env = process.env,
  prepare
}) => {
  if (env[BUILTIN_PACKAGE_CACHE_PREPARED_ENV] === '1') return false
  if (typeof prepare !== 'function') {
    throw new TypeError('prepare must be a function')
  }

  prepare()
  env[BUILTIN_PACKAGE_CACHE_PREPARED_ENV] = '1'
  return true
}

module.exports = {
  BUILTIN_PACKAGE_CACHE_PREPARED_ENV,
  BUILTIN_ADAPTER_PACKAGES,
  BUILTIN_ADAPTER_PACKAGE_ENV,
  BUILTIN_PLUGIN_PACKAGES,
  BUILTIN_RUNTIME_CLI_PACKAGE,
  BUILTIN_RUNTIME_CLIENT_PACKAGE,
  BUILTIN_RUNTIME_SERVER_PACKAGE,
  DESKTOP_DEV_RUNTIME_VERSION_ENV,
  MANIFEST_FILE,
  NPM_PACKAGE_MANIFEST_FILE,
  PACKAGE_CACHE_LAYOUT_VERSION,
  PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV,
  PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV,
  RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV,
  RUNTIME_PACKAGE_CACHE_VERSION_ENV,
  TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV,
  ensureBuiltinAdapterPackageCache,
  ensureBuiltinPluginPackageCache,
  ensureBuiltinRuntimePackageCache,
  hashPackageDirectory,
  hashPackageClosure,
  materializeBuiltinAdapterPackage,
  materializeBuiltinPluginPackage,
  materializeBuiltinStaticNpmPackage,
  resolveAdapterPackageCacheDir,
  resolveAdapterPackageInstallDir,
  resolveAdapterPackagesRoot,
  resolveDesktopDevRuntimeVersion,
  resolveNpmPackageCacheDir,
  resolveNpmPackageInstallDir,
  resolvePackageCacheRootDir,
  resolveRealHomeDir,
  runBuiltinPackageCachePreparationOnce,
  sanitizePackageName
}
