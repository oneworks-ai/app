const { spawn } = require('node:child_process')
const process = require('node:process')

const OWNER_CHANNEL_ENV = '__ONEWORKS_DESKTOP_SERVER_OWNER_CHANNEL__'
const OWNER_CHANNEL_VERSION = 'ipc-v1'

const terminateDesktopServerProcessTree = ({
  processRef = process,
  spawnProcess = spawn
} = {}) => {
  if (processRef.platform === 'win32') {
    const terminateSelf = () => {
      try {
        processRef.kill(processRef.pid, 'SIGTERM')
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error
      }
    }

    try {
      const taskkill = spawnProcess(
        'taskkill.exe',
        ['/pid', String(processRef.pid), '/t', '/f'],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        }
      )
      taskkill.once?.('error', terminateSelf)
      taskkill.unref?.()
    } catch {
      terminateSelf()
    }
    return
  }

  try {
    processRef.kill(-processRef.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
    processRef.kill(processRef.pid, 'SIGTERM')
  }
}

const installDesktopServerOwnerChannel = ({
  env = process.env,
  processRef = process,
  terminateProcessTree = terminateDesktopServerProcessTree
} = {}) => {
  if (env[OWNER_CHANNEL_ENV] !== OWNER_CHANNEL_VERSION) return false
  if (processRef.connected !== true || typeof processRef.once !== 'function') {
    throw new Error('Desktop server owner IPC channel is required but unavailable.')
  }

  let shutdownRequested = false
  processRef.once('disconnect', () => {
    if (shutdownRequested) return
    shutdownRequested = true
    terminateProcessTree({ processRef })
  })
  return true
}

module.exports = {
  installDesktopServerOwnerChannel,
  OWNER_CHANNEL_ENV,
  OWNER_CHANNEL_VERSION,
  terminateDesktopServerProcessTree
}
