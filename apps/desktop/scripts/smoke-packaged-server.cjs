const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const { resolveProjectHomePath } = require('@oneworks/register/dotenv')
const { resolveDesktopAppMetadata } = require('./desktop-app-metadata.cjs')
const { normalizeArch } = require('./desktop-archs.cjs')

const desktopRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(desktopRoot, '../..')
const outputDir = path.join(desktopRoot, 'out')
const appMetadata = resolveDesktopAppMetadata()
const appName = appMetadata.productName
const host = '127.0.0.1'

const createWorkspaceRuntimeEnv = () => {
  const env = { ...process.env }
  delete env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
  env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceRoot
  return env
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

const resolvePackagedPaths = () => {
  const packageDir = findPackageDir()

  if (process.platform === 'darwin') {
    const bundleDir = path.join(packageDir, `${appName}.app`)
    return {
      appDir: path.join(bundleDir, 'Contents/Resources/app'),
      clientDistDir: path.join(bundleDir, 'Contents/Resources/dist'),
      executablePath: firstExistingPath(
        path.join(bundleDir, 'Contents/MacOS', appMetadata.executableName),
        path.join(bundleDir, 'Contents/MacOS', appMetadata.artifactBaseName)
      )
    }
  }

  const executableName = process.platform === 'win32'
    ? `${appMetadata.executableName}.exe`
    : appMetadata.executableName
  return {
    appDir: path.join(packageDir, 'resources/app'),
    clientDistDir: path.join(packageDir, 'resources/dist'),
    executablePath: firstExistingPath(
      path.join(packageDir, executableName),
      path.join(packageDir, `${appName}.exe`)
    )
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
        reject(new Error('Packaged server did not become ready.'))
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

const main = async () => {
  const paths = resolvePackagedPaths()
  const port = await getAvailablePort()
  const workspaceEnv = createWorkspaceRuntimeEnv()
  const smokeRoot = resolveProjectHomePath(workspaceRoot, workspaceEnv, '.local', 'desktop-smoke')
  const dataDir = path.join(smokeRoot, 'data')
  const logDir = resolveProjectHomePath(workspaceRoot, workspaceEnv, 'logs', 'desktop-smoke')
  fs.rmSync(smokeRoot, { recursive: true, force: true })
  fs.rmSync(logDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(logDir, { recursive: true })

  const logPath = path.join(logDir, 'server.log')
  const logStream = fs.createWriteStream(logPath)
  const child = spawn(paths.executablePath, [path.join(paths.appDir, 'src/server-child.cjs')], {
    cwd: workspaceRoot,
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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
