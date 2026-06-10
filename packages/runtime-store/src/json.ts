import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface JsonlTailResult<T> {
  nextOffset: number
  records: T[]
}

const isNotFound = (error: unknown) => {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export const readJsonFile = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const content = await readFile(filePath, 'utf8')
    if (content.trim() === '') {
      return undefined
    }
    return JSON.parse(content) as T
  } catch (error) {
    if (isNotFound(error)) {
      return undefined
    }
    throw error
  }
}

export const writeJsonFileAtomic = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

export const appendJsonlLine = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    flag: 'a'
  })
}

const parseCompleteJsonl = <T>(text: string) => {
  const completeText = text.endsWith('\n')
    ? text
    : text.slice(0, Math.max(0, text.lastIndexOf('\n') + 1))
  const records = completeText
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as T)

  return {
    consumedBytes: Buffer.byteLength(completeText),
    records
  }
}

export const readJsonlFile = async <T>(filePath: string): Promise<T[]> => {
  try {
    const content = await readFile(filePath, 'utf8')
    return parseCompleteJsonl<T>(content).records
  } catch (error) {
    if (isNotFound(error)) {
      return []
    }
    throw error
  }
}

export const tailJsonlFile = async <T>(
  filePath: string,
  offset = 0
): Promise<JsonlTailResult<T>> => {
  let file
  try {
    file = await open(filePath, 'r')
  } catch (error) {
    if (isNotFound(error)) {
      return { nextOffset: 0, records: [] }
    }
    throw error
  }

  try {
    const stat = await file.stat()
    const safeOffset = Math.min(Math.max(0, offset), stat.size)
    const length = stat.size - safeOffset
    if (length === 0) {
      return { nextOffset: safeOffset, records: [] }
    }

    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, safeOffset)
    const parsed = parseCompleteJsonl<T>(buffer.toString('utf8'))
    return {
      nextOffset: safeOffset + parsed.consumedBytes,
      records: parsed.records
    }
  } finally {
    await file.close()
  }
}
