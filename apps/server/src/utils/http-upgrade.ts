import type { Duplex } from 'node:stream'

const handledHttpUpgradeSocket = Symbol.for('oneworks.http.upgrade.handled')

type MarkedUpgradeSocket = Duplex & {
  [handledHttpUpgradeSocket]?: boolean
}

export const markHttpUpgradeSocketHandled = (socket: Duplex) => {
  ;(socket as MarkedUpgradeSocket)[handledHttpUpgradeSocket] = true
}

export const isHttpUpgradeSocketHandled = (socket: Duplex) => (
  (socket as MarkedUpgradeSocket)[handledHttpUpgradeSocket] === true
)

export const scheduleUnhandledHttpUpgradeSocketClose = (socket: Duplex) => {
  setImmediate(() => {
    if (!isHttpUpgradeSocketHandled(socket) && !socket.destroyed) {
      socket.destroy()
    }
  })
}
