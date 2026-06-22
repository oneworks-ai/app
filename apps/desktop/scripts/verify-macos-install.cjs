/* eslint-disable max-lines -- DMG install verification and installed server smoke share setup state. */
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const { resolveProjectHomePath } = require('@oneworks/register/dotenv')
const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { normalizeArch } = require('./desktop-archs.cjs')
const { DESKTOP_BUILD_SOURCE_FILE } = require('./desktop-build-source.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')
const releaseDir = path.join(desktopRoot, 'release')
const host = '127.0.0.1'
const appMetadata = resolveDesktopAppMetadata()

const createWorkspaceRuntimeEnv = () => {
  const env = { ...process.env }
  delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceRoot
  return env
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe'
  })

  if (result.error != null) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(' ')} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr
      ].filter(Boolean).join('\n')
    )
  }
  return result.stdout ?? ''
}

const findDmgArtifact = (targetArch) => {
  const suffix = `-mac-${targetArch}.dmg`
  const images = fs.readdirSync(releaseDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.startsWith(`${appMetadata.artifactBaseName}-`) && name.endsWith(suffix))
    .sort()

  if (images.length === 0) {
    throw new Error(`No macOS ${targetArch} dmg artifact was found in ${releaseDir}`)
  }
  return path.join(releaseDir, images.at(-1))
}

const assertInstalledAppMetadata = (appPath) => {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', plistPath]))
  if (info.CFBundleIdentifier !== appMetadata.appId) {
    throw new Error(`Expected bundle id ${appMetadata.appId}, got ${info.CFBundleIdentifier}`)
  }
  if (info.CFBundleName !== appMetadata.productName) {
    throw new Error(`Expected app name ${appMetadata.productName}, got ${info.CFBundleName}`)
  }

  const executablePath = path.join(appPath, 'Contents', 'MacOS', appMetadata.executableName)
  fs.accessSync(executablePath, fs.constants.X_OK)
  return executablePath
}

