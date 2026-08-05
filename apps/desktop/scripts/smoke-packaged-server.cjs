const { Buffer } = require('node:buffer')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const { resolveProjectHomePath } = require('@oneworks/register/dotenv')
const { BUILTIN_PLUGIN_PACKAGES } = require('../src/builtin-adapter-cache.cjs')
const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { normalizeArch } = require('./desktop-archs.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')
const outputDir = path.join(desktopRoot, 'out')
const appMetadata = resolveDesktopAppMetadata()
const appName = appMetadata.productName
const host = '127.0.0.1'
const resolvePositiveTimeoutMs = (env, name, fallbackMs) => {
  const rawValue = env[name]?.trim() || String(fallbackMs)
  if (!/^[1-9]\d*$/u.test(rawValue)) {
    throw new Error(`${name} must be a positive integer, received: ${rawValue}`)
  }
  const value = Number(rawValue)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received: ${rawValue}`)
  }
  return value
}
const serverReadyTimeoutMs = resolvePositiveTimeoutMs(
  process.env,
  'ONEWORKS_DESKTOP_SMOKE_TIMEOUT_MS',
  120000
)
const serverRequestTimeoutMs = resolvePositiveTimeoutMs(
  process.env,
  'ONEWORKS_DESKTOP_SMOKE_REQUEST_TIMEOUT_MS',
  30000
)
const serverCompileTimeoutMs = resolvePositiveTimeoutMs(
  process.env,
  'ONEWORKS_DESKTOP_SMOKE_COMPILE_TIMEOUT_MS',
  120000
)

const createWorkspaceRuntimeEnv = (
  runtimePackageCacheVersion,
  runtimePackageBuildFingerprint,
  workspaceFolder,
  realHomeDir,
  packageCacheRootDir
) => {
  const env = { ...process.env }
  delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceFolder
  if (realHomeDir != null) {
    delete env.__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__
    delete env.__ONEWORKS_DESKTOP_SERVER_PACKAGE_DIR__
    delete env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__
    delete env.__ONEWORKS_PROJECT_PACKAGE_DIR__
    delete env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER_CLI_PATH__
    delete env.__ONEWORKS_RUNTIME_PROTOCOL_FALLBACK_BOOTSTRAP_PATH__
    env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
  }
  if (packageCacheRootDir != null) {
    env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__ = packageCacheRootDir
  }
  if (runtimePackageCacheVersion != null) {
    env.__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__ = runtimePackageCacheVersion
    env.__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__ = runtimePackageCacheVersion
  }
  if (runtimePackageBuildFingerprint != null) {
    env.__ONEWORKS_DESKTOP_RUNTIME_PACKAGE_BUILD_FINGERPRINT__ = runtimePackageBuildFingerprint
    env.__ONEWORKS_DESKTOP_TRUST_DEV_RUNTIME_CACHE_MANIFEST__ = '1'
  }
  return env
}

const readRuntimePackageCacheMetadata = (resourcesDir) => {
  try {
    const buildSource = JSON.parse(
      fs.readFileSync(path.join(resourcesDir, 'desktop-build-source.json'), 'utf8')
    )
    return {
      runtimePackageBuildFingerprint: typeof buildSource.runtimePackageBuildFingerprint === 'string'
        ? buildSource.runtimePackageBuildFingerprint
        : undefined,
      runtimePackageCacheVersion: typeof buildSource.runtimePackageCacheVersion === 'string' &&
          buildSource.runtimePackageCacheVersion.startsWith('dev-')
        ? buildSource.runtimePackageCacheVersion
        : undefined
    }
  } catch {
    return {}
  }
}

const findPackageDir = () => {
  const packageDirs = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith(`${appName}-`))
    .map(entry => path.join(outputDir, entry.name))
    .sort()

  if (packageDirs.length === 0) {
    throw new Error(`Packaged app directory was not found in ${outputDir}`)
  }

  const preferredArch = normalizeArch(process.env.ONEWORKS_DESKTOP_SMOKE_ARCH?.trim() || process.arch)
  const preferredSuffix = `-${preferredArch}`
  const matchedPackageDir = packageDirs.find(packageDir => packageDir.endsWith(preferredSuffix))
  if (matchedPackageDir != null) {
    return matchedPackageDir
  }

  if (packageDirs.length === 1) {
    return packageDirs[0]
  }

  throw new Error(`Unable to resolve packaged app for arch ${preferredArch} in ${outputDir}`)
}

const firstExistingPath = (...candidates) => {
  const found = candidates.find(candidate => fs.existsSync(candidate))
  if (found == null) {
    throw new Error(`None of these paths exist:\n${candidates.join('\n')}`)
  }
  return found
}

const packagedBuiltinPluginRequirements = {
  '@oneworks/plugin-browser-driver': [
    'package.json',
    'plugin.json',
    'bin/browser-driver.cjs',
    'mcp/browser-driver.json',
    'skills/browser-driver/SKILL.md'
  ],
  '@oneworks/plugin-external-browser-driver': [
    'package.json',
    'assets/icon.svg',
    'plugin.json',
    'client/dist/index.js',
    'server/dist/index.js',
    'extension/manifest.json',
    'mcp/external-browser-driver.json',
    'skills/external-browser-driver/SKILL.md'
  ],
  '@oneworks/plugin-cua-driver': [
    'package.json',
    'plugin.json',
    'bin/cua-driver.cjs',
    'client/dist/index.js',
    'mcp/cua-driver.json',
    'server/dist/index.js',
    'skills/cua-driver/SKILL.md'
  ],
  '@oneworks/plugin-logger': [
    'package.json',
    'assets/icon.svg',
    'src/hooks.ts',
    'src/index.ts'
  ],
  '@oneworks/plugin-relay': [
    'package.json',
    'dist/client/index.js',
    'dist/config.cjs',
    'dist/config.js',
    'dist/server/index.js'
  ]
}

const assertPackagedBuiltinPlugins = (appDir) => {
  const requirementPackageNames = Object.keys(packagedBuiltinPluginRequirements).sort()
  const builtinPackageNames = [...BUILTIN_PLUGIN_PACKAGES].sort()
  if (JSON.stringify(requirementPackageNames) !== JSON.stringify(builtinPackageNames)) {
    throw new Error(
      `Packaged built-in plugin requirements are out of sync: ${
        JSON.stringify({ builtinPackageNames, requirementPackageNames })
      }`
    )
  }
  for (const [packageName, requiredPaths] of Object.entries(packagedBuiltinPluginRequirements)) {
    const packageDir = path.join(appDir, 'node_modules', ...packageName.split('/'))
    const missingPaths = requiredPaths.filter(relativePath => !fs.existsSync(path.join(packageDir, relativePath)))
    if (missingPaths.length === 0) continue
    throw new Error(
      `Packaged built-in plugin ${packageName} is missing production entries:\n${
        missingPaths.map(relativePath => path.join(packageDir, relativePath)).join('\n')
      }`
    )
  }
}

const packagedMainSmokeMarker = '[oneworks-desktop] packaged main smoke ready'

const runPackagedMainSmoke = async (paths) => {
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oneworks-desktop-main-smoke-'))
  const userDataDir = path.join(smokeRoot, 'user-data')
  fs.mkdirSync(userDataDir, { recursive: true })

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(paths.executablePath, [`--user-data-dir=${userDataDir}`], {
        env: {
          ...process.env,
          ONEWORKS_DESKTOP_PACKAGE_MAIN_SMOKE: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (error == null) resolve()
        else reject(error)
      }
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error(`Packaged Electron main smoke timed out.\n${output}`))
      }, 30000)

      child.stdout.on('data', chunk => {
        output += chunk
      })
      child.stderr.on('data', chunk => {
        output += chunk
      })
      child.once('error', finish)
      child.once('exit', (code, signal) => {
        if (code !== 0 || signal != null) {
          finish(new Error(`Packaged Electron main smoke exited with code=${code} signal=${signal}.\n${output}`))
          return
        }
        if (!output.includes(packagedMainSmokeMarker)) {
          finish(new Error(`Packaged Electron main smoke did not report readiness.\n${output}`))
          return
        }
        finish()
      })
    })
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true })
  }
}

const resolvePackagedPaths = () => {
  const packageDir = findPackageDir()

  if (process.platform === 'darwin') {
    const bundleDir = path.join(packageDir, `${appName}.app`)
    const resourcesDir = path.join(bundleDir, 'Contents/Resources')
    const runtimePackageCacheMetadata = readRuntimePackageCacheMetadata(resourcesDir)
    return {
      appDir: path.join(resourcesDir, 'app'),
      clientDistDir: path.join(resourcesDir, 'dist'),
      executablePath: firstExistingPath(
        path.join(bundleDir, 'Contents/MacOS', appMetadata.executableName),
        path.join(bundleDir, 'Contents/MacOS', appMetadata.artifactBaseName)
      ),
      ...runtimePackageCacheMetadata
    }
  }

  const resourcesDir = path.join(packageDir, 'resources')
  const runtimePackageCacheMetadata = readRuntimePackageCacheMetadata(resourcesDir)
  const executableName = process.platform === 'win32'
    ? `${appMetadata.executableName}.exe`
    : appMetadata.executableName
  return {
    appDir: path.join(resourcesDir, 'app'),
    clientDistDir: path.join(resourcesDir, 'dist'),
    executablePath: firstExistingPath(
      path.join(packageDir, executableName),
      path.join(packageDir, `${appName}.exe`)
    ),
    ...runtimePackageCacheMetadata
  }
}

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      server.close(() => {
        if (address == null || typeof address === 'string') {
          reject(new Error('Failed to allocate a smoke test port.'))
          return
        }
        resolve(address.port)
      })
    })
  })

const readLogTail = (logPath, maxLines = 200) => {
  if (!fs.existsSync(logPath)) return 'Packaged server log was not created.'
  const lines = fs.readFileSync(logPath, 'utf8').trimEnd().split(/\r?\n/u)
  return lines.slice(-maxLines).join('\n')
}

const waitForServer = ({ logPath, port, startedAt = Date.now() }) =>
  new Promise((resolve, reject) => {
    let retryScheduled = false
    const request = http.get({
      hostname: host,
      path: '/api/auth/status',
      port,
      timeout: 1000
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        if ((response.statusCode ?? 500) < 500) {
          resolve(body)
          return
        }
        retry()
      })
    })

    const retry = () => {
      if (retryScheduled) return
      retryScheduled = true
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > serverReadyTimeoutMs) {
        reject(
          new Error(
            `Packaged server did not become ready within ${serverReadyTimeoutMs}ms.\n${readLogTail(logPath)}`
          )
        )
        return
      }
      setTimeout(() => {
        waitForServer({ logPath, port, startedAt }).then(resolve, reject)
      }, 250)
    }

    request.once('timeout', () => {
      request.destroy()
      retry()
    })
    request.once('error', retry)
  })

const readServerText = (port, requestPath, label, options = {}) =>
  new Promise((resolve, reject) => {
    const httpGet = options.httpGet ?? http.get
    const request = httpGet({
      hostname: host,
      path: requestPath,
      port,
      timeout: options.timeoutMs ?? serverRequestTimeoutMs
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`${label} returned HTTP ${response.statusCode}: ${body}`))
          return
        }
        resolve(body)
      })
    })
    request.once('timeout', () => {
      request.destroy(new Error(`${label} request timed out.`))
    })
    request.once('error', reject)
  })

const createPackagedAsset = (port, options = {}) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ kind: 'rule', name: 'Packaged Authority Smoke' })
    const httpRequest = options.httpRequest ?? http.request
    const request = httpRequest({
      headers: {
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json'
      },
      hostname: host,
      method: 'POST',
      path: '/api/ai/assets',
      port,
      timeout: options.timeoutMs ?? serverRequestTimeoutMs
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        responseBody += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 201) {
          reject(new Error(`Packaged asset authority returned HTTP ${response.statusCode}: ${responseBody}`))
          return
        }
        try {
          resolve(JSON.parse(responseBody))
        } catch {
          reject(new Error(`Packaged asset authority returned invalid JSON: ${responseBody}`))
        }
      })
    })
    request.once('timeout', () => {
      request.destroy(new Error('Packaged asset authority request timed out.'))
    })
    request.once('error', reject)
    request.end(body)
  })

const assertPackagedAssetAuthority = async (port, workspaceFolder) => {
  const response = await createPackagedAsset(port)
  const relativePath = '.oo/rules/packaged-authority-smoke.md'
  if (
    response?.success !== true || response?.data?.asset?.kind !== 'rule' || response?.data?.asset?.path !== relativePath
  ) {
    throw new Error(`Packaged asset authority returned an unexpected asset: ${JSON.stringify(response)}`)
  }
  const content = fs.readFileSync(path.join(workspaceFolder, relativePath), 'utf8')
  if (!content.includes('# Packaged Authority Smoke')) {
    throw new Error('Packaged asset authority did not publish the expected content.')
  }
}

const readPluginCatalog = async (port) => {
  const body = await readServerText(port, '/api/plugins', 'Packaged plugin catalog')
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Packaged plugin catalog returned invalid JSON: ${body}`)
  }
}

