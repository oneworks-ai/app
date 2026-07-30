import { Buffer } from 'node:buffer'
import { types as utilTypes } from 'node:util'

import { RuntimeActivationContentItemSchema } from '@oneworks/runtime-protocol'
import { z } from 'zod'

const MAX_STRING_BYTES = 16 * 1024
const MAX_TOTAL_BYTES = 128 * 1024
const MAX_ITEMS = 1_024
const MAX_NODES = 2_048
const MAX_DEPTH = 12
const SECRET_KEY_PATTERN =
  /(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private)/iu

const SafeJsonSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(SafeJsonSchema).max(256),
  z.record(SafeJsonSchema)
]))

const BoundedStringSchema = z.string().refine(
  value => Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES,
  'string exceeds request limit'
)
const NonEmptyStringSchema = z.string().trim().min(1).refine(
  value => Buffer.byteLength(value, 'utf8') <= MAX_STRING_BYTES,
  'string exceeds request limit'
)

const PanelViewportSchema = z.object({
  devicePixelRatio: z.number().finite().optional(),
  deviceType: BoundedStringSchema.optional(),
  height: z.number().finite().optional(),
  presetId: BoundedStringSchema.optional(),
  width: z.number().finite().optional(),
  zoom: z.union([z.literal('auto'), z.number().finite()]).optional()
}).strict()

const PanelTabCommon = {
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema
}

const PanelTabSchema = z.discriminatedUnion('kind', [
  z.object({
    ...PanelTabCommon,
    kind: z.literal('web'),
    url: NonEmptyStringSchema,
    browserControlRequestId: BoundedStringSchema.optional(),
    devtoolsDockSide: BoundedStringSchema.optional(),
    faviconUrl: BoundedStringSchema.optional(),
    historyIndex: z.number().int().nonnegative().optional(),
    variant: BoundedStringSchema.optional(),
    deviceToolbarOpen: z.boolean().optional(),
    inspectOpen: z.boolean().optional(),
    history: z.array(BoundedStringSchema).max(256).optional(),
    viewport: PanelViewportSchema.optional()
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('terminal'),
    terminalId: NonEmptyStringSchema,
    shellKind: BoundedStringSchema.optional(),
    runCommand: SafeJsonSchema.optional()
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('file'),
    path: NonEmptyStringSchema
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('session'),
    focusRequestId: BoundedStringSchema.optional(),
    sessionId: BoundedStringSchema.optional()
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('mobile-debug'),
    state: SafeJsonSchema.optional()
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('page-debugger')
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('workspace-drawer'),
    view: NonEmptyStringSchema
  }).strict(),
  z.object({
    ...PanelTabCommon,
    kind: z.literal('plugin'),
    pluginScope: NonEmptyStringSchema,
    tabId: NonEmptyStringSchema,
    viewId: NonEmptyStringSchema,
    icon: BoundedStringSchema.optional(),
    stateVersion: z.number().finite().optional(),
    state: SafeJsonSchema.optional()
  }).strict()
])

const PanelAreaSchema = z.object({
  tabs: z.array(PanelTabSchema).max(256),
  activeTabId: BoundedStringSchema.optional(),
  layout: SafeJsonSchema.optional()
}).strict()

export const SessionPanelStateInputSchema = z.object({
  bottom: PanelAreaSchema,
  right: PanelAreaSchema
}).strict()

const PermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions'
])

export const SessionPatchRequestSchema = z.object({
  title: BoundedStringSchema.optional(),
  isStarred: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  tags: z.array(NonEmptyStringSchema).max(64).optional(),
  panelState: SessionPanelStateInputSchema.optional(),
  permissionMode: PermissionModeSchema.optional()
}).strict()

const QueueContentSchema = z.array(RuntimeActivationContentItemSchema).min(1).max(32)

export const SessionQueueCreateRequestSchema = z.object({
  mode: z.enum(['steer', 'next']),
  content: QueueContentSchema
}).strict()

