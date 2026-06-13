export const devStartTargets = [
  'web',
  'electron',
  'electron-workspace',
  'pwa',
  'homepage',
  'docs'
] as const

export type DevStartTarget = typeof devStartTargets[number]

export interface DevStartOptions {
  serviceChild?: boolean
  target?: DevStartTarget
  workspace?: boolean
}

export type ClientMode = 'dev' | 'standalone'
export type ReadinessMode = 'client' | 'docs' | 'http' | 'process'
export type ServerRole = 'manager' | 'workspace'

export interface TargetConfig {
  base?: string
  buildClient?: boolean
  clientMode?: ClientMode
  defaultClientPort?: number
  defaultServerPort?: number
  desktopWorkspace?: boolean
  extraEnv?: NodeJS.ProcessEnv
  needsClient: boolean
  needsServer: boolean
  readiness: ReadinessMode
  serverRole?: ServerRole
  urlSuffix?: string
}

export interface DevStartState {
  clientPid?: number
  clientPort?: number
  clientUrl?: string
  desktopPid?: number
  docsUrl?: string
  linkedDocsUrl?: string
  linkedHomepageUrl?: string
  managerLog?: string
  projectHomeDir?: string
  readiness?: ReadinessMode
  root?: string
  serverPid?: number
  serverPort?: number
  serverUrl?: string
  servicePid?: number
  startedAt?: string
  target?: DevStartTarget
}

export interface RuntimeEnvInput {
  base?: string
  clientMode?: ClientMode
  clientPort?: number
  extra?: NodeJS.ProcessEnv
  serverRole?: ServerRole
  serverPort?: number
}

export interface PortResolution {
  clientPort?: number
  serverPort?: number
}

export interface Urls {
  clientUrl?: string
  docsUrl?: string
  serverUrl?: string
}

const devStartTargetSet = new Set<string>(devStartTargets)

export const parseDevStartTarget = (value: string | undefined): DevStartTarget => {
  const target = typeof value === 'string' && value.trim() !== '' ? value.trim() : 'web'
  if (!devStartTargetSet.has(target)) {
    throw new Error(`Unknown target "${target}". Expected one of: ${devStartTargets.join(', ')}`)
  }
  return target as DevStartTarget
}