const getCatalogPlugins = catalog => (
  Array.isArray(catalog?.data?.plugins)
    ? catalog.data.plugins
    : Array.isArray(catalog?.plugins)
    ? catalog.plugins
    : []
)

const getCatalogDiagnostics = catalog => [
  ...(Array.isArray(catalog?.diagnostics) ? catalog.diagnostics : []),
  ...(Array.isArray(catalog?.data?.diagnostics) ? catalog.data.diagnostics : [])
]

const readLocalPluginClientSource = (
  port,
  versionedEntryUrl,
  scope,
  options = {}
) =>
  readServerText(
    port,
    `${versionedEntryUrl}?pluginVersion=desktop-smoke`,
    `Packaged local plugin source "${scope}"`,
    {
      ...options,
      timeoutMs: options.timeoutMs ?? serverCompileTimeoutMs
    }
  )

const assertBuiltinRuntimeActive = async (catalog, port, options = {}) => {
  const catalogDiagnostics = getCatalogDiagnostics(catalog)
  if (catalogDiagnostics.length > 0) {
    throw new Error(`Packaged plugin catalog reported diagnostics: ${JSON.stringify(catalogDiagnostics)}`)
  }

  const plugins = getCatalogPlugins(catalog)
  const requiredPlugins = []
  for (const packageId of BUILTIN_PLUGIN_PACKAGES) {
    const plugin = plugins.find(candidate => candidate?.packageId === packageId || candidate?.name === packageId)
    if (plugin == null) {
      const packageIds = plugins.map(candidate => candidate?.packageId ?? candidate?.name ?? candidate?.scope)
        .filter(Boolean)
      throw new Error(
        `Packaged plugin catalog does not contain default plugin ${packageId}. ` +
          `Found: ${JSON.stringify(packageIds)}`
      )
    }
    if (plugin.enabled !== true) {
      throw new Error(`Packaged default plugin ${packageId} is present but not enabled.`)
    }
    if (Array.isArray(plugin.diagnostics) && plugin.diagnostics.length > 0) {
      throw new Error(
        `Packaged default plugin ${packageId} reported diagnostics: ${JSON.stringify(plugin.diagnostics)}`
      )
    }
    if (Array.isArray(options.pluginRootParentDirs)) {
      if (typeof plugin.pluginRoot !== 'string') {
        throw new TypeError(`Packaged default plugin ${packageId} did not expose its resolved root.`)
      }
      const pluginRoot = fs.realpathSync(plugin.pluginRoot)
      const isPackagedPluginRoot = options.pluginRootParentDirs.some((parentDir) => {
        const pluginRootParentDir = fs.realpathSync(parentDir)
        const relativePluginRoot = path.relative(pluginRootParentDir, pluginRoot)
        return (
          relativePluginRoot !== '..' &&
          !relativePluginRoot.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relativePluginRoot)
        )
      })
      if (!isPackagedPluginRoot) {
        throw new Error(
          `Packaged default plugin ${packageId} was not loaded from a packaged built-in root: ${pluginRoot}`
        )
      }
    }
    requiredPlugins.push(plugin)
  }

  for (const plugin of requiredPlugins) {
    if (plugin.client == null) continue
    const packageId = plugin.packageId ?? plugin.name ?? plugin.scope
    if (plugin.client.clientEntryUrl == null) {
      const details = JSON.stringify(plugin)
      throw new Error(`Packaged built-in plugin ${packageId} did not expose its client production entry: ${details}`)
    }
    const entryUrl = new URL(plugin.client.clientEntryUrl, `http://${host}:${port}`)
    await readServerText(
      port,
      `${entryUrl.pathname}${entryUrl.search}`,
      `Packaged built-in plugin ${packageId} client entry`
    )
  }
}

