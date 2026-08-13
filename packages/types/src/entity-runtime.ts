import type {
  ChannelLinkIngress,
  ChannelLinkRouting,
  Entity,
  EntityDocumentKind,
  EntityInheritanceMode
} from './definition'

export interface EntityRuntimeChannelAccount {
  bindingCount: number
  channelKey: string
  configPath?: string
  configSource: 'effective' | 'global' | 'project' | 'user'
  description: string
  enabled: boolean
  title: string
  type: string
}

export interface EntityRuntimeDetail {
  availableChannelAccounts: EntityRuntimeChannelAccount[]
  channelAccounts: EntityRuntimeChannelAccount[]
  channelLinks: Array<{
    channelKey: string
    description: string
    editable: boolean
    externalId?: string
    externalType: string
    ingress: ChannelLinkIngress
    memoryScope?: string
    name: string
    path: string
    routing: ChannelLinkRouting
  }>
  entityConfig: {
    editable: boolean
    effective: Record<string, unknown>
    extends: string[]
    inherit?: Entity['inherit']
    mcpServers: { exclude: string[]; include: string[] }
    plugins?: Entity['plugins']
    jsonSchema: Record<string, unknown>
    overrides: Record<string, unknown>
    path?: string
    skills: { exclude: string[]; include: string[] }
    tools: { exclude: string[]; include: string[] }
  }
  documents: Array<{
    body: string
    editable: boolean
    exists: boolean
    fragments: Array<{
      body: string
      entity: string
      inherited: boolean
      path?: string
      source: 'workspace' | 'plugin'
    }>
    inherit: EntityInheritanceMode
    kind: EntityDocumentKind
    path?: string
    title: string
  }>
  effectiveContext: {
    body: string
    sectionCount: number
    sourceCount: number
  }
  entityPath: string
  memoryPolicy: {
    config: NonNullable<Entity['memory']>
    groupDimensions: string[]
    loading: {
      requiredGroups: string[]
      sameGroup: 'or'
      crossGroup: 'and'
    }
  }
  memories: Array<{
    confidence: number
    content: string
    expiresAt: number | null
    editable: boolean
    id: string
    importance: number
    keywords: string[]
    pinned: boolean
    readOnlyReason?: string
    sensitivity: 'normal' | 'sensitive'
    source: {
      channelKey?: string
      channelType?: string
      issuer: string
      org: string
      sessionType: string
    } | null
    subjectId: string
    subjectType: 'account' | 'canonical_user' | 'channel' | 'conversation' | 'entity' | 'room'
    updatedAt: number
    visibility: {
      channels?: string[]
      conversationTypes?: string[]
      entities?: string[]
      orgs?: string[]
      rooms?: string[]
    } | null
  }>
  modelDefaults: {
    adapter?: string
    model?: string
    modelService?: string
    projectConfigPath?: string
  }
  rooms: Array<{
    archived: boolean
    id: string
    members: Array<{ avatar?: string; key: string; label: string }>
    status: string
    title: string
    updatedAt: number
  }>
}
