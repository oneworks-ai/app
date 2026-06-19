interface ChiiTargetRecord {
  favicon?: string | null
  id?: string
  ip?: string | null
  rtc?: boolean
  title?: string | null
  url?: string | null
  userAgent?: string | null
  ws?: {
    readyState?: number
  }
}

export interface ChiiChannelManager {
  getTargets: () => Record<string, ChiiTargetRecord>
}

export const buildChiiTargetsResponse = (channelManager: ChiiChannelManager) => ({
  targets: Object.entries(channelManager.getTargets())
    .reverse()
    .map(([id, target]) => ({
      favicon: target.favicon ?? null,
      id: target.id ?? id,
      ip: target.ip ?? null,
      rtc: target.rtc === true,
      title: target.title ?? null,
      url: target.url ?? null,
      userAgent: target.userAgent ?? null
    }))
})
