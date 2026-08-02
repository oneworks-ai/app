'use strict'

const { randomBytes } = require('node:crypto')
const { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } = require(
  'node:fs'
)
const { userInfo } = require('node:os')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')
const process = require('node:process')

const MAX_FRAME_BYTES = 384 * 1024
const PROTOCOL_VERSION = 2
const contains = (parent, child) => {
  const value = relative(parent, child)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..')
}
const preparePrivateDirectory = (base, directory) => {
  let current = base
  for (const segment of relative(base, directory).split(sep).filter(Boolean)) {
    current = join(current, segment)
    try {
      mkdirSync(current, { mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const stat = lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) {
      throw new Error('Filesystem authority control root is unsafe')
    }
    chmodSync(current, 0o700)
  }
  return realpathSync(directory)
}
const prepareControlRoot = override => {
  if (override != null) {
    const requested = resolve(override)
    const base = realpathSync(dirname(requested))
    return preparePrivateDirectory(base, join(base, basename(requested)))
  }
  const home = realpathSync(userInfo().homedir)
  return preparePrivateDirectory(home, resolve(home, '.oneworks', 'runtime', 'fs-authority-v1'))
}
const resolveBrokerEndpoint = controlRoot => join(controlRoot, 'b.sock')
const assertBrokerEndpoint = controlRoot => {
  const endpoint = resolveBrokerEndpoint(controlRoot)
  const stat = lstatSync(endpoint)
  if (!stat.isSocket() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
    throw new Error('Filesystem authority broker endpoint is unsafe')
  }
  return endpoint
}
const secureBrokerEndpoint = controlRoot => {
  const endpoint = resolveBrokerEndpoint(controlRoot)
  chmodSync(endpoint, 0o600)
  return assertBrokerEndpoint(controlRoot)
}
const readOrCreateSecret = controlRoot => {
  const secretPath = join(controlRoot, 'broker.secret')
  try {
    const descriptor = openSync(secretPath, 'wx', 0o600)
    try {
      writeFileSync(descriptor, `${randomBytes(32).toString('hex')}\n`)
    } finally {
      closeSync(descriptor)
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  const stat = lstatSync(secretPath)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid()) {
    throw new Error('Filesystem authority broker secret is unsafe')
  }
  chmodSync(secretPath, 0o600)
  const secret = readFileSync(secretPath, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/u.test(secret)) throw new Error('Filesystem authority broker secret is invalid')
  return secret
}
const canonicalWorkspace = (controlRoot, workspaceRoot) => {
  const workspace = realpathSync(workspaceRoot)
  if (contains(workspace, controlRoot) || contains(controlRoot, workspace)) {
    throw new Error('Workspace and filesystem authority control root overlap')
  }
  return workspace
}
module.exports = {
  assertBrokerEndpoint,
  canonicalWorkspace,
  MAX_FRAME_BYTES,
  prepareControlRoot,
  PROTOCOL_VERSION,
  readOrCreateSecret,
  resolveBrokerEndpoint,
  secureBrokerEndpoint
}
