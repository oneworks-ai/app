import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

import { authorizeMemoryAccess } from './authorization'
import { formatEntries, listMemoryEntries } from './entries'
import { MAX_MEMORY_FILE_BYTES, META_FILE_NAME, formatTargetLabel } from './shared'
import type { MemoryCommandOptions, MemoryContext, MemoryTarget } from './shared'
import { resolveTarget } from './target'

const writeMeta = async (target: MemoryTarget, context: MemoryContext) => {
  await fs.mkdir(target.dir, { recursive: true })
  await fs.writeFile(
    path.resolve(target.dir, META_FILE_NAME),
    `${
      JSON.stringify(
        {
          channel: context.channelRef,
          channelId: context.channelId,
          channelKey: context.channelKey,
          channelSessionType: context.channelSessionType,
          channelType: context.channelType,
          conversationStateId: context.conversationStateId,
          entity: context.entity,
          id: target.displayId,
          scope: target.scope,
          senderId: context.senderId,
          sessionId: context.sessionId,
          visibilityPartition: target.visibilityPartition,
          updatedAt: Date.now()
        },
        null,
        2
      )
    }\n`
  )
}

const withTrailingNewline = (value: string) => value.endsWith('\n') ? value : `${value}\n`

const assertMemorySize = (content: string) => {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_MEMORY_FILE_BYTES) {
    throw new Error(`Memory file exceeds the ${MAX_MEMORY_FILE_BYTES} byte limit.`)
  }
}

export const readFileIfPresent = async (filePath: string) => {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export const readMemory = async (options: MemoryCommandOptions) => {
  const access = await authorizeMemoryAccess(options)
  const { target } = resolveTarget(options, access)
  return await readFileIfPresent(target.filePath)
}

export const listMemory = async (options: MemoryCommandOptions) => {
  const access = await authorizeMemoryAccess(options)
  return formatEntries(await listMemoryEntries(options, access))
}

export const writeMemory = async (mode: 'patch' | 'set', options: MemoryCommandOptions) => {
  const access = await authorizeMemoryAccess(options, 'write')
  const { context, target } = resolveTarget(options, access)
  const content = options.content ?? ''
  await fs.mkdir(path.dirname(target.filePath), { recursive: true })
  await writeMeta(target, context)

  if (mode === 'set') {
    const next = withTrailingNewline(content)
    assertMemorySize(next)
    await fs.writeFile(target.filePath, next)
  } else {
    const current = await readFileIfPresent(target.filePath)
    const next = current === ''
      ? withTrailingNewline(content)
      : `${current}${current.endsWith('\n') ? '' : '\n'}${withTrailingNewline(content)}`
    assertMemorySize(next)
    await fs.writeFile(target.filePath, next)
  }

  return `Memory ${mode === 'set' ? 'written' : 'patched'}: ${formatTargetLabel(target)}`
}
