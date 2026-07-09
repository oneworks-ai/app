import { createHash } from 'node:crypto'

import { isRecord } from '../utils.js'
import { cleanDeviceMetadataText, cleanNetworkAddress, normalizeDeviceEnvironmentInfo } from './device-environment.js'
import type { RelayDeviceEnvironmentInfo } from './device-environment.js'
import { mergeManagementServerProjects, normalizeManagementServerProjects } from './management-server-projects.js'
import type { RelayDeviceManagementServerProjectMetadata } from './management-server-projects.js'

export interface RelayDeviceManagementServerMetadata {
  createdAt: string
  environment?: RelayDeviceEnvironmentInfo
  id: string
  kind?: string
  lastSeenAt: string
  lastSeenIp?: string
  name?: string
  pluginScope?: string
  projects?: RelayDeviceManagementServerProjectMetadata[]
  registeredIp?: string
  workspaceFolder?: string
}

interface ManagementServerContainer {
  managementServers?: RelayDeviceManagementServerMetadata[]
}

type ManagementServerInput = Partial<Omit<RelayDeviceManagementServerMetadata, 'environment' | 'projects'>> & {
  environment?: unknown
  projects?: unknown
}

const legacyServerId = (pluginScope?: string, workspaceFolder?: string) => {
  const source = `${pluginScope ?? ''}\0${workspaceFolder ?? ''}`
  if (source === '\0') return ''
  return `source:${createHash('sha256').update(source).digest('base64url').slice(0, 16)}`
}

const normalizeManagementServer = (input: ManagementServerInput): RelayDeviceManagementServerMetadata | undefined => {
  const id = cleanDeviceMetadataText(input.id)
  const createdAt = cleanDeviceMetadataText(input.createdAt)
  const lastSeenAt = cleanDeviceMetadataText(input.lastSeenAt)
  if (id === '' || createdAt === '' || lastSeenAt === '') return undefined
  const environment = normalizeDeviceEnvironmentInfo(input.environment)
  const kind = cleanDeviceMetadataText(input.kind)
  const lastSeenIp = cleanNetworkAddress(input.lastSeenIp)
  const name = cleanDeviceMetadataText(input.name)
  const pluginScope = cleanDeviceMetadataText(input.pluginScope)
  const projects = normalizeManagementServerProjects(input.projects)
  const registeredIp = cleanNetworkAddress(input.registeredIp)
  const workspaceFolder = cleanDeviceMetadataText(input.workspaceFolder)
  return {
    createdAt,
    ...(environment == null ? {} : { environment }),
    id,
    ...(kind === '' ? {} : { kind }),
    lastSeenAt,
    ...(lastSeenIp === '' ? {} : { lastSeenIp }),
    ...(name === '' ? {} : { name }),
    ...(pluginScope === '' ? {} : { pluginScope }),
    ...(projects.length === 0 ? {} : { projects }),
    ...(registeredIp === '' ? {} : { registeredIp }),
    ...(workspaceFolder === '' ? {} : { workspaceFolder })
  }
}

export const normalizeManagementServers = (value: unknown) => (
  Array.isArray(value)
    ? value
      .filter(isRecord)
      .map(item => normalizeManagementServer(item))
      .filter((item): item is RelayDeviceManagementServerMetadata => item != null)
    : []
)

export const upsertDeviceManagementServerMetadata = (
  metadata: ManagementServerContainer,
  input: {
    environment?: unknown
    id?: unknown
    kind?: unknown
    lastSeenIp?: unknown
    name?: unknown
    pluginScope?: unknown
    projects?: unknown
    registeredIp?: unknown
    workspaceFolder?: unknown
  },
  seenAt: string
) => {
  const environment = normalizeDeviceEnvironmentInfo(input.environment)
  const pluginScope = cleanDeviceMetadataText(input.pluginScope)
  const workspaceFolder = cleanDeviceMetadataText(input.workspaceFolder)
  const explicitId = cleanDeviceMetadataText(input.id)
  const kind = cleanDeviceMetadataText(input.kind)
  const lastSeenIp = cleanNetworkAddress(input.lastSeenIp)
  const name = cleanDeviceMetadataText(input.name)
  const registeredIp = cleanNetworkAddress(input.registeredIp)
  const id = explicitId === ''
    ? legacyServerId(
      pluginScope === '' ? undefined : pluginScope,
      workspaceFolder === '' ? undefined : workspaceFolder
    )
    : explicitId
  if (id === '') return
  const previous = metadata.managementServers?.find(item => item.id === id)
  const projects = Array.isArray(input.projects)
    ? mergeManagementServerProjects(previous?.projects, input.projects, seenAt)
    : undefined
  const next = normalizeManagementServer({
    createdAt: previous?.createdAt ?? seenAt,
    environment: environment == null ? previous?.environment : { ...previous?.environment, ...environment },
    id,
    kind: kind === '' ? previous?.kind : kind,
    lastSeenAt: seenAt,
    lastSeenIp: lastSeenIp === '' ? previous?.lastSeenIp : lastSeenIp,
    name: name === '' ? previous?.name : name,
    pluginScope: pluginScope === '' ? previous?.pluginScope : pluginScope,
    projects: projects == null ? previous?.projects : projects,
    registeredIp: registeredIp === '' ? previous?.registeredIp : registeredIp,
    workspaceFolder: workspaceFolder === '' ? previous?.workspaceFolder : workspaceFolder
  })
  if (next == null) return
  const others = metadata.managementServers?.filter(item => item.id !== id) ?? []
  metadata.managementServers = [...others, next].sort((left, right) => (
    Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt)
  ))
}
