import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import process from 'node:process'

import type { RelayDevice, RelayEncryptedPayload, RelayServerArgs } from '../types.js'
import { isRecord } from '../utils.js'

export interface RelayDevicePrivateMetadata {
  alias?: string
  capabilities: Record<string, unknown>
  deviceInfo?: RelayDeviceEnvironmentInfo
  lastSeenIp?: string
  managementServers?: RelayDeviceManagementServerMetadata[]
  name: string
  pluginScope?: string
  registeredIp?: string
  workspaceFolder?: string
}

export interface RelayDeviceEnvironmentInfo {
  arch?: string
  deviceType?: string
  osName?: string
  osPlatform?: string
  osRelease?: string
  osVersion?: string
  runtime?: string
  runtimeVersion?: string
}

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

export interface RelayDeviceManagementServerProjectMetadata {
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  status?: string
  title?: string
  workspaceFolder?: string
}

type RelayDevicePrivateMetadataInput =
  & Partial<
    Omit<
      RelayDevicePrivateMetadata,
      'capabilities' | 'deviceInfo' | 'managementServers'
    >
  >
  & {
    capabilities?: unknown
    deviceInfo?: unknown
    managementServers?: unknown
  }

type RelayDeviceManagementServerMetadataInput =
  & Partial<
    Omit<
      RelayDeviceManagementServerMetadata,
      'environment' | 'projects'
    >
  >
  & {
    environment?: unknown
    projects?: unknown
  }

type RelayDeviceManagementServerProjectMetadataInput = Partial<RelayDeviceManagementServerProjectMetadata>

const metadataAlgorithm = 'aes-256-gcm' as const

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const cleanBoundedText = (value: unknown, maxLength: number) => {
  const text = cleanText(value)
  return text === '' ? '' : text.slice(0, maxLength)
}

const cleanNetworkAddress = (value: unknown) => {
  const text = cleanBoundedText(value, 128)
  return text === 'unknown' ? '' : text
}

const environmentText = (record: Record<string, unknown>, key: string, maxLength = 80) =>
  cleanBoundedText(record[key], maxLength)

export const normalizeDeviceEnvironmentInfo = (value: unknown): RelayDeviceEnvironmentInfo | undefined => {
  if (!isRecord(value)) return undefined
  const os = isRecord(value.os) ? value.os : {}
  const runtime = isRecord(value.runtime) ? value.runtime : {}
  const deviceType = environmentText(value, 'deviceType') || environmentText(value, 'type')
  const osName = environmentText(value, 'osName') || environmentText(os, 'name')
  const osPlatform = environmentText(value, 'osPlatform') || environmentText(os, 'platform')
  const osRelease = environmentText(value, 'osRelease') || environmentText(os, 'release')
  const osVersion = environmentText(value, 'osVersion') || environmentText(os, 'version')
  const runtimeName = environmentText(value, 'runtime') || environmentText(runtime, 'kind')
  const runtimeVersion = environmentText(value, 'runtimeVersion') || environmentText(runtime, 'version')
  const arch = environmentText(value, 'arch') || environmentText(os, 'arch')
  const info = {
    ...(arch === '' ? {} : { arch }),
    ...(deviceType === '' ? {} : { deviceType }),
    ...(osName === '' ? {} : { osName }),
    ...(osPlatform === '' ? {} : { osPlatform }),
    ...(osRelease === '' ? {} : { osRelease }),
    ...(osVersion === '' ? {} : { osVersion }),
    ...(runtimeName === '' ? {} : { runtime: runtimeName }),
    ...(runtimeVersion === '' ? {} : { runtimeVersion })
  }
  return Object.keys(info).length === 0 ? undefined : info
}

const managementServerIdFromLegacySource = (input: {
  pluginScope?: string
  workspaceFolder?: string
}) => {
  const source = `${input.pluginScope ?? ''}\0${input.workspaceFolder ?? ''}`
  if (source === '\0') return ''
  return `source:${createHash('sha256').update(source).digest('base64url').slice(0, 16)}`
}

const normalizeManagementServerProjectMetadata = (
  input: RelayDeviceManagementServerProjectMetadataInput
): RelayDeviceManagementServerProjectMetadata | undefined => {
  const createdAt = cleanText(input.createdAt)
  const id = cleanText(input.id)
  const lastSeenAt = cleanText(input.lastSeenAt)
  const name = cleanText(input.name)
  const status = cleanText(input.status)
  const title = cleanText(input.title)
  const workspaceFolder = cleanText(input.workspaceFolder)
  if ([id, name, title, workspaceFolder].every(item => item === '')) return undefined
  return {
    ...(createdAt === '' ? {} : { createdAt }),
    ...(id === '' ? {} : { id }),
    ...(lastSeenAt === '' ? {} : { lastSeenAt }),
    ...(name === '' ? {} : { name }),
    ...(status === '' ? {} : { status }),
    ...(title === '' ? {} : { title }),
    ...(workspaceFolder === '' ? {} : { workspaceFolder })
  }
}