export const SessionQueueUpdateRequestSchema = z.object({
  content: QueueContentSchema
}).strict()

export const SessionQueueReorderRequestSchema = z.object({
  mode: z.enum(['steer', 'next']),
  ids: z.array(NonEmptyStringSchema).max(256)
}).strict().superRefine((value, context) => {
  if (new Set(value.ids).size !== value.ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'queue order ids must be unique',
      path: ['ids']
    })
  }
})

export const SessionQueueMoveRequestSchema = z.object({
  mode: z.enum(['steer', 'next'])
}).strict()

interface IngressBudget {
  bytes: number
  items: number
  nodes: number
}

const consumeIngressBudget = (
  value: unknown,
  budget: IngressBudget
): boolean => {
  const worklist: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }]
  const seen = new Set<object>()
  while (worklist.length > 0) {
    const current = worklist.pop()!
    budget.nodes += 1
    if (budget.nodes > MAX_NODES || current.depth > MAX_DEPTH) return false
    if (current.value == null || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false
      continue
    }
    if (typeof current.value === 'string') {
      const bytes = Buffer.byteLength(current.value, 'utf8')
      budget.bytes += bytes
      if (bytes > MAX_STRING_BYTES || budget.bytes > MAX_TOTAL_BYTES) return false
      continue
    }
    if (typeof current.value !== 'object') return false
    // `util.types.isProxy` is a non-trapping Node intrinsic. Reject before
    // Array.isArray or any reflective operation so hostile/revoked proxies
    // cannot execute user code or exhaust the stack during pre-Zod scanning.
    if (utilTypes.isProxy(current.value)) return false
    if (seen.has(current.value)) return false
    seen.add(current.value)
    if (Array.isArray(current.value)) {
      if (Object.getPrototypeOf(current.value) !== Array.prototype) return false
      budget.items += current.value.length
      if (budget.items > MAX_ITEMS) return false
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current.value, String(index))
        if (descriptor == null || !descriptor.enumerable || !('value' in descriptor)) return false
        worklist.push({ depth: current.depth + 1, value: descriptor.value })
      }
      continue
    }
    const prototype = Object.getPrototypeOf(current.value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const ownKeys = Reflect.ownKeys(current.value)
    if (ownKeys.some(key => typeof key !== 'string')) return false
    budget.items += ownKeys.length
    if (budget.items > MAX_ITEMS) return false
    for (let index = ownKeys.length - 1; index >= 0; index -= 1) {
      const key = ownKeys[index] as string
      if (
        SECRET_KEY_PATTERN.test(key) ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype' ||
        Buffer.byteLength(key, 'utf8') > 128
      ) return false
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key)
      if (descriptor == null || !descriptor.enumerable || !('value' in descriptor)) return false
      worklist.push({ depth: current.depth + 1, value: descriptor.value })
    }
  }
  return true
}

const parseBoundedPlan = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  // Bound depth/nodes/items/bytes and reject secret-bearing keys before a
  // recursive Zod schema can inspect attacker-controlled tool/state JSON.
  try {
    if (!consumeIngressBudget(value, { bytes: 0, items: 0, nodes: 0 })) {
      return undefined
    }
    const parsed = schema.safeParse(value)
    if (!parsed.success) return undefined
    return structuredClone(parsed.data)
  } catch {
    return undefined
  }
}

export const parseSessionPatchRequest = (value: unknown) =>
  parseBoundedPlan(SessionPatchRequestSchema, value)

export const parseSessionQueueCreateRequest = (value: unknown) =>
  parseBoundedPlan(SessionQueueCreateRequestSchema, value)

export const parseSessionQueueUpdateRequest = (value: unknown) =>
  parseBoundedPlan(SessionQueueUpdateRequestSchema, value)

export const parseSessionQueueReorderRequest = (value: unknown) =>
  parseBoundedPlan(SessionQueueReorderRequestSchema, value)

export const parseSessionQueueMoveRequest = (value: unknown) =>
  parseBoundedPlan(SessionQueueMoveRequestSchema, value)
