import type { EffortLevel } from '@oneworks/core'
import type { ChannelIngressDecision, ChannelRouteMode, ChannelRouteVisibility } from '@oneworks/types'

export interface ResolvedChannelRoute {
  adapter?: string
  effort?: EffortLevel
  mode: ChannelRouteMode
  model?: string
  visibility?: ChannelRouteVisibility
}

export interface IngressRouterDecision {
  confidence: number
  decision: ChannelIngressDecision
  mode?: ChannelRouteMode
  reason: string
}

export interface RouterModelInvocation {
  adapter: string
  context: readonly string[]
  model: string
  prompt?: string
  text: string
}

export interface RouterModelOutput {
  confidence: number
  decision: ChannelIngressDecision
  mode?: ChannelRouteMode
  reason: string
}

export type RouterModelInvocationResult =
  | { ok: true; output: RouterModelOutput; latencyMs: number }
  | { ok: false; code: 'invalid_output' | 'timeout' | 'unsupported' | 'failed'; error: string; latencyMs: number }

export interface RouterModelInvoker {
  invoke(input: RouterModelInvocation): Promise<RouterModelInvocationResult>
}
