import { isRecord } from '../utils.js'
import { cleanDeviceMetadataText } from './device-environment.js'

export interface RelayDeviceManagementServerProjectMetadata {
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  status?: string
  title?: string
  workspaceFolder?: string
}

const normalizeProject = (
  input: Partial<RelayDeviceManagementServerProjectMetadata>
): RelayDeviceManagementServerProjectMetadata | undefined => {
  const createdAt = cleanDeviceMetadataText(input.createdAt)
  const id = cleanDeviceMetadataText(input.id)
  const lastSeenAt = cleanDeviceMetadataText(input.lastSeenAt)
  const name = cleanDeviceMetadataText(input.name)
  const status = cleanDeviceMetadataText(input.status)
  const title = cleanDeviceMetadataText(input.title)
  const workspaceFolder = cleanDeviceMetadataText(input.workspaceFolder)
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

const projectKeyCandidates = (project: RelayDeviceManagementServerProjectMetadata) => {
  const workspaceFolder = cleanDeviceMetadataText(project.workspaceFolder)
  const id = cleanDeviceMetadataText(project.id)
  const name = cleanDeviceMetadataText(project.name)
  const title = cleanDeviceMetadataText(project.title)
  return [
    workspaceFolder === '' ? undefined : `workspace:${workspaceFolder}`,
    id === '' ? undefined : `id:${id}`,
    name === '' ? undefined : `name:${name}`,
    title === '' ? undefined : `title:${title}`
  ].filter((item): item is string => item != null && item !== '')
}

const projectSortTime = (project: RelayDeviceManagementServerProjectMetadata) => {
  const timestamp = Date.parse(project.lastSeenAt ?? project.createdAt ?? '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

const mergeProject = (
  previous: RelayDeviceManagementServerProjectMetadata | undefined,
  incoming: RelayDeviceManagementServerProjectMetadata,
  seenAt: string | undefined
) => {
  const incomingTime = projectSortTime(incoming)
  const previousTime = previous == null ? 0 : projectSortTime(previous)
  const freshest = incomingTime >= previousTime ? incoming : previous
  return normalizeProject({
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

const dedupeProjects = (projects: RelayDeviceManagementServerProjectMetadata[], seenAt?: string) => {
  const projectsByPrimaryKey = new Map<string, RelayDeviceManagementServerProjectMetadata>()
  const primaryKeyByAlias = new Map<string, string>()
  for (const project of projects) {
    const aliases = projectKeyCandidates(project)
    if (aliases.length === 0) continue
    const primaryKey = aliases
      .map(alias => primaryKeyByAlias.get(alias))
      .find((item): item is string => item != null) ?? aliases[0]
    const next = mergeProject(projectsByPrimaryKey.get(primaryKey), project, seenAt)
    if (next == null) continue
    projectsByPrimaryKey.set(primaryKey, next)
    for (const alias of projectKeyCandidates(next)) primaryKeyByAlias.set(alias, primaryKey)
  }
  return [...projectsByPrimaryKey.values()].sort((left, right) => projectSortTime(right) - projectSortTime(left))
}

export const normalizeManagementServerProjects = (value: unknown) => (
  Array.isArray(value)
    ? dedupeProjects(
      value
        .filter(isRecord)
        .map(item => normalizeProject(item))
        .filter((item): item is RelayDeviceManagementServerProjectMetadata => item != null)
    )
    : []
)

export const mergeManagementServerProjects = (
  previousProjects: RelayDeviceManagementServerProjectMetadata[] | undefined,
  incomingValue: unknown,
  seenAt: string
) => {
  const incomingProjects = normalizeManagementServerProjects(incomingValue)
  if (incomingProjects.length === 0) {
    return previousProjects == null ? previousProjects : dedupeProjects(previousProjects, seenAt)
  }
  return dedupeProjects([
    ...(previousProjects ?? []),
    ...incomingProjects.map(project => ({
      ...project,
      createdAt: project.createdAt ?? seenAt,
      lastSeenAt: project.lastSeenAt ?? seenAt
    }))
  ], seenAt)
}