const assertTextField = ({ field, metadata }) => {
  const value = metadata[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected installed app build source ${field} to be a non-empty string.`)
  }
  return value.trim()
}

const assertExpectedBuildSourceValue = ({ actual, field, expected }) => {
  let expectedValue = typeof expected === 'string' ? expected.trim() : ''
  if (expectedValue === '') return
  if (field === 'buildTime') {
    const expectedDate = new Date(expectedValue)
    if (!Number.isNaN(expectedDate.getTime())) {
      expectedValue = expectedDate.toISOString()
    }
  }
  if (actual !== expectedValue) {
    throw new Error(`Expected installed app build source ${field} ${expectedValue}, got ${actual}`)
  }
}

const assertInstalledBuildSource = (appPath) => {
  const buildSourcePath = path.join(appPath, 'Contents', 'Resources', DESKTOP_BUILD_SOURCE_FILE)
  if (!appMetadata.isDevBuild) {
    if (fs.existsSync(buildSourcePath)) {
      throw new Error(`Release app should not include build source metadata: ${buildSourcePath}`)
    }
    return
  }

  if (!fs.existsSync(buildSourcePath)) {
    throw new Error(`Dev app is missing build source metadata: ${buildSourcePath}`)
  }

  const metadata = JSON.parse(fs.readFileSync(buildSourcePath, 'utf8'))
  const branch = assertTextField({ field: 'branch', metadata })
  const buildTime = assertTextField({ field: 'buildTime', metadata })
  const gitHash = assertTextField({ field: 'gitHash', metadata })
  const runtimePackageCacheVersion = assertTextField({ field: 'runtimePackageCacheVersion', metadata })
  assertExpectedBuildSourceValue({
    actual: branch,
    expected: process.env.ONEWORKS_DESKTOP_BUILD_GIT_BRANCH,
    field: 'branch'
  })
  assertExpectedBuildSourceValue({
    actual: buildTime,
    expected: process.env.ONEWORKS_DESKTOP_BUILD_TIME,
    field: 'buildTime'
  })
  assertExpectedBuildSourceValue({
    actual: gitHash,
    expected: process.env.ONEWORKS_DESKTOP_BUILD_GIT_HASH,
    field: 'gitHash'
  })
  console.log(
    `[desktop] installed app build source ${gitHash.slice(0, 12)} on ${branch} at ${buildTime} ` +
      `runtimeCache=${runtimePackageCacheVersion}`
  )
}

const copyAppBundle = ({ sourceAppPath, targetAppPath }) => {
  fs.rmSync(targetAppPath, { force: true, recursive: true })
  run('ditto', [sourceAppPath, targetAppPath], { stdio: 'inherit' })
}

const installDmgArtifact = ({ appPath, dmgPath }) => {
  const mountPath = resolveProjectHomePath(workspaceRoot, createWorkspaceRuntimeEnv(), '.local', 'desktop-dmg-install')
  let mounted = false
  fs.rmSync(mountPath, { force: true, recursive: true })
  fs.mkdirSync(mountPath, { recursive: true })

  try {
    run('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPath], { stdio: 'inherit' })
    mounted = true
    const sourceAppPath = path.join(mountPath, `${appMetadata.productName}.app`)
    if (!fs.existsSync(sourceAppPath)) {
      throw new Error(`DMG did not contain ${appMetadata.productName}.app at ${sourceAppPath}`)
    }
    copyAppBundle({ sourceAppPath, targetAppPath: appPath })
  } finally {
    if (mounted) {
      run('hdiutil', ['detach', mountPath], { stdio: 'inherit' })
    }
    fs.rmSync(mountPath, { force: true, recursive: true })
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
          reject(new Error('Failed to allocate an installed app smoke test port.'))
          return
        }
        resolve(address.port)
      })
    })
  })

const waitForServer = ({ port, startedAt = Date.now() }) =>
  new Promise((resolve, reject) => {
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
      if (Date.now() - startedAt > 40000) {
        reject(new Error('Installed app server did not become ready.'))
        return
      }
      setTimeout(() => {
        waitForServer({ port, startedAt }).then(resolve, reject)
      }, 250)
    }

    request.once('timeout', () => {
      request.destroy()
      retry()
    })
    request.once('error', retry)
  })

const smokeInstalledServer = async ({ appPath, executablePath }) => {
  const appDir = path.join(appPath, 'Contents', 'Resources', 'app')
  const clientDistDir = path.join(appPath, 'Contents', 'Resources', 'dist')
  const serverChildPath = path.join(appDir, 'src', 'server-child.cjs')
  const port = await getAvailablePort()
  const workspaceEnv = createWorkspaceRuntimeEnv()
  const smokeRoot = resolveProjectHomePath(workspaceRoot, workspaceEnv, '.local', 'desktop-installed-smoke')
  const dataDir = path.join(smokeRoot, 'data')
  const logDir = resolveProjectHomePath(workspaceRoot, workspaceEnv, 'logs', 'desktop-installed-smoke')
  fs.rmSync(smokeRoot, { recursive: true, force: true })
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })

  const logPath = path.join(logDir, 'server.log')
  const logStream = fs.createWriteStream(logPath)
  const child = spawn(executablePath, [serverChildPath], {
    cwd: workspaceRoot,
    env: {
      ...workspaceEnv,
      DB_PATH: path.join(smokeRoot, 'db.sqlite'),
      ELECTRON_RUN_AS_NODE: '1',
      __ONEWORKS_PROJECT_CLIENT_BASE__: '/ui',
      __ONEWORKS_PROJECT_CLIENT_DIST_PATH__: clientDistDir,
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
      resolve(new Error(`Installed app server exited early.\n${logText}`))
    })
  })

  try {
    const result = await Promise.race([
      waitForServer({ port }),
      exitPromise
    ])
    if (result instanceof Error) throw result
    console.log(result)
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
    logStream.end()
  }
}

const main = async () => {
  if (process.platform !== 'darwin') {
    throw new Error('macOS install verification can only run on darwin.')
  }

  const targetArch = normalizeArch(process.env.ONEWORKS_DESKTOP_INSTALL_ARCH?.trim() || process.arch)
  const dmgPath = findDmgArtifact(targetArch)
  const appPath = path.join('/Applications', `${appMetadata.productName}.app`)
  console.log(`[desktop] verifying install artifact ${dmgPath}`)
  installDmgArtifact({ appPath, dmgPath })
  const executablePath = assertInstalledAppMetadata(appPath)
  assertInstalledBuildSource(appPath)
  await smokeInstalledServer({ appPath, executablePath })
  console.log(`[desktop] installed app verified at ${appPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
