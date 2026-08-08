import { randomUUID } from 'node:crypto'

import { compareCredentialRevisions, parseCredentialRevision } from '@oneworks/types/credential-revision'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeDeletedGenerations = (value: unknown) => {
  const candidates = Array.isArray(value) ? value : [value]
  const generations = candidates.flatMap(generation => (
    typeof generation === 'string' && generation.trim() !== '' ? [generation.trim()] : []
  ))
  return [...new Set(generations)]
}

export const normalizeAdapterAccountTombstones = (value: unknown): Record<string, string[]> => (
  isRecord(value)
    ? Object.fromEntries(
      Object.entries(value).flatMap(([key, generations]) => {
        const normalizedKey = key.trim()
        const normalizedGenerations = normalizeDeletedGenerations(generations)
        return normalizedKey === '' || normalizedGenerations.length === 0
          ? []
          : [[normalizedKey, normalizedGenerations] as const]
      })
    )
    : {}
)

export const addAdapterAccountTombstone = (
  tombstones: Record<string, string[]>,
  accountKey: string,
  generation: string
) => ({
  ...tombstones,
  [accountKey]: [...new Set([...(tombstones[accountKey] ?? []), generation])]
})

export const isAdapterAccountGenerationDeleted = (
  tombstones: Record<string, string[]>,
  accountKey: string,
  generation: unknown
) => {
  const normalizedGeneration = typeof generation === 'string' && generation.trim() !== ''
    ? generation.trim()
    : `legacy:${accountKey}`
  return tombstones[accountKey]?.includes(normalizedGeneration) === true
}

export const createAdapterAccountGeneration = () => randomUUID()

export const createAdapterCredentialRevision = (previous: unknown) => {
  const previousCounter = parseCredentialRevision(previous)?.counter ?? 0
  if (previousCounter === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('Adapter credential revision counter overflowed Number.MAX_SAFE_INTEGER.')
  }
  const counter = previousCounter + 1
  return `${counter}:${randomUUID()}`
}

export const compareAdapterCredentialRevisions = compareCredentialRevisions

export const filterActiveAdapterAccounts = <T extends object>(
  accounts: Record<string, T>,
  tombstones: Record<string, string[]>
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(accounts).filter(([key, account]) =>
      !isAdapterAccountGenerationDeleted(
        tombstones,
        key,
        (account as { generation?: unknown }).generation
      )
    )
  )
