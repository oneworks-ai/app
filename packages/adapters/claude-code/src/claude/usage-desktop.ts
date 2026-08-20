import { Buffer } from 'node:buffer'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import * as zlib from 'node:zlib'

import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import { parseClaudeUsageQuota } from './usage-quota'

const DESKTOP_USAGE_MAX_AGE_MS = 30 * 60 * 1000
const HTTP_CACHE_CANDIDATE_LIMIT = 256
const LOCAL_FILE_MAX_BYTES = 2_000_000
const RESPONSE_MAX_BYTES = 1_000_000
const ZSTD_MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const normalizePercent = (value: unknown) => {
  const percent = normalizeNumber(value)
  return percent == null || percent < 0 || percent > 100 ? undefined : percent
}

const formatPercent = (value: number) => `${value.toFixed(Number.isInteger(value) ? 0 : 1)}%`

const isFreshTimestamp = (timestamp: number, now: number) => (
  timestamp <= now + 5 * 60 * 1000 && now - timestamp <= DESKTOP_USAGE_MAX_AGE_MS
)

const parsePlanHistory = (value: unknown, organizationId: string, now: number) => {
  if (!isRecord(value) || !Array.isArray(value.samples)) return undefined
  const sample = value.samples.reduce<Record<string, unknown> | undefined>((latest, entry) => {
    if (!isRecord(entry) || normalizeString(entry.org) !== organizationId) return latest
    const timestamp = normalizeNumber(entry.t)
    if (timestamp == null || timestamp <= (normalizeNumber(latest?.t) ?? -Infinity)) return latest
    return entry
  }, undefined)
  if (!isRecord(sample)) return undefined
  const updatedAt = normalizeNumber(sample.t)
  if (updatedAt == null || !isFreshTimestamp(updatedAt, now)) return undefined
  const usage = isRecord(sample.u) ? sample.u : undefined
  const metrics: NonNullable<AdapterAccountQuotaInfo['metrics']> = []
  const addMetric = (id: string, label: string, percent: unknown) => {
    const normalized = normalizePercent(percent)
    if (normalized == null) return
    metrics.push({ id, label, value: formatPercent(normalized), primary: true })
  }
  addMetric('five-hour', '5-hour usage', usage?.fh)
  addMetric('seven-day', '7-day usage', usage?.sd)
  if (metrics.length === 0) return undefined
  return {
    summary: metrics.map(metric => `${metric.label}: ${metric.value}`).join(' · '),
    metrics,
    updatedAt
  } satisfies AdapterAccountQuotaInfo
}

const readBoundedFile = async (filePath: string) => {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile() || fileStat.size > LOCAL_FILE_MAX_BYTES) return undefined
  const content = await readFile(filePath)
  return content.byteLength <= LOCAL_FILE_MAX_BYTES ? { content, fileStat } : undefined
}

const readPlanHistory = async (realHome: string, organizationId: string, now: number) => {
  try {
    const result = await readBoundedFile(
      join(realHome, 'Library', 'Application Support', 'Claude', 'plan-usage-history.json')
    )
    if (result == null) return undefined
    return parsePlanHistory(JSON.parse(result.content.toString('utf8')) as unknown, organizationId, now)
  } catch {
    return undefined
  }
}

const parseCacheTimestamp = (content: Buffer, fallback: number) => {
  const match = /(?:^|[\r\n])date:([^\r\n]+)/i.exec(content.toString('latin1'))
  const timestamp = match == null ? Number.NaN : Date.parse(match[1]?.trim() ?? '')
  return Number.isFinite(timestamp) ? timestamp : fallback
}

const readCachedUsageResponse = async (
  filePath: string,
  usageUrl: Buffer,
  now: number
) => {
  try {
    const result = await readBoundedFile(filePath)
    if (result == null) return undefined
    const keyOffset = result.content.indexOf(usageUrl)
    if (keyOffset === -1) return undefined
    const keyEnd = keyOffset + usageUrl.byteLength
    const keyBoundary = result.content[keyEnd]
    const bodyStartsAtBoundary = result.content.subarray(keyEnd, keyEnd + ZSTD_MAGIC.byteLength)
      .equals(ZSTD_MAGIC)
    if (
      keyBoundary !== 0x00 && keyBoundary !== 0x0A && keyBoundary !== 0x0D &&
      !bodyStartsAtBoundary &&
      keyBoundary !== 0x3F
    ) {
      return undefined
    }
    const bodyOffset = bodyStartsAtBoundary ? keyEnd : result.content.indexOf(ZSTD_MAGIC, keyEnd)
    if (bodyOffset === -1) return undefined
    const updatedAt = parseCacheTimestamp(result.content, result.fileStat.mtimeMs)
    if (!isFreshTimestamp(updatedAt, now)) return undefined
    const decompress = Reflect.get(zlib, 'zstdDecompressSync')
    if (typeof decompress !== 'function') return undefined
    const body = decompress(result.content.subarray(bodyOffset), {
      maxOutputLength: RESPONSE_MAX_BYTES
    }) as Buffer
    return parseClaudeUsageQuota(JSON.parse(body.toString('utf8')) as unknown, updatedAt, now)
  } catch {
    return undefined
  }
}

const readHttpCache = async (realHome: string, organizationId: string, now: number) => {
  const cacheDir = join(realHome, 'Library', 'Application Support', 'Claude', 'Cache', 'Cache_Data')
  const usageUrl = Buffer.from(`https://claude.ai/api/organizations/${organizationId}/usage`, 'utf8')
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true })
    const candidates = (await Promise.all(
      entries
        .filter(entry => entry.isFile() && entry.name.endsWith('_0'))
        .map(async entry => {
          const filePath = join(cacheDir, entry.name)
          const fileStat = await stat(filePath).catch(() => undefined)
          return fileStat == null || fileStat.size > LOCAL_FILE_MAX_BYTES
            ? undefined
            : { filePath, mtimeMs: fileStat.mtimeMs }
        })
    ))
      .filter((candidate): candidate is { filePath: string; mtimeMs: number } => candidate != null)
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, HTTP_CACHE_CANDIDATE_LIMIT)
    let newest: AdapterAccountQuotaInfo | undefined
    for (const candidate of candidates) {
      const quota = await readCachedUsageResponse(candidate.filePath, usageUrl, now)
      if (quota != null && (quota.updatedAt ?? 0) > (newest?.updatedAt ?? 0)) newest = quota
    }
    return newest
  } catch {
    return undefined
  }
}

export const readClaudeDesktopUsageQuotas = async (
  realHome: string,
  organizationId: string,
  now = Date.now()
) => {
  if (process.platform !== 'darwin') return []
  return (await Promise.all([
    readPlanHistory(realHome, organizationId, now),
    readHttpCache(realHome, organizationId, now)
  ])).filter((quota): quota is AdapterAccountQuotaInfo => quota != null)
}
