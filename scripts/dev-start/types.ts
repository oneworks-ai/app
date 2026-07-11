export const devStartTargets = [
  'web',
  'daemon',
  'electron',
  'electron-workspace',
  'pwa',
  'homepage',
  'docs',
  'relay',
  'desktop-control',
  'android-emulator'
] as const

export type DevStartTarget = typeof devStartTargets[number]

export interface DevStartOptions {
  operation?: DevServiceOperation
  portLockHeld?: boolean
  serviceChild?: boolean
  target?: DevStartTarget
  workspace?: boolean
}

export type ClientMode = 'dev' | 'standalone'
export type DevServiceAction = 'ensure' | 'restart' | 'stop'
export type DevServiceComponentKind = 'device' | 'http' | 'process'
export type DevServiceEventPhase = 'completed' | 'failed' | 'started'
export type DevServicePhase = 'failed' | 'ready' | 'starting' | 'stopped' | 'stopping'
export type ReadinessMode = 'client' | 'device' | 'docs' | 'http' | 'process'
export type ServerRole = 'manager' | 'workspace'
export type TargetKind = 'android-emulator' | 'desktop' | 'desktop-control' | 'relay' | 'standard'

export interface DevServiceOperation {
  action: DevServiceAction
  actor: string
  id: string
  startedAt: string
}

export interface DevServiceComponentState {
  fingerprint?: string
  healthUrl?: string
  id: string
  kind: DevServiceComponentKind
  logPath?: string
  metadata?: Record<string, string>
  pid?: number
  port?: number
  url?: string
}

export interface DevServiceLease extends DevServiceOperation {
  fingerprint: string
  pid: number
  resourceKey: string
  target: DevStartTarget
}

export interface DevServiceEvent {
  action: DevServiceAction
  actor: string
  error?: string
  id: string
  operationId: string
  phase: DevServiceEventPhase
  pid: number
  protocol: 'oneworks.dev-service-event'
  target: DevStartTarget
  timestamp: string
  version: 1
}

export interface TargetConfig {
  base?: string
  buildClient?: boolean
  clientMode?: ClientMode
  defaultClientPort?: number
  defaultServerPort?: number
  desktopWorkspace?: boolean
  extraEnv?: NodeJS.ProcessEnv
  kind: TargetKind
  needsClient: boolean
  needsServer: boolean
  readiness: ReadinessMode
  serverRole?: ServerRole
  urlSuffix?: string
}

export interface DevStartState {
  clientFingerprint?: string
  clientPid?: number
  clientPort?: number
  clientUrl?: string
  components?: DevServiceComponentState[]
  controlUrl?: string
  devicePid?: number
  deviceSerial?: string
  desktopPid?: number
  endedAt?: string
  error?: string
  generation?: string
  launchIdentity?: string
  docsUrl?: string
  linkedDocsUrl?: string
  linkedHomepageUrl?: string
  managerLog?: string
  operation?: DevServiceOperation
  ownerRoot?: string
  phase?: DevServicePhase
  projectHomeDir?: string
  readiness?: ReadinessMode
  root?: string
  serverPid?: number
  serverFingerprint?: string
  serverPort?: number
  serverUrl?: string
  servicePid?: number
  serviceFingerprint?: string
  scope?: 'machine' | 'worktree'
  schemaVersion?: 2
  startedAt?: string
  target?: DevStartTarget
  updatedAt?: string
  revision?: number
}

export interface DevServiceStatus {
  eventsPath: string
  lease?: DevServiceLease
  leasePath: string
  ready: boolean
  resourceKey: string
  state?: DevStartState
  statePath: string
  target: DevStartTarget
}

export interface DevServiceStatusDocument {
  generatedAt: string
  protocol: 'oneworks.dev-service'
  root: string
  services: DevServiceStatus[]
  version: 1
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
