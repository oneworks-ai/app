#!/usr/bin/env node
'use strict'
const { Buffer } = require('node:buffer')
const { randomBytes } = require('node:crypto')
const { resolve } = require('node:path')
const process = require('node:process')
const { createSession } = require('./broker-session.cjs')
const { openClaimDatabase } = require('./claim-db.cjs')
const {
  canonicalWorkspace,
  MAX_FRAME_BYTES,
  prepareControlRoot,
  readOrCreateSecret,
  secureBrokerEndpoint
} = require('./constants.cjs')
const { loadBinding } = require('./loader.cjs')
const { createBrokerServer, prepareEndpointForListen, verifySocketPeer } = require('./transport.cjs')
const MAX_PENDING_CONNECTIONS = 64
const readTestConfig = () => {
  if (process.env.NODE_ENV !== 'test') return {}
  const index = process.argv.indexOf('--test-control-root')
  return { controlRoot: index === -1 ? undefined : resolve(process.argv[index + 1]) }
}
const closeServer = server =>
  new Promise(resolveClose => {
    if (server?.listening !== true) {
      resolveClose()
      return
    }
    server.close(resolveClose)
  })
const listen = (server, endpoint, controlRoot) =>
  new Promise((resolveListen, reject) => {
    const failed = error => reject(error)
    server.once('error', failed)
    server.listen({ path: endpoint, readableAll: false, writableAll: false }, () => {
      server.off('error', failed)
      try {
        secureBrokerEndpoint(controlRoot)
        resolveListen()
      } catch (error) {
        reject(error)
      }
    })
  })
const startBroker = async (
  {
    allowFaults = false,
    beforeRecover,
    binding = loadBinding(),
    controlRoot = prepareControlRoot(),
    database: suppliedDatabase,
    secret = readOrCreateSecret(controlRoot)
  } = {}
) => {
  const endpoint = await prepareEndpointForListen(controlRoot)
  const claims = new Map()
  const epoch = randomBytes(32).toString('hex')
  const pendingSockets = new Map()
  const sessions = new Set()
  let ready = false
  let database
  const startSession = (socket, initialBytes, peerVerified = false) => {
    if (socket.destroyed) return
    if (!peerVerified && !verifySocketPeer(binding, socket, true)) {
      socket.destroy()
      return
    }
    socket.setNoDelay(true)
    const session = createSession({
      allowFaults,
      binding,
      claims,
      controlRoot,
      database,
      epoch,
      initialBytes,
      secret,
      socket,
      workspaceRoot: canonicalWorkspace
    })
    sessions.add(session)
    session.done = session.run().finally(() => sessions.delete(session))
  }
  const cleanupPendingSocket = (socket, pending) => {
    if (pending.cleaned) return
    pending.cleaned = true
    socket.off('data', pending.onData)
    socket.off('close', pending.onClose)
    socket.off('error', pending.onError)
    if (pendingSockets.get(socket) === pending) pendingSockets.delete(socket)
    pending.chunks.length = 0
    pending.bytes = 0
  }
  const destroyPendingSockets = () => {
    for (const [socket, pending] of [...pendingSockets]) {
      cleanupPendingSocket(socket, pending)
      socket.destroy()
    }
  }
  const onConnection = socket => {
    if (ready) {
      startSession(socket)
      return
    }
    if (!verifySocketPeer(binding, socket, true) || pendingSockets.size >= MAX_PENDING_CONNECTIONS) {
      socket.destroy()
      return
    }
    socket.setNoDelay(true)
    const pending = { bytes: 0, chunks: [], cleaned: false }
    pending.onData = chunk => {
      pending.bytes += chunk.length
      if (pending.bytes > MAX_FRAME_BYTES + 4) {
        socket.destroy()
        return
      }
      pending.chunks.push(chunk)
    }
    pending.onClose = () => cleanupPendingSocket(socket, pending)
    pending.onError = () => cleanupPendingSocket(socket, pending)
    socket.on('data', pending.onData)
    pendingSockets.set(socket, pending)
    socket.once('close', pending.onClose)
    socket.once('error', pending.onError)
  }
  let server
  try {
    server = createBrokerServer(binding, endpoint, onConnection)
    await listen(server, endpoint, controlRoot)
    database = suppliedDatabase ?? openClaimDatabase(controlRoot)
    await beforeRecover?.({ endpoint, server })
    database.recover(epoch)
    ready = true
    for (const [socket, pending] of [...pendingSockets]) {
      const initialBytes = Buffer.concat(pending.chunks, pending.bytes)
      cleanupPendingSocket(socket, pending)
      startSession(socket, initialBytes, true)
    }
  } catch (error) {
    ready = false
    destroyPendingSockets()
    await closeServer(server)
    database?.close()
    throw error
  }
  const close = async () => {
    const active = [...sessions]
    destroyPendingSockets()
    for (const session of active) session.state.socket?.destroy?.()
    ready = false
    await Promise.all([closeServer(server), ...active.map(session => session.done)])
    database.close()
  }
  return { close, endpoint, epoch, server }
}
if (require.main === module) {
  const test = readTestConfig()
  const controlRoot = prepareControlRoot(test.controlRoot)
  startBroker({ allowFaults: process.env.NODE_ENV === 'test', controlRoot }).then(owner => {
    if (process.env.NODE_ENV === 'test') process.stdout.write(`READY ${owner.endpoint}\n`)
  }).catch(error => {
    process.stderr.write(`Filesystem authority broker failed: ${error?.message ?? error}\n`)
    process.exit(78)
  })
}
module.exports = { startBroker }
