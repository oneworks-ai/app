import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import type { ChannelIdentityLinkInput, ChannelIdentityLinkRow } from './account-record'
import { stringifyJson } from './json'
import { mapIdentityLinkCodeRow } from './link-code-record'
import type {
  ChannelIdentityLinkCodeConsumeResult,
  ChannelIdentityLinkCodeDbRow,
  IdentityLinkCodeConsumeInput,
  IdentityLinkCodeInput,
  IdentityLinkCodeUpdates
} from './link-code-record'

interface ChannelAccountLinksRepo {
  getIdentityLink(channelType: string, accountId: string): ChannelIdentityLinkRow | undefined
  linkAccountToUser(row: ChannelIdentityLinkInput): ChannelIdentityLinkRow | undefined
}

export function createIdentityLinkCodesRepo(db: SqliteDatabase, accounts: ChannelAccountLinksRepo) {
  const getIdentityLinkCode = (code: string) => {
    const stmt = db.prepare(`
      SELECT code, userId, sourceChannelType, sourceAccountId, status, createdAt, expiresAt,
             consumedAt, consumedChannelType, consumedAccountId, metadataJson
      FROM channel_identity_link_codes
      WHERE code = ?
    `)
    return mapIdentityLinkCodeRow(stmt.get<ChannelIdentityLinkCodeDbRow>(code))
  }

  const createIdentityLinkCode = (row: IdentityLinkCodeInput) => {
    const now = Date.now()
    const code = row.code?.trim() || randomUUID().replaceAll('-', '').slice(0, 12)
    const stmt = db.prepare(`
      INSERT INTO channel_identity_link_codes (
        code, userId, sourceChannelType, sourceAccountId, status, createdAt, expiresAt,
        consumedAt, consumedChannelType, consumedAccountId, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      code,
      row.userId,
      row.sourceChannelType,
      row.sourceAccountId,
      'active',
      now,
      row.expiresAt,
      null,
      null,
      null,
      stringifyJson(row.metadata)
    )
    return getIdentityLinkCode(code)
  }

  const markIdentityLinkCode = (code: string, updates: IdentityLinkCodeUpdates) => {
    const stmt = db.prepare(`
      UPDATE channel_identity_link_codes
      SET status = ?, consumedAt = ?, consumedChannelType = ?, consumedAccountId = ?
      WHERE code = ?
    `)
    stmt.run(
      updates.status,
      updates.consumedAt ?? null,
      updates.consumedChannelType ?? null,
      updates.consumedAccountId ?? null,
      code
    )
    return getIdentityLinkCode(code)
  }

  const consumeIdentityLinkCode = db.transaction((
    input: IdentityLinkCodeConsumeInput
  ): ChannelIdentityLinkCodeConsumeResult => {
    const code = getIdentityLinkCode(input.code)
    if (code == null) {
      return { status: 'not_found' }
    }

    if (code.status !== 'active') {
      return { code, status: 'not_active' }
    }

    if (code.expiresAt <= Date.now()) {
      const expired = markIdentityLinkCode(code.code, { status: 'expired' })
      return { code: expired, status: 'expired' }
    }

    const existingLink = accounts.getIdentityLink(input.targetChannelType, input.targetAccountId)
    if (existingLink?.status === 'verified') {
      return existingLink.userId === code.userId
        ? { code, existingLink, status: 'already_linked' }
        : { code, existingLink, status: 'conflict' }
    }

    const link = accounts.linkAccountToUser({
      channelType: input.targetChannelType,
      accountId: input.targetAccountId,
      userId: code.userId,
      source: 'link_code',
      status: 'verified'
    })
    const consumed = markIdentityLinkCode(code.code, {
      consumedAccountId: input.targetAccountId,
      consumedAt: Date.now(),
      consumedChannelType: input.targetChannelType,
      status: 'consumed'
    })
    return {
      code: consumed,
      link,
      status: 'consumed'
    }
  })

  return {
    consumeIdentityLinkCode,
    createIdentityLinkCode,
    getIdentityLinkCode
  }
}
