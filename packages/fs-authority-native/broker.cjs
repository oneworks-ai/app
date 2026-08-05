#!/usr/bin/env node
'use strict'
const { randomBytes } = require('node:crypto')
const { resolve } = require('node:path')
const process = require('node:process')
const { createSession } = require('./broker-session.cjs')
const { openClaimDatabase } = require('./claim-db.cjs')
const { canonicalWorkspace, prepareControlRoot, readOrCreateSecret, secureBrokerEndpoint } = require('./constants.cjs')
const { loadBinding } = require('./loader.cjs')
const { createBrokerServer, prepareEndpointForListen, verifySocketPeer } = require('./transport.cjs')
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
  const sessions = new Set()
  let ready = false
  let database
  const onConnection = socket => {
    if (!ready) {
      socket.destroy()
      return
    }
    if (!verifySocketPeer(binding, socket, true)) {
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
      secret,
      socket,
      workspaceRoot: canonicalWorkspace
    })
    sessions.add(session)
    session.done = session.run().finally(() => sessions.delete(session))
  }
  let server
  try {
    server = createBrokerServer(binding, endpoint, onConnection)
    await listen(server, endpoint, controlRoot)
    database = suppliedDatabase ?? openClaimDatabase(controlRoot)
    await beforeRecover?.()
    database.recover(epoch)
    ready = true
  } catch (error) {
    await closeServer(server)
    database?.close()
    throw error
  }
  const close = async () => {
    const active = [...sessions]
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
