#!/usr/bin/env node
/* eslint-disable max-lines -- mock update feed keeps CLI parsing and fake GitHub responses in one executable. */
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const desktopRoot = path.resolve(__dirname, '..')
const defaultReleaseDir = path.join(desktopRoot, 'release')
const defaultOwner = 'oneworks-ai'
const defaultRepo = 'app'
const defaultTagNamePrefix = 'pkg/oneworks-desktop/v'
const packageJson = require('../package.json')

const printUsage = () => {
  console.log(`Usage: pnpm -C apps/desktop mock:update-feed [options]

Options:
  --release-dir <dir>  Directory containing *-mac.yml and installer artifacts.
                       Defaults to apps/desktop/release.
  --tag <tag>          Release tag to expose. Defaults to pkg/oneworks-desktop/v<desktop version>.
  --owner <owner>      Repository owner in the fake GitHub API. Defaults to oneworks-ai.
  --repo <repo>        Repository name in the fake GitHub API. Defaults to app.
  --host <host>        Listen host. Defaults to 127.0.0.1.
  --port <port>        Listen port. Defaults to 0, which lets the OS choose a free port.
  --patch-app <path>   Patch a packaged app's Contents/Resources/app-update.yml to this feed.
  --help              Show this help.

Example:
  pnpm -C apps/desktop mock:update-feed \\
    --release-dir release \\
    --tag pkg/oneworks-desktop/v4.0.0-alpha.2 \\
    --patch-app /tmp/oneworks-old/One\\ Works.app
`)
}

const parseArgs = (args) => {
  const options = {
    host: '127.0.0.1',
    owner: defaultOwner,
    port: 0,
    releaseDir: defaultReleaseDir,
    repo: defaultRepo,
    tag: `${defaultTagNamePrefix}${packageJson.version}`
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    const readValue = () => {
      const value = args[index + 1]
      if (value == null || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`)
      }
      index += 1
      return value
    }

    switch (arg) {
      case '--host':
        options.host = readValue()
        break
      case '--owner':
        options.owner = readValue()
        break
      case '--patch-app':
        options.patchApp = readValue()
        break
      case '--port':
        options.port = Number(readValue())
        if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
          throw new Error(`Invalid port: ${options.port}`)
        }
        break
      case '--release-dir':
        options.releaseDir = path.resolve(process.cwd(), readValue())
        break
      case '--repo':
        options.repo = readValue()
        break
      case '--tag':
        options.tag = readValue()
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

const resolveUpdateChannel = (tagName) => {
  const version = tagName.startsWith(defaultTagNamePrefix)
    ? tagName.slice(defaultTagNamePrefix.length)
    : tagName.split('/').at(-1) ?? ''
  const channel = /^\d+\.\d+\.\d+(?:-([0-9A-Za-z]+)(?:[.-][0-9A-Za-z.-]+)?)?$/u.exec(version)?.[1] ?? 'stable'
  if (!new Set(['stable', 'rc', 'beta', 'alpha']).has(channel)) {
    throw new Error(`Unsupported desktop update channel in tag ${tagName}. Use stable, rc, beta, or alpha.`)
  }
  return channel
}

const getUpdateInfoFileName = channel => `${channel === 'stable' ? 'latest' : channel}-mac.yml`

const writePatchedAppUpdateConfig = ({ appPath, host, owner, port, repo }) => {
  const appUpdatePath = appPath.endsWith('.app')
    ? path.join(appPath, 'Contents', 'Resources', 'app-update.yml')
    : path.join(appPath, 'app-update.yml')

  fs.mkdirSync(path.dirname(appUpdatePath), { recursive: true })
  fs.writeFileSync(
    appUpdatePath,
    `provider: github
owner: ${owner}
repo: ${repo}
protocol: http
host: ${host}:${port}
tagNamePrefix: ${defaultTagNamePrefix}
`
  )
  return appUpdatePath
}

const sendJson = (response, value) => {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8'
  })
  response.end(`${JSON.stringify(value)}\n`)
}

const sendFile = (response, filePath) => {
  const stat = fs.statSync(filePath)
  response.writeHead(200, {
    'content-length': String(stat.size)
  })
  fs.createReadStream(filePath).pipe(response)
}

const sendNotFound = (response) => {
  response.writeHead(404, {
    'content-type': 'text/plain; charset=utf-8'
  })
  response.end('not found\n')
}

const createServer = ({ channel, options }) =>
  http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${options.host}`)
    const rawSegments = requestUrl.pathname.split('/').filter(Boolean)
    const segments = rawSegments.map(segment => decodeURIComponent(segment))

    if (
      request.method === 'GET' &&
      segments[0] === 'api' &&
      segments[1] === 'v3' &&
      segments[2] === 'repos' &&
      segments[3] === options.owner &&
      segments[4] === options.repo &&
      segments[5] === 'releases'
    ) {
      sendJson(response, [{
        assets: [],
        created_at: new Date().toISOString(),
        draft: false,
        prerelease: channel !== 'stable',
        published_at: new Date().toISOString(),
        tag_name: options.tag
      }])
      return
    }

    if (
      request.method === 'GET' &&
      segments[0] === options.owner &&
      segments[1] === options.repo &&
      segments[2] === 'releases' &&
      segments[3] === 'download' &&
      segments[4] === options.tag &&
      segments[5] != null
    ) {
      const fileName = path.basename(segments.slice(5).join('/'))
      const filePath = path.join(options.releaseDir, fileName)
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        sendFile(response, filePath)
        return
      }
    }

    sendNotFound(response)
  })

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  const channel = resolveUpdateChannel(options.tag)
  const updateInfoPath = path.join(options.releaseDir, getUpdateInfoFileName(channel))
  if (!fs.existsSync(updateInfoPath)) {
    throw new Error(`Missing update metadata for ${channel}: ${updateInfoPath}`)
  }

  const server = createServer({ channel, options })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address != null ? address.port : options.port
  const downloadBaseUrl = `http://${options.host}:${port}/${encodeURIComponent(options.owner)}/${
    encodeURIComponent(options.repo)
  }/releases/download/${encodeURIComponent(options.tag)}/`

  let patchedConfigPath
  if (options.patchApp != null) {
    patchedConfigPath = writePatchedAppUpdateConfig({
      appPath: path.resolve(process.cwd(), options.patchApp),
      host: options.host,
      owner: options.owner,
      port,
      repo: options.repo
    })
  }

  console.log('[mock-update-feed] ready')
  console.log(`CHANNEL=${channel}`)
  console.log(`TAG=${options.tag}`)
  console.log(
    `API_URL=http://${options.host}:${port}/api/v3/repos/${options.owner}/${options.repo}/releases?per_page=50`
  )
  console.log(`DOWNLOAD_BASE_URL=${downloadBaseUrl}`)
  console.log(`UPDATE_METADATA=${updateInfoPath}`)
  if (patchedConfigPath != null) {
    console.log(`PATCHED_APP_UPDATE_YML=${patchedConfigPath}`)
  }
  console.log('')
  console.log('Keep this process running while the packaged app checks for updates.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
