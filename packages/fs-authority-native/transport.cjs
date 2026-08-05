'use strict'
const { spawn } = require('node:child_process')
const { lstatSync, unlinkSync } = require('node:fs')
const { connect, createServer } = require('node:net')
const { join } = require('node:path')
const process = require('node:process')
const { assertBrokerEndpoint, resolveBrokerEndpoint } = require('./constants.cjs')
const { descriptorFor, verifySocketPeer } = require('./posix-transport.cjs')
const delay = milliseconds =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref()
  })
const connectOnce = (endpoint, controlRoot, binding) =>
  new Promise((resolve, reject) => {
    try {
      assertBrokerEndpoint(controlRoot)
    } catch (error) {
      reject(error)
      return
    }
    const socket = connect(endpoint)
    let ready
    const fail = error => {
      socket.off('connect', ready)
      socket.destroy()
      reject(error)
    }
    ready = () => {
      socket.off('error', fail)
      if (!verifySocketPeer(binding, socket, false)) {
        fail(new Error('Filesystem authority broker peer is untrusted'))
        return
      }
      socket.setNoDelay(true)
      resolve(socket)
    }
    socket.once('error', fail)
    socket.once('connect', ready)
  })
const writeSocket = (socket, bytes) =>
  new Promise((resolve, reject) => {
    const failed = error => {
      socket.off('error', failed)
      reject(error)
    }
    socket.once('error', failed)
    socket.write(bytes, error => {
      socket.off('error', failed)
      error == null ? resolve() : reject(error)
    })
  })
const connectWithStart = async (endpoint, controlRoot, binding, autoStart) => {
  try {
    return await connectOnce(endpoint, controlRoot, binding)
  } catch (error) {
    if (!autoStart || (error?.code !== 'ECONNREFUSED' && error?.code !== 'ENOENT')) throw error
  }
  spawn(process.execPath, [join(__dirname, 'broker.cjs')], {
    cwd: controlRoot,
    detached: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore'
  }).unref()
  let lastError
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(25 + attempt * 3)
    try {
      return await connectOnce(endpoint, controlRoot, binding)
    } catch (error) {
      lastError = error
      if (error?.code !== 'ECONNREFUSED' && error?.code !== 'ENOENT') break
    }
  }
  throw lastError
}
const probeEndpoint = endpoint =>
  new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', error => {
      socket.destroy()
      error?.code === 'ECONNREFUSED' ? resolve(false) : reject(error)
    })
  })
const prepareEndpointForListen = async controlRoot => {
  const endpoint = resolveBrokerEndpoint(controlRoot)
  let before
  try {
    before = lstatSync(endpoint)
    assertBrokerEndpoint(controlRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') return endpoint
    throw error
  }
  if (await probeEndpoint(endpoint)) {
    throw Object.assign(new Error('Filesystem authority endpoint is active'), { code: 'EADDRINUSE' })
  }
  const after = lstatSync(endpoint)
  if (before.dev !== after.dev || before.ino !== after.ino || !after.isSocket()) {
    throw new Error('Filesystem authority endpoint changed during recovery')
  }
  unlinkSync(endpoint)
  return endpoint
}
module.exports = {
  connectWithStart,
  createBrokerServer: (_binding, endpoint, onConnection) => createServer(onConnection),
  descriptorFor,
  prepareEndpointForListen,
  writeSocket,
  verifySocketPeer
}