const normalizeManagementServerProjects = (value: unknown) => (
  Array.isArray(value)
    ? dedupeManagementServerProjects(
      value
        .filter(isRecord)
        .map(item =>
          normalizeManagementServerProjectMetadata({
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
            id: typeof item.id === 'string' ? item.id : undefined,
            lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : undefined,
            name: typeof item.name === 'string' ? item.name : undefined,
            status: typeof item.status === 'string' ? item.status : undefined,
            title: typeof item.title === 'string' ? item.title : undefined,
            workspaceFolder: typeof item.workspaceFolder === 'string' ? item.workspaceFolder : undefined
          })
        )
        .filter((item): item is RelayDeviceManagementServerProjectMetadata => item != null)
    )
    : []
)

const managementServerProjectKeyCandidates = (project: RelayDeviceManagementServerProjectMetadata) => {
  const workspaceFolder = cleanText(project.workspaceFolder)
  const id = cleanText(project.id)
  const name = cleanText(project.name)
  const title = cleanText(project.title)
  return [
    workspaceFolder === '' ? undefined : `workspace:${workspaceFolder}`,
    id === '' ? undefined : `id:${id}`,
    name === '' ? undefined : `name:${name}`,
    title === '' ? undefined : `title:${title}`
  ].filter((item): item is string => item != null && item !== '')
}