const assertLocalClientSourcesCompile = async (catalog, port) => {
  const requiredScopes = [
    'china-red-theme',
    'neo-workshop-theme',
    'focus-workbench-theme',
    'warm-cowork-theme',
    'chrome'
  ]
  const plugins = getCatalogPlugins(catalog)
  for (const scope of requiredScopes) {
    const plugin = plugins.find(candidate => candidate?.scope === scope)
    if (plugin == null) {
      throw new Error(`Packaged workspace did not discover watched local plugin "${scope}".`)
    }
    const entryUrl = plugin.client?.devClientEntryUrl
    if (
      plugin.watch?.enabled !== true ||
      plugin.client?.devClientEntryKind !== 'runtime-source' ||
      typeof entryUrl !== 'string' ||
      !entryUrl.startsWith(`/api/plugins/${scope}/client-source/`)
    ) {
      throw new Error(
        `Packaged local plugin "${scope}" did not expose its compiled source entry: ${JSON.stringify(plugin)}`
      )
    }
    const versionedEntryUrl = entryUrl.replace('/client-source/', '/client-source/@v/desktop-smoke/')
    const source = await readLocalPluginClientSource(
      port,
      versionedEntryUrl,
      scope
    )
    if (!source.includes('activatePlugin')) {
      throw new Error(`Packaged local plugin source "${scope}" is not an executable plugin module.`)
    }
  }
}

