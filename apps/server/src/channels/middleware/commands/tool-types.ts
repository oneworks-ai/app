import type { ConfigJsonSchema } from '@oneworks/types'

import type {
  CommandArgumentSpec,
  CommandParseSuccess,
  PermissionLevel,
  ResolvedCommandApprovalMetadata,
  ResolvedCommandEffectMetadata
} from './command-system'

export type ChannelCommandToolArgumentKind = CommandArgumentSpec['kind']

export interface ChannelCommandToolArgumentChoice {
  readonly value: string
  readonly titleKey: string
  readonly descriptionKey?: string
}

export interface ChannelCommandToolArgument {
  readonly name: string
  readonly kind: ChannelCommandToolArgumentKind
  readonly descriptionKey?: string
  readonly choices: readonly ChannelCommandToolArgumentChoice[]
}

export interface ChannelCommandToolDefinition {
  readonly name: string
  readonly namespace: 'channel'
  readonly commandPath: readonly string[]
  readonly commandAliases: readonly string[]
  readonly slashUsage: string
  readonly descriptionKey?: string
  readonly permission: PermissionLevel
  /** Legacy channel-only approval metadata for non-effect commands. */
  readonly approval?: ResolvedCommandApprovalMetadata
  /** Unified Tool Approval metadata, when this command has an external effect. */
  readonly effect?: ResolvedCommandEffectMetadata
  readonly actorAuthority: 'sender'
  readonly source: 'command-spec'
  readonly inputSchema: ConfigJsonSchema
  readonly arguments: readonly ChannelCommandToolArgument[]
}

export type ChannelCommandToolInputParseResult<TContext> =
  | CommandParseSuccess<TContext>
  | {
    readonly ok: false
    readonly code: 'unknown-tool' | 'invalid-input' | 'missing-argument' | 'invalid-argument'
    readonly message: string
    readonly usage?: string
  }