const managementServerProjectSortTime = (project: RelayDeviceManagementServerProjectMetadata) => {
  const timestamp = Date.parse(project.lastSeenAt ?? project.createdAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

const mergeManagementServerProjectMetadata = (
  previous: RelayDeviceManagementServerProjectMetadata | undefined,
  incoming: RelayDeviceManagementServerProjectMetadata,
  seenAt: string | undefined
) => {
  const incomingTime = managementServerProjectSortTime(incoming)
  const previousTime = previous == null ? 0 : managementServerProjectSortTime(previous)
  const freshest = incomingTime >= previousTime ? incoming : previous
  return normalizeManagementServerProjectMetadata({
    createdAt: previous?.createdAt ?? incoming.createdAt ?? seenAt,
    id: previous?.id ?? incoming.id,
    lastSeenAt: incomingTime >= previousTime
      ? incoming.lastSeenAt ?? seenAt ?? previous?.lastSeenAt
      : previous?.lastSeenAt ?? incoming.lastSeenAt ?? seenAt,
    name: freshest?.name ?? incoming.name ?? previous?.name,
    status: freshest?.status ?? incoming.status ?? previous?.status,
    title: freshest?.title ?? incoming.title ?? previous?.title,
    workspaceFolder: freshest?.workspaceFolder ?? incoming.workspaceFolder ?? previous?.workspaceFolder
  })
}

const dedupeManagementServerProjects = (
  projects: RelayDeviceManagementServerProjectMetadata[],
  seenAt?: string
) => {
  const projectsByPrimaryKey = new Map<string, RelayDeviceManagementServerProjectMetadata>()
  const primaryKeyByAlias = new Map<string, string>()
  for (const project of projects) {
    const aliases = managementServerProjectKeyCandidates(project)
    if (aliases.length === 0) continue
    const primaryKey = aliases
      .map(alias => primaryKeyByAlias.get(alias))
      .find((item): item is string => item != null) ?? aliases[0]
    const next = mergeManagementServerProjectMetadata(projectsByPrimaryKey.get(primaryKey), project, seenAt)
    if (next == null) continue
    projectsByPrimaryKey.set(primaryKey, next)
    for (const alias of managementServerProjectKeyCandidates(next)) {
      primaryKeyByAlias.set(alias, primaryKey)
    }
  }
  return [...projectsByPrimaryKey.values()].sort((left, right) => (
    managementServerProjectSortTime(right) - managementServerProjectSortTime(left)
  ))
}

const mergeManagementServerProjects = (
  previousProjects: RelayDeviceManagementServerProjectMetadata[] | undefined,
  incomingValue: unknown,
  seenAt: string
) => {
  const incomingProjects = normalizeManagementServerProjects(incomingValue)
  if (incomingProjects.length === 0) {
    return previousProjects == null ? previousProjects : dedupeManagementServerProjects(previousProjects, seenAt)
  }
  return dedupeManagementServerProjects([
    ...(previousProjects ?? []),
    ...incomingProjects.map(project => ({
      ...project,
      createdAt: project.createdAt ?? seenAt,
      lastSeenAt: project.lastSeenAt ?? seenAt
    }))
  ], seenAt)
}

const normalizeManagementServerMetadata = (
  input: RelayDeviceManagementServerMetadataInput
): RelayDeviceManagementServerMetadata | undefined => {
  const id = cleanText(input.id)
  const createdAt = cleanText(input.createdAt)
  const lastSeenAt = cleanText(input.lastSeenAt)
  if (id === '' || createdAt === '' || lastSeenAt === '') return undefined
  const environment = normalizeDeviceEnvironmentInfo(input.environment)
  const kind = cleanText(input.kind)
  const lastSeenIp = cleanNetworkAddress(input.lastSeenIp)
  const name = cleanText(input.name)
  const pluginScope = cleanText(input.pluginScope)
  const projects = normalizeManagementServerProjects(input.projects)
  const registeredIp = cleanNetworkAddress(input.registeredIp)
  const workspaceFolder = cleanText(input.workspaceFolder)
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

const normalizeManagementServers = (value: unknown) => (
  Array.isArray(value)
    ? value
      .filter(isRecord)
      .map(item =>
        normalizeManagementServerMetadata({
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
          environment: item.environment,
          id: typeof item.id === 'string' ? item.id : undefined,
          kind: typeof item.kind === 'string' ? item.kind : undefined,
          lastSeenAt: typeof item.lastSeenAt === 'string' ? item.lastSeenAt : undefined,
          lastSeenIp: typeof item.lastSeenIp === 'string' ? item.lastSeenIp : undefined,
          name: typeof item.name === 'string' ? item.name : undefined,
          pluginScope: typeof item.pluginScope === 'string' ? item.pluginScope : undefined,
          projects: Array.isArray(item.projects) ? item.projects : undefined,
          registeredIp: typeof item.registeredIp === 'string' ? item.registeredIp : undefined,
          workspaceFolder: typeof item.workspaceFolder === 'string' ? item.workspaceFolder : undefined
        })
      )
      .filter((item): item is RelayDeviceManagementServerMetadata => item != null)
    : []
)

export const hashDeviceToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('base64url')}`

const safeEqualText = (a: string, b: string) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export const deviceTokenMatches = (device: RelayDevice, token: string) => {
  if (token === '') return false
  if (device.deviceTokenHash != null && safeEqualText(device.deviceTokenHash, hashDeviceToken(token))) {
    return true
  }
  return device.deviceToken === token
}

const deviceMetadataSecret = (args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>) => {
  const configured = cleanText(args.deviceMetadataSecret ?? process.env.ONEWORKS_RELAY_DEVICE_METADATA_SECRET)
  if (configured !== '') return configured
  if (args.adminToken !== '') return args.adminToken
  return `oneworks-relay-device-metadata:${args.dataPath}`
}

const deviceMetadataKey = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath'>,
  userId: string | undefined
) =>
  createHash('sha256')
    .update(deviceMetadataSecret(args))
    .update('\0')
    .update(userId ?? 'unowned')
    .digest()

const deviceMetadataAad = (deviceId: string, userId: string | undefined) =>
  Buffer.from(`${deviceId}\0${userId ?? 'unowned'}`, 'utf8')

export const normalizeDevicePrivateMetadata = (
  input: RelayDevicePrivateMetadataInput,
  fallbackName: string
): RelayDevicePrivateMetadata => {
  const alias = cleanText(input.alias)
  const name = cleanText(input.name)
  const workspaceFolder = cleanText(input.workspaceFolder)
  const pluginScope = cleanText(input.pluginScope)
  const lastSeenIp = cleanNetworkAddress(input.lastSeenIp)
  const registeredIp = cleanNetworkAddress(input.registeredIp)
  const deviceInfo = normalizeDeviceEnvironmentInfo(input.deviceInfo)
  const managementServers = normalizeManagementServers(input.managementServers)
  return {
    ...(alias === '' ? {} : { alias }),
    capabilities: isRecord(input.capabilities) ? input.capabilities : {},
    ...(deviceInfo == null ? {} : { deviceInfo }),
    ...(lastSeenIp === '' ? {} : { lastSeenIp }),
    ...(managementServers.length === 0 ? {} : { managementServers }),
    name: name === '' ? fallbackName : name,
    ...(pluginScope === '' ? {} : { pluginScope }),
    ...(registeredIp === '' ? {} : { registeredIp }),
    ...(workspaceFolder === '' ? {} : { workspaceFolder })
  }
}

export const upsertDeviceManagementServerMetadata = (
  metadata: RelayDevicePrivateMetadata,
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
  const pluginScope = cleanText(input.pluginScope)
  const workspaceFolder = cleanText(input.workspaceFolder)
  const explicitId = cleanText(input.id)
  const kind = cleanText(input.kind)
  const lastSeenIp = cleanNetworkAddress(input.lastSeenIp)
  const name = cleanText(input.name)
  const registeredIp = cleanNetworkAddress(input.registeredIp)
  const id = explicitId === ''
    ? managementServerIdFromLegacySource({
      pluginScope: pluginScope === '' ? undefined : pluginScope,
      workspaceFolder: workspaceFolder === '' ? undefined : workspaceFolder
    })
    : explicitId
  if (id === '') return
  const previous = metadata.managementServers?.find(item => item.id === id)
  const projects = Array.isArray(input.projects)
    ? mergeManagementServerProjects(previous?.projects, input.projects, seenAt)
    : undefined
  const nextEnvironment = environment == null
    ? previous?.environment
    : { ...previous?.environment, ...environment }
  const next = normalizeManagementServerMetadata({
    createdAt: previous?.createdAt ?? seenAt,
    environment: nextEnvironment,
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

export const legacyDevicePrivateMetadata = (device: RelayDevice): RelayDevicePrivateMetadata =>
  normalizeDevicePrivateMetadata({
    alias: device.alias,
    capabilities: device.capabilities,
    deviceInfo: undefined,
    name: device.name,
    pluginScope: device.pluginScope,
    workspaceFolder: device.workspaceFolder
  }, device.id)

export const encryptDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: Pick<RelayDevice, 'id' | 'userId'>,
  metadata: RelayDevicePrivateMetadata
): RelayEncryptedPayload => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(metadataAlgorithm, deviceMetadataKey(args, device.userId), iv)
  cipher.setAAD(deviceMetadataAad(device.id, device.userId))
  const plaintext = Buffer.from(JSON.stringify(metadata), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return {
    algorithm: metadataAlgorithm,
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    version: 1
  }
}

export const decryptDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: RelayDevice
): RelayDevicePrivateMetadata | undefined => {
  const encrypted = device.encryptedMetadata
  if (encrypted == null || encrypted.algorithm !== metadataAlgorithm || encrypted.version !== 1) return undefined

  try {
    const decipher = createDecipheriv(
      metadataAlgorithm,
      deviceMetadataKey(args, device.userId),
      Buffer.from(encrypted.iv, 'base64url')
    )
    decipher.setAAD(deviceMetadataAad(device.id, device.userId))
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
      decipher.final()
    ])
    const parsed = JSON.parse(plaintext.toString('utf8'))
    if (!isRecord(parsed)) return undefined
    return normalizeDevicePrivateMetadata({
      alias: typeof parsed.alias === 'string' ? parsed.alias : undefined,
      capabilities: isRecord(parsed.capabilities) ? parsed.capabilities : undefined,
      deviceInfo: parsed.deviceInfo,
      lastSeenIp: typeof parsed.lastSeenIp === 'string' ? parsed.lastSeenIp : undefined,
      managementServers: Array.isArray(parsed.managementServers) ? parsed.managementServers : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      pluginScope: typeof parsed.pluginScope === 'string' ? parsed.pluginScope : undefined,
      registeredIp: typeof parsed.registeredIp === 'string' ? parsed.registeredIp : undefined,
      workspaceFolder: typeof parsed.workspaceFolder === 'string' ? parsed.workspaceFolder : undefined
    }, device.id)
  } catch {
    return undefined
  }
}

export const visibleDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: RelayDevice
) => decryptDevicePrivateMetadata(args, device) ?? legacyDevicePrivateMetadata(device)

export const storeEncryptedDevicePrivateMetadata = (
  args: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>,
  device: RelayDevice,
  metadata: RelayDevicePrivateMetadata
) => {
  device.encryptedMetadata = encryptDevicePrivateMetadata(args, device, metadata)
  device.name = undefined
  device.alias = undefined
  device.capabilities = undefined
  device.workspaceFolder = undefined
  device.pluginScope = undefined
}
