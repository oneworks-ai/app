import type { ChannelPendingIntentRow } from '#~/db/index.js'
import type { ChannelRuntimeContext } from '#~/services/session/channel-context.js'

import type { ChannelResumePayload } from './types.js'

export const buildResumeChannelContext = (
  intent: ChannelPendingIntentRow,
  resume: ChannelResumePayload,
  childRunId: string
): ChannelRuntimeContext => ({
  actorAccountId: intent.ownerAccountId ?? undefined,
  actorUserId: intent.ownerUserId ?? undefined,
  channelId: intent.channelId ?? undefined,
  channelKey: intent.channelKey ?? undefined,
  channelLinkName: intent.channelLinkName ?? undefined,
  channelType: intent.channelType,
  childRunId,
  conversationStateId: intent.conversationStateId ?? undefined,
  entity: intent.entity ?? undefined,
  senderId: intent.ownerAccountId ?? undefined,
  sessionId: resume.sessionId,
  sessionType: intent.sessionType ?? undefined,
  threadKey: intent.threadKey
})

export const buildChannelResumeRuntimeContent = (intent: ChannelPendingIntentRow, resume: ChannelResumePayload) =>
  [
    '<channel-authorization-resume>',
    `authorizationRequestId: ${resume.authorizationRequestId}`,
    `authorizationStatus: ${resume.authorizationStatus ?? 'unknown'}`,
    `capability: ${resume.capability ?? intent.payload?.capability ?? 'unknown'}`,
    `pendingIntentId: ${intent.id}`,
    `threadKey: ${resume.threadKey ?? intent.threadKey}`,
    `originalChildRunId: ${resume.createdByChildRunId ?? intent.createdByChildRunId ?? 'unknown'}`,
    '请继续之前因为该权限请求暂停的工作。',
    '如果授权已批准，请重试被拦截的操作；如果授权被拒绝，请收敛任务并给出安全替代方案。',
    '外部可见回复仍必须使用 channel send 工具，不要把这段恢复上下文直接发到群里。',
    '</channel-authorization-resume>'
  ].join('\n')

export const buildResumeUserContent = (resume: ChannelResumePayload) => (
  `频道授权请求 ${resume.authorizationRequestId} 已处理：${
    resume.authorizationStatus ?? 'unknown'
  }。请继续刚才被权限拦截的工作。`
)
