import path from 'node:path'

import type { MemoryAccess, MemoryCommandOptions, MemoryContext, MemoryScope, MemoryTarget } from './shared'
import { ensureRelativeMemoryPath, toStorageSegment } from './shared'

const requireValue = (value: string | undefined, message: string) => {
  if (value != null && value !== '') return value
  throw new Error(message)
}

const resolveTargetDir = (scope: MemoryScope, context: MemoryContext, displayId?: string) => {
  if (scope === 'global') return path.resolve(context.root, 'global')
  if (scope === 'entity' || scope === 'room') {
    const visibilityPartition = context.channelSessionType === 'direct' ? 'direct' : 'organization'
    const rootName = scope === 'entity' ? 'entities' : 'rooms'
    return path.resolve(
      context.root,
      rootName,
      toStorageSegment(requireValue(displayId, `Missing ${scope} id.`)),
      visibilityPartition
    )
  }
  if (scope === 'conversation' || scope === 'session') {
    const rootName = scope === 'conversation'
      ? 'conversations'
      : 'sessions'
    return path.resolve(context.root, rootName, toStorageSegment(requireValue(displayId, `Missing ${scope} id.`)))
  }

  const channelRef = requireValue(context.channelRef, 'Missing channel. Pass -c/--channel.')
  const rootName = scope === 'channel' ? 'channels' : 'users'
  const baseDir = path.resolve(
    context.root,
    rootName,
    toStorageSegment(channelRef),
    toStorageSegment(requireValue(displayId, `Missing ${scope} memory id.`))
  )
  if (scope === 'channel') return baseDir
  return path.resolve(
    baseDir,
    toStorageSegment(requireValue(context.channelSessionType, 'Missing channel session type.'))
  )
}

export const resolveTarget = (options: MemoryCommandOptions, access: MemoryAccess) => {
  const { context, displayId, scope } = access
  if (scope !== 'global' && displayId == null) {
    throw new Error(`Missing ${scope === 'user' ? 'user memory' : scope} id. Pass -f/--filter.`)
  }
  const memoryPath = ensureRelativeMemoryPath(options.path)
  const dir = resolveTargetDir(scope, context, displayId)
  const filePath = path.resolve(dir, ...memoryPath.split('/'))
  const relativePath = path.relative(dir, filePath)

  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error('Memory path resolved outside the selected memory id.')
  }

  const visibilityPartition = scope === 'entity' || scope === 'room'
    ? context.channelSessionType === 'direct' ? 'direct' : 'organization'
    : undefined
  return {
    context,
    target: { dir, displayId, filePath, memoryPath, scope, visibilityPartition } satisfies MemoryTarget
  }
}
