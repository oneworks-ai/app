import { createHash } from 'node:crypto'

import type { ChannelDeliveryTarget, ChannelNavigationReference } from '@oneworks/types'

import type { SqliteDatabase } from '../sqlite'

export interface ChannelOutboundDeliveryRow {
  channelKey: string
  channelType: string
  createdAt: number
  id: string
  messageId: string
  receiveId: string
  receiveIdType: string
  text: string
  updatedAt: number | null
}

export interface ChannelOutboundDeliveryInput {
  channelKey: string
  channelType: string
  createdAt: number
  messageId: string
  receiveId: string
  receiveIdType: string
  text: string
  updatedAt?: number
}

export type ChannelOutboundOperationStatus = 'failed' | 'pending' | 'sent'

interface ChannelOutboundOperationDbRow {
  channelKey: string
  channelType: string
  commandRunId: string | null
  createdAt: number
  error: string | null
  navigationJson: string | null
  operationId: string
  payloadHash: string
  providerMessageId: string | null
  status: ChannelOutboundOperationStatus
  targetJson: string
  updatedAt: number
}

export interface ChannelOutboundOperationRow
  extends Omit<ChannelOutboundOperationDbRow, 'navigationJson' | 'targetJson'>
{
  navigation: ChannelNavigationReference | null
  target: ChannelDeliveryTarget
}

export interface ChannelOutboundOperationClaim {
  channelKey: string
  channelType: string
  commandRunId?: string
  operationId: string
  payloadHash: string
  target: ChannelDeliveryTarget
}

const parseObject = <Value extends object>(value: string | null): Value | null => {
  if (value == null) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Value : null
  } catch {
    return null
  }
}

const mapOperation = (row: ChannelOutboundOperationDbRow | undefined): ChannelOutboundOperationRow | undefined => {
  if (row == null) return undefined
  const target = parseObject<ChannelDeliveryTarget>(row.targetJson)
  if (target == null) return undefined
  const { navigationJson, targetJson: _targetJson, ...stored } = row
  return {
    ...stored,
    navigation: parseObject<ChannelNavigationReference>(navigationJson),
    target
  }
}

const createId = (input: Pick<ChannelOutboundDeliveryInput, 'channelKey' | 'channelType' | 'messageId'>) =>
  `channel_outbound_${
    createHash('sha256')
      .update([input.channelType, input.channelKey, input.messageId].join('\0'))
      .digest('hex')
      .slice(0, 32)
  }`

export function createChannelOutboundDeliveriesRepo(db: SqliteDatabase) {
  const getOperation = (operationId: string) =>
    mapOperation(
      db.prepare('SELECT * FROM channel_outbound_operations WHERE operationId = ?')
        .get<ChannelOutboundOperationDbRow>(operationId)
    )

  const claimOperation = (input: ChannelOutboundOperationClaim) => {
    const timestamp = Date.now()
    const result = db.prepare(`
      INSERT OR IGNORE INTO channel_outbound_operations (
        operationId, commandRunId, channelType, channelKey, targetJson, payloadHash,
        status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      input.operationId,
      input.commandRunId ?? null,
      input.channelType,
      input.channelKey,
      JSON.stringify(input.target),
      input.payloadHash,
      timestamp,
      timestamp
    )
    return { claimed: result.changes > 0, operation: getOperation(input.operationId)! }
  }

  const finishOperation = (
    operationId: string,
    input: {
      error?: string
      navigation?: ChannelNavigationReference
      providerMessageId?: string
      status: Exclude<ChannelOutboundOperationStatus, 'pending'>
    }
  ) => {
    db.prepare(`
      UPDATE channel_outbound_operations
      SET status = ?, providerMessageId = ?, navigationJson = ?, error = ?, updatedAt = ?
      WHERE operationId = ? AND status = 'pending'
    `).run(
      input.status,
      input.providerMessageId ?? null,
      input.navigation == null ? null : JSON.stringify(input.navigation),
      input.error ?? null,
      Date.now(),
      operationId
    )
    return getOperation(operationId)
  }

  const upsert = (input: ChannelOutboundDeliveryInput) => {
    const id = createId(input)
    db.prepare(`
      INSERT INTO channel_outbound_deliveries (
        id, channelType, channelKey, messageId, receiveId, receiveIdType, text, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        receiveId = excluded.receiveId,
        receiveIdType = excluded.receiveIdType,
        text = excluded.text,
        updatedAt = excluded.updatedAt
    `).run(
      id,
      input.channelType,
      input.channelKey,
      input.messageId,
      input.receiveId,
      input.receiveIdType,
      input.text,
      input.createdAt,
      input.updatedAt ?? null
    )
    return db.prepare(`SELECT * FROM channel_outbound_deliveries WHERE id = ?`)
      .get<ChannelOutboundDeliveryRow>(id)
  }

  const listRecent = (channelType: string, limit = 50) =>
    db.prepare(`
      SELECT * FROM channel_outbound_deliveries
      WHERE channelType = ?
      ORDER BY COALESCE(updatedAt, createdAt) DESC
      LIMIT ?
    `).all<ChannelOutboundDeliveryRow>(channelType, Math.max(1, Math.min(limit, 200)))

  return { claimOperation, finishOperation, getOperation, listRecent, upsert }
}
