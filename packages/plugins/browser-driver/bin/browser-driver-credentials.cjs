const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const process = require('node:process')

module.exports = function readBridgeCredentials() {
  const bridgeUrl = process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_URL__
  const bridgeToken = process.env.__ONEWORKS_DESKTOP_BROWSER_CONTROL_TOKEN__
  if (bridgeUrl && bridgeToken) return { bridgeToken, bridgeUrl }
  const workspace = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ || process.cwd()
  const key = createHash('sha256').update(resolve(workspace)).digest('hex').slice(0, 24)
  try {
    const credentialPath = join(tmpdir(), 'oneworks-browser-control', `${key}.json`)
    const stats = lstatSync(credentialPath)
    if (!stats.isFile() || stats.isSymbolicLink()) return {}
    const value = JSON.parse(readFileSync(credentialPath, 'utf8'))
    const endpoint = new URL(value?.baseUrl)
    const isLoopbackEndpoint = endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' &&
      endpoint.port !== '' && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === ''
    if (value?.workspaceFolder === resolve(workspace) && isLoopbackEndpoint && value?.token) {
      return { bridgeToken: value.token, bridgeUrl: value.baseUrl }
    }
  } catch {}
  return {}
}
