import path from 'node:path'

import { resolveContext } from './context'
import type { MemoryCommandOptions, MemoryContext, MemoryScope, MemoryTarget } from './shared'
import { ensureRelativeMemoryPath, normalizeScope, toStorageSegment, trimNonEmpty } from './shared'

const requireValue = (value: string | undefined, message: string) => {
  if (value != null && value !== '') return value
  throw new Error(message)
}

const resolveTargetId = (scope: MemoryScope, context: MemoryContext, filter: string | undefined) => {
  const explicitId = trimNonEmpty(filter)
  if (scope === 'global') return undefined
  if (scope === 'channel') {
    return requireValue(explicitId ?? context.channelId, 'Missing channel memory id. Pass -f/--filter.')
  }
  if (scope === 'session') {
    return requireValue(explicitId ?? context.sessionId, 'Missing session memory id. Pass -f/--filter.')
  }
  return requireValue(explicitId ?? context.senderId, 'Missing user memory id. Pass -f/--filter.')
}

const resolveTargetDir = (scope: MemoryScope, context: MemoryContext, displayId?: string) => {
  if (scope === 'global') return path.resolve(context.root, 'global')
  if (scope === 'session') {
    return path.resolve(context.root, 'sessions', toStorageSegment(requireValue(displayId, 'Missing session id.')))
  }

  const channelRef = requireValue(context.channelRef, 'Missing channel. Pass -c/--channel.')
  const rootName = scope === 'channel' ? 'channels' : 'users'
  return path.resolve(
    context.root,
    rootName,
    toStorageSegment(channelRef),
    toStorageSegment(requireValue(displayId, `Missing ${scope} memory id.`))
  )
}

export const resolveTarget = (options: MemoryCommandOptions) => {
  const context = resolveContext(options)
  const scope = normalizeScope(options.scope)
  const displayId = resolveTargetId(scope, context, options.filter)
  const memoryPath = ensureRelativeMemoryPath(options.path)
  const dir = resolveTargetDir(scope, context, displayId)
  const filePath = path.resolve(dir, ...memoryPath.split('/'))
  const relativePath = path.relative(dir, filePath)

  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error('Memory path resolved outside the selected memory id.')
  }

  return { context, target: { dir, displayId, filePath, memoryPath, scope } satisfies MemoryTarget }
}
