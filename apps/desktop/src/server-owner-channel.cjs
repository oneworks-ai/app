const process = require('node:process')

const OWNER_CHANNEL_ENV = '__ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__'
const OWNER_CHANNEL_VERSION = 'ipc-v1'

const installDesktopServerOwnerChannel = ({
  env = process.env,
  processRef = process
} = {}) => {
  if (env[OWNER_CHANNEL_ENV] !== OWNER_CHANNEL_VERSION) return false
  if (processRef.connected !== true || typeof processRef.once !== 'function') {
    throw new Error('Desktop server owner IPC channel is required but unavailable.')
  }

  let shutdownRequested = false
  processRef.once('disconnect', () => {
    if (shutdownRequested) return
    shutdownRequested = true
    const targetPid = processRef.platform === 'win32' ? processRef.pid : -processRef.pid
    try {
      processRef.kill(targetPid, 'SIGTERM')
    } catch (error) {
      if (targetPid === processRef.pid || error?.code !== 'ESRCH') throw error
      processRef.kill(processRef.pid, 'SIGTERM')
    }
  })
  return true
}

module.exports = {
  installDesktopServerOwnerChannel,
  OWNER_CHANNEL_ENV,
  OWNER_CHANNEL_VERSION
}
