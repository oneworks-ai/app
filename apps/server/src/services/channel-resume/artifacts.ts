import { createHash } from 'node:crypto'

import type { ChannelPendingIntentRow } from '#~/db/index.js'

export const buildResumeArtifactId = (kind: 'run' | 'session' | 'turn', intentId: string) =>
  `channel_resume_${kind}_${createHash('sha256').update(intentId).digest('hex').slice(0, 32)}`

export const hasResumeDispatchFields = (intent: ChannelPendingIntentRow) => (
  intent.channelKey != null && intent.channelKey.trim() !== '' &&
  intent.channelId != null && intent.channelId.trim() !== '' &&
  intent.conversationStateId != null && intent.conversationStateId.trim() !== '' &&
  intent.sessionType != null && intent.sessionType.trim() !== ''
)
