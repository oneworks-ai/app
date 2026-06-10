import type { z } from 'zod'

import { RuntimeJsonlRecordSchema } from '#~/schemas.js'
import type { RuntimeJsonlRecord } from '#~/types.js'

export interface ParseJsonlLineOptions<T extends RuntimeJsonlRecord> {
  schema?: z.ZodType<T>
}

export interface SerializeJsonlRecordOptions<T extends RuntimeJsonlRecord> {
  schema?: z.ZodType<T>
}

export const parseJsonlLine = <T extends RuntimeJsonlRecord = RuntimeJsonlRecord>(
  line: string,
  options: ParseJsonlLineOptions<T> = {}
) => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    throw new Error('Cannot parse an empty JSONL line')
  }

  const parsed = JSON.parse(trimmed) as unknown
  const record = RuntimeJsonlRecordSchema.parse(parsed)

  if (options.schema != null) {
    return options.schema.parse(record)
  }

  return record as T
}

export const serializeJsonlRecord = <
  T extends RuntimeJsonlRecord = RuntimeJsonlRecord,
>(
  record: T,
  options: SerializeJsonlRecordOptions<T> = {}
) => {
  const validated = options.schema == null
    ? RuntimeJsonlRecordSchema.parse(record)
    : options.schema.parse(record)

  return `${JSON.stringify(validated)}\n`
}
