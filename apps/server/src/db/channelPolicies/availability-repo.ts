import type { SqliteDatabase } from '../sqlite'

export interface ChannelAvailabilityOverrideRow {
  channelLinkName: string
  enabled: boolean
  updatedBy: string
  updatedAt: number
}

interface ChannelAvailabilityOverrideDbRow extends Omit<ChannelAvailabilityOverrideRow, 'enabled'> {
  enabled: number
}

const mapRow = (row: ChannelAvailabilityOverrideDbRow | undefined): ChannelAvailabilityOverrideRow | undefined => (
  row == null ? undefined : { ...row, enabled: row.enabled !== 0 }
)

export function createAvailabilityOverridesRepo(db: SqliteDatabase) {
  const get = (channelLinkName: string) =>
    mapRow(
      db.prepare(`
    SELECT channelLinkName, enabled, updatedBy, updatedAt
    FROM channel_availability_overrides WHERE channelLinkName = ?
  `).get<ChannelAvailabilityOverrideDbRow>(channelLinkName)
    )

  const set = (input: { channelLinkName: string; enabled: boolean; updatedBy: string; updatedAt?: number }) => {
    db.prepare(`
      INSERT INTO channel_availability_overrides (channelLinkName, enabled, updatedBy, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channelLinkName) DO UPDATE SET
        enabled = excluded.enabled, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt
    `).run(input.channelLinkName, input.enabled ? 1 : 0, input.updatedBy, input.updatedAt ?? Date.now())
    return get(input.channelLinkName)!
  }

  return { get, set }
}
