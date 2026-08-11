import type { PluginOverlayConfig } from './plugin'

export interface Filter {
  include?: string[]
  exclude?: string[]
}

export interface Rule {
  name?: string
  description?: string
  globs?: string | string[]
  always?: boolean
  alwaysApply?: boolean
}

export interface Spec {
  name?: string
  always?: boolean
  description?: string
  tags?: string[]
  params?: {
    name: string
    description?: string
  }[]
  rules?: string[]
  skills?: string[]
  mcpServers?: Filter
  tools?: Filter
  /**
   * 当前 `spec` 对项目插件列表的任务级覆盖。
   *
   * 适用于给某个工作流程临时追加插件，或完全替换默认插件图。
   * 这层覆盖只影响当前任务。
   */
  plugins?: PluginOverlayConfig
}

export interface LocalRuleReference {
  type?: 'local'
  path: string
  desc?: string
}

export interface RemoteRuleReference {
  type: 'remote'
  tags?: string[]
  desc?: string
}

export type RuleReference = string | LocalRuleReference | RemoteRuleReference

export interface SkillSelection {
  type: 'include' | 'exclude'
  list: string[]
}

export type EntityInheritanceMode = 'append' | 'prepend' | 'merge' | 'replace' | 'none'

export interface EntityInheritance {
  default?: EntityInheritanceMode
  prompt?: EntityInheritanceMode
  tags?: EntityInheritanceMode
  rules?: EntityInheritanceMode
  skills?: EntityInheritanceMode
  tools?: EntityInheritanceMode
  mcpServers?: EntityInheritanceMode
}

export interface Entity {
  name?: string
  avatar?: string
  always?: boolean
  description?: string
  tags?: string[]
  extends?: string | string[]
  inherit?: EntityInheritanceMode | EntityInheritance
  prompt?: string
  promptPath?: string
  rules?: RuleReference[]
  skills?: string[] | SkillSelection
  mcpServers?: Filter
  tools?: Filter
  /**
   * 当前 `entity` 对项目插件列表的任务级覆盖。
   *
   * 这层覆盖会先影响当前任务的 effective plugin graph，
   * 再继续参与 rules / skills / MCP 等依赖解析。
   */
  plugins?: PluginOverlayConfig
}

export interface ChannelLinkIngress {
  ambientRouting?: boolean
  createOnCommand?: boolean
  createOnMention?: boolean
  mentionPatterns?: string[]
  routerPrompt?: string
}

export interface ChannelLinkWorkHour {
  days?: number[]
  start: string
  end: string
}

export interface ChannelLinkOffHours {
  mode?: 'buffer' | 'drop'
  replyText?: string
  replyThrottleMs?: number
}

export interface ChannelLinkAvailability {
  enabled?: boolean
  timezone?: string
  workHours?: ChannelLinkWorkHour[]
  offHours?: ChannelLinkOffHours
  /** Canonical user ids only. */
  bypassUsers?: string[]
  /** Platform account ids for this channel issuer only. */
  bypassSenders?: string[]
}

export type ChannelModerationSeverity = 'none' | 'warn' | 'mute' | 'ban'

export interface ChannelLinkModerationLevel {
  hit: number
  action: 'warn' | 'mute' | 'mute_permanent'
  durationMs?: number
}

export interface ChannelLinkModeration {
  enabled?: boolean
  reviewAdapter?: string
  reviewModel?: string
  reviewPrompt?: string
  replyText?: string
  replyThrottleMs?: number
  /** Account scope is the conservative default. User scope requires a verified canonical user. */
  subjectScope?: 'account' | 'user'
  levels?: ChannelLinkModerationLevel[]
  autoPermanentMute?: boolean
  /** Canonical user ids only. */
  bypassUsers?: string[]
  /** Issuer-scoped account ids. `bypassSenders` remains a compatibility alias. */
  bypassAccounts?: string[]
  bypassSenders?: string[]
}

export interface ChannelLinkAuthorization {
  deliveryThrottleMs?: number
  resume?: {
    delayMs?: number
    mode?: 'immediate' | 'manual' | 'next_message'
  }
}

export interface ChannelLink {
  name?: string
  description?: string
  channel: string
  entity: string
  external: {
    type: string
    [key: string]: unknown
  }
  memoryScope?: string
  access?: Record<string, unknown>
  ingress?: ChannelLinkIngress
  authorization?: ChannelLinkAuthorization
  availability?: ChannelLinkAvailability
  moderation?: ChannelLinkModeration
  routing?: Record<string, unknown>
}

export interface Skill {
  name?: string
  description?: string
  always?: boolean
  metadata?: {
    publish?: {
      source?: string
      /**
       * @deprecated Use `source` instead.
       */
      registry?: string
      group?: string
      region?: string
      access?: string
    }
  }
  dependencies?: Array<
    | string
    | {
      name: string
      source?: string
      registry?: string
      version?: string
    }
  >
}

export type DefinitionSource = 'project' | 'plugin' | 'home'

export interface Definition<T> {
  path: string
  body: string
  attributes: T
  resolvedName?: string
  resolvedInstancePath?: string
  resolvedSource?: DefinitionSource
}
