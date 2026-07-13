const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const process = require('node:process')

module.exports = function readBridgeCredentials() {
  const workspaceFolder = resolve(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ || process.cwd())
  const key = createHash('sha256').update(workspaceFolder).digest('hex').slice(0, 24)
  try {
    const credentialPath = join(tmpdir(), 'oneworks-chrome-control', `${key}.protocol-1.json`)
    const stats = lstatSync(credentialPath)
    if (!stats.isFile() || stats.isSymbolicLink()) return {}
    const value = JSON.parse(readFileSync(credentialPath, 'utf8'))
    const endpoint = new URL(value?.baseUrl)
    const validEndpoint = endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1' &&
      endpoint.port !== '' && endpoint.pathname === '/' && endpoint.search === '' && endpoint.hash === ''
    if (validEndpoint && value?.workspaceFolder === workspaceFolder && typeof value?.controlToken === 'string') {
      return {
        bridgeUrl: value.baseUrl,
        controlToken: value.controlToken,
        protocolVersion: value.protocolVersion
      }
    }
  } catch {}
  return {}
}
