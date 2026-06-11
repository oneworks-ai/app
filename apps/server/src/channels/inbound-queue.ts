import type { ChannelInboundEvent } from '@oneworks/core/channel'

const inboundQueues = new Map<string, Promise<void>>()

const buildInboundQueueKey = (channelKey: string, inbound: ChannelInboundEvent) =>
  [
    channelKey,
    inbound.channelType,
    inbound.sessionType,
    inbound.channelId
  ].join('\0')

export const enqueueChannelInboundEvent = async <T>(
  channelKey: string,
  inbound: ChannelInboundEvent,
  task: () => Promise<T> | T
): Promise<T> => {
  const queueKey = buildInboundQueueKey(channelKey, inbound)
  const previous = inboundQueues.get(queueKey) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(task)
  const marker = current.then(
    () => undefined,
    () => undefined
  )
  inboundQueues.set(queueKey, marker)

  try {
    return await current
  } finally {
    if (inboundQueues.get(queueKey) === marker) {
      inboundQueues.delete(queueKey)
    }
  }
}
