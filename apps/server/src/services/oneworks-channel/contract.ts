import { z } from 'zod'

export const oneworksChannelSimulationTargetSchema = z.object({
  binding: z.enum(['default', 'direct', 'group', 'thread']),
  capabilities: z.array(z.enum(['scenarios', 'simulation'])),
  channelType: z.string().trim().min(1),
  commandPrefix: z.string(),
  entity: z.string().optional(),
  label: z.string(),
  linkName: z.string().optional(),
  roomRef: z.string(),
  status: z.enum(['connected', 'disabled', 'error'])
}).strict()

export const oneworksRoomPlatformSchema = z.object({
  accountCount: z.number().int().nonnegative(),
  channelType: z.string().trim().min(1),
  labels: z.array(z.string())
}).strict()

export const oneworksRoomSummarySchema = z.object({
  activeShareCount: z.number().int().nonnegative(),
  archived: z.boolean(),
  channelLinkCount: z.number().int().nonnegative(),
  lastMessage: z.string().optional(),
  memberCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  ownerRef: z.string().optional(),
  platforms: z.array(oneworksRoomPlatformSchema),
  roomId: z.string(),
  status: z.enum(['active', 'idle', 'completed', 'failed']),
  title: z.string(),
  updatedAt: z.number().int().nonnegative()
}).strict()

export const oneworksRoomSharePermissionSchema = z.enum([
  'approve',
  'manage_share',
  'open_run',
  'send',
  'target_member',
  'view'
])

export const oneworksRoomShareInputSchema = z.object({
  grants: z.array(
    z.object({
      permissions: z.array(oneworksRoomSharePermissionSchema).min(1),
      principalId: z.string().trim().min(1),
      principalType: z.enum(['team', 'user'])
    }).strict()
  ).min(1),
  ownerRef: z.string().trim().min(1).optional()
}).strict()

export const oneworksRoomShareOwnerSchema = z.object({
  label: z.string(),
  ownerRef: z.string()
}).strict()

export const oneworksRoomShareSummarySchema = z.object({
  createdAt: z.number().int().nonnegative(),
  grantCount: z.number().int().positive(),
  permissions: z.array(oneworksRoomSharePermissionSchema),
  roomId: z.string(),
  roomTitle: z.string(),
  shareRef: z.string(),
  status: z.enum(['active', 'revoked']),
  updatedAt: z.number().int().nonnegative()
}).strict()

export const oneworksSharedRoomSummarySchema = z.object({
  availability: z.enum(['offline', 'online']),
  createdAt: z.number().int().nonnegative(),
  icon: z.string().optional(),
  shareRef: z.string(),
  sourceLabel: z.string(),
  status: z.enum(['active', 'revoked']),
  title: z.string(),
  updatedAt: z.number().int().nonnegative()
}).strict()

export const oneworksChannelTraceSchema = z.object({
  at: z.number().int().nonnegative(),
  decision: z.string().optional(),
  kind: z.enum(['backlog', 'child-run', 'command', 'ingress', 'policy', 'turn']),
  reason: z.string(),
  status: z.string(),
  traceRef: z.string()
}).strict()

export const oneworksChannelSimulationInputSchema = z.object({
  actorRole: z.enum(['admin', 'participant']),
  roomRef: z.string().trim().min(1),
  sessionType: z.enum(['direct', 'group']).default('group'),
  text: z.string().trim().min(1).max(4000),
  userLabel: z.string().trim().min(1).max(80)
}).strict()

export const oneworksChannelSimulationResultSchema = z.object({
  accepted: z.boolean(),
  messageRef: z.string().optional(),
  status: z.number().int()
}).strict()

export const oneworksChannelScenarioInputSchema = oneworksChannelSimulationInputSchema.extend({
  name: z.string().trim().min(1).max(120)
}).strict()

export const oneworksChannelScenarioPatchSchema = oneworksChannelScenarioInputSchema.partial().strict()

export const oneworksChannelScenarioSchema = oneworksChannelScenarioInputSchema.extend({
  createdAt: z.number().int().nonnegative(),
  scenarioRef: z.string(),
  updatedAt: z.number().int().nonnegative()
}).strict()

export type OneWorksChannelSimulationTarget = z.infer<typeof oneworksChannelSimulationTargetSchema>
export type OneWorksRoomSummary = z.infer<typeof oneworksRoomSummarySchema>
export type OneWorksRoomShareInput = z.infer<typeof oneworksRoomShareInputSchema>
export type OneWorksRoomShareOwner = z.infer<typeof oneworksRoomShareOwnerSchema>
export type OneWorksRoomShareSummary = z.infer<typeof oneworksRoomShareSummarySchema>
export type OneWorksSharedRoomSummary = z.infer<typeof oneworksSharedRoomSummarySchema>
export type OneWorksChannelTrace = z.infer<typeof oneworksChannelTraceSchema>
export type OneWorksChannelSimulationInput = z.infer<typeof oneworksChannelSimulationInputSchema>
export type OneWorksChannelSimulationResult = z.infer<typeof oneworksChannelSimulationResultSchema>
export type OneWorksChannelScenarioInput = z.infer<typeof oneworksChannelScenarioInputSchema>
export type OneWorksChannelScenarioPatch = z.infer<typeof oneworksChannelScenarioPatchSchema>
export type OneWorksChannelScenario = z.infer<typeof oneworksChannelScenarioSchema>
