import path from 'node:path'
import process from 'node:process'

import { app } from 'electron'

export interface DesktopExternalCdpConfig {
  address: string
  port: number
  userDataDir?: string
}

const DEFAULT_CDP_ADDRESS = '127.0.0.1'

const normalizeText = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed == null || trimmed === '' ? undefined : trimmed
}

const readArgValue = (argv: string[], name: string) => {
  const prefix = `--${name}=`
  const index = argv.findIndex(arg => arg === `--${name}` || arg.startsWith(prefix))
  if (index < 0) return undefined
  const value = argv[index]
  if (value == null) return undefined
  if (value.startsWith(prefix)) return normalizeText(value.slice(prefix.length))
  return normalizeText(argv[index + 1])
}

const normalizePort = (value: string | undefined) => {
  const normalized = normalizeText(value)
  if (normalized == null) return undefined
  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid desktop CDP port: ${normalized}`)
  }
  return parsed
}

export const resolveDesktopExternalCdpConfig = (input: {
  argv?: string[]
  env?: NodeJS.ProcessEnv
} = {}): DesktopExternalCdpConfig | undefined => {
  const argv = input.argv ?? process.argv
  const env = input.env ?? process.env
  const port = normalizePort(
    env.ONEWORKS_DESKTOP_CDP_PORT ??
      readArgValue(argv, 'oneworks-cdp-port') ??
      readArgValue(argv, 'remote-debugging-port')
  )
  if (port == null) return undefined

  return {
    port,
    address: normalizeText(env.ONEWORKS_DESKTOP_CDP_ADDRESS ?? readArgValue(argv, 'oneworks-cdp-address')) ??
      DEFAULT_CDP_ADDRESS,
    userDataDir: normalizeText(env.ONEWORKS_DESKTOP_USER_DATA_DIR ?? readArgValue(argv, 'oneworks-user-data-dir'))
  }
}

export const applyDesktopExternalCdpConfig = (config = resolveDesktopExternalCdpConfig()) => {
  if (config == null) return undefined

  if (config.userDataDir != null) {
    app.setPath('userData', path.resolve(config.userDataDir))
  }

  app.commandLine.appendSwitch('remote-debugging-port', String(config.port))
  app.commandLine.appendSwitch('remote-debugging-address', config.address)
  console.warn(`[oneworks-desktop] external CDP enabled at http://${config.address}:${config.port}`)
  return config
}