const readPackageInfo = (packageDir) => {
  const packageInfoPath = path.join(packageDir, 'package.json')
  const parsed = JSON.parse(fs.readFileSync(packageInfoPath, 'utf8'))
  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new TypeError(`Packaged plugin has invalid package metadata: ${packageInfoPath}`)
  }
  return {
    name: parsed.name,
    version: parsed.version
  }
}

const sanitizePackageName = packageName => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')

const assertIsolatedBuiltinPluginCache = (appDir, packageCacheRootDir) => {
  for (const packageName of BUILTIN_PLUGIN_PACKAGES) {
    const packagedPluginDir = path.join(appDir, 'node_modules', ...packageName.split('/'))
    const packageInfo = readPackageInfo(packagedPluginDir)
    for (const cacheVersion of ['latest', packageInfo.version]) {
      const cacheDir = path.join(
        packageCacheRootDir,
        'npm',
        sanitizePackageName(packageName),
        cacheVersion
      )
      const cachedPluginDir = path.join(cacheDir, 'node_modules', ...packageName.split('/'))
      const manifestPath = path.join(cacheDir, '.oneworks-package-cache.json')
      if (!fs.existsSync(cachedPluginDir) || !fs.existsSync(manifestPath)) {
        throw new Error(`Packaged built-in plugin was not materialized in isolated cache: ${cacheDir}`)
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (
        manifest.cacheVersion !== cacheVersion ||
        manifest.name !== packageName ||
        manifest.source !== 'builtin' ||
        manifest.version !== packageInfo.version
      ) {
        throw new Error(`Invalid isolated built-in plugin cache manifest: ${JSON.stringify(manifest)}`)
      }
      const cachedPackageInfo = readPackageInfo(cachedPluginDir)
      if (cachedPackageInfo.name !== packageName || cachedPackageInfo.version !== packageInfo.version) {
        throw new Error(`Isolated built-in plugin cache contains the wrong package: ${cachedPluginDir}`)
      }
    }
  }
}

const runPackagedServerSmoke = async ({
  assertCatalog,
  envOverrides,
  packageCacheRootDir,
  paths,
  realHomeDir,
  smokeLabel,
  workspaceFolder
}) => {
  const port = await getAvailablePort()
  const workspaceEnv = {
    ...createWorkspaceRuntimeEnv(
      paths.runtimePackageCacheVersion,
      paths.runtimePackageBuildFingerprint,
      workspaceFolder,
      realHomeDir,
      packageCacheRootDir
    ),
    ...envOverrides
  }
  const smokeRoot = resolveProjectHomePath(
    workspaceFolder,
    workspaceEnv,
    '.local',
    `desktop-smoke-${smokeLabel}`
  )
  const dataDir = path.join(smokeRoot, 'data')
  const logDir = resolveProjectHomePath(workspaceFolder, workspaceEnv, 'logs', `desktop-smoke-${smokeLabel}`)
  fs.rmSync(smokeRoot, { recursive: true, force: true })
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })

  const logPath = path.join(logDir, 'server.log')
  const logStream = fs.createWriteStream(logPath)
  const child = spawn(paths.executablePath, [path.join(paths.appDir, 'src/server-child.cjs')], {
    cwd: workspaceFolder,
    env: {
      ...workspaceEnv,
      DB_PATH: path.join(smokeRoot, 'db.sqlite'),
      ELECTRON_RUN_AS_NODE: '1',
      __ONEWORKS_PROJECT_CLIENT_BASE__: '/ui',
      __ONEWORKS_PROJECT_CLIENT_DIST_PATH__: paths.clientDistDir,
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'desktop',
      __ONEWORKS_PROJECT_SERVER_DATA_DIR__: dataDir,
      __ONEWORKS_PROJECT_SERVER_HOST__: host,
      __ONEWORKS_PROJECT_SERVER_LOG_DIR__: logDir,
      __ONEWORKS_PROJECT_SERVER_PORT__: String(port),
      __ONEWORKS_PROJECT_WEB_AUTH_ENABLED__: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.pipe(logStream)
  child.stderr.pipe(logStream)

  const exitPromise = new Promise((resolve) => {
    child.once('error', resolve)
    child.once('exit', () => {
      const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''
      resolve(new Error(`Packaged server exited early.\n${logText}`))
    })
  })

  try {
    const result = await Promise.race([
      waitForServer({ logPath, port }),
      exitPromise
    ])
    if (result instanceof Error) throw result
    const pluginCatalog = await readPluginCatalog(port)
    await assertCatalog(pluginCatalog, port)
    return result
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
    logStream.end()
  }
}

const main = async () => {
  const paths = resolvePackagedPaths()
  assertPackagedBuiltinPlugins(paths.appDir)
  await runPackagedMainSmoke(paths)

  const sourceResult = await runPackagedServerSmoke({
    assertCatalog: async (pluginCatalog, port) => {
      await assertBuiltinRuntimeActive(pluginCatalog, port)
      await assertLocalClientSourcesCompile(pluginCatalog, port)
    },
    paths,
    smokeLabel: 'source-workspace',
    workspaceFolder: workspaceRoot
  })

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oneworks-desktop-builtin-smoke-'))
  const emptyWorkspace = path.join(emptyRoot, 'workspace')
  const isolatedHome = path.join(emptyRoot, 'home')
  const isolatedPackageCacheRoot = path.join(isolatedHome, '.oneworks', 'bootstrap')
  fs.mkdirSync(emptyWorkspace, { recursive: true })
  fs.mkdirSync(isolatedHome, { recursive: true })
  fs.writeFileSync(
    path.join(emptyWorkspace, '.oo.config.json'),
    JSON.stringify({
      plugins: BUILTIN_PLUGIN_PACKAGES.map(id => ({ id }))
    })
  )
  try {
    await runPackagedServerSmoke({
      assertCatalog: async (pluginCatalog, port) => {
        await assertBuiltinRuntimeActive(
          pluginCatalog,
          port,
          { pluginRootParentDirs: [paths.appDir, isolatedPackageCacheRoot] }
        )
        await assertPackagedAssetAuthority(port, emptyWorkspace)
      },
      envOverrides: {
        __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
      },
      packageCacheRootDir: isolatedPackageCacheRoot,
      paths,
      realHomeDir: isolatedHome,
      smokeLabel: 'empty-workspace',
      workspaceFolder: emptyWorkspace
    })
    assertIsolatedBuiltinPluginCache(paths.appDir, isolatedPackageCacheRoot)
  } finally {
    fs.rmSync(emptyRoot, { recursive: true, force: true })
  }

  console.log(sourceResult)
}

module.exports = {
  createPackagedAsset,
  readLocalPluginClientSource,
  readServerText,
  serverCompileTimeoutMs,
  serverRequestTimeoutMs,
  resolvePositiveTimeoutMs
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
