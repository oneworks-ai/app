import fs from 'node:fs/promises'
import path from 'node:path'

import { formatEntries, listMemoryEntries } from './entries'
import { META_FILE_NAME, formatTargetLabel } from './shared'
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
          id: target.displayId,
          scope: target.scope,
          senderId: context.senderId,
          sessionId: context.sessionId,
          updatedAt: Date.now()
        },
        null,
        2
      )
    }\n`
  )
}

const withTrailingNewline = (value: string) => value.endsWith('\n') ? value : `${value}\n`

export const readFileIfPresent = async (filePath: string) => {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export const readMemory = async (options: MemoryCommandOptions) => {
  const { target } = resolveTarget(options)
  return await readFileIfPresent(target.filePath)
}

export const listMemory = async (options: MemoryCommandOptions) => formatEntries(await listMemoryEntries(options))

export const writeMemory = async (mode: 'patch' | 'set', options: MemoryCommandOptions) => {
  const { context, target } = resolveTarget(options)
  const content = options.content ?? ''
  await fs.mkdir(path.dirname(target.filePath), { recursive: true })
  await writeMeta(target, context)

  if (mode === 'set') {
    await fs.writeFile(target.filePath, withTrailingNewline(content))
  } else {
    const current = await readFileIfPresent(target.filePath)
    const next = current === ''
      ? withTrailingNewline(content)
      : `${current}${current.endsWith('\n') ? '' : '\n'}${withTrailingNewline(content)}`
    await fs.writeFile(target.filePath, next)
  }

  return `Memory ${mode === 'set' ? 'written' : 'patched'}: ${formatTargetLabel(target)}`
}
