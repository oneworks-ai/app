const { AsyncLocalStorage } = require('node:async_hooks')
const { randomUUID } = require('node:crypto')

const visibleOperations = new Set(['click', 'press_key', 'scroll', 'select', 'type'])

module.exports = function createBrowserDriverAgentLifecycle(release) {
  const driverInstanceId = randomUUID()
  const requestStorage = new AsyncLocalStorage()
  const requests = new Map()

  const withRequest = async (context, task) => {
    if (context?.requestId == null) return await task()
    const requestId = String(context.requestId)
    const state = { operationIds: new Set(), requestId, signal: context.signal }
    requests.set(requestId, state)
    return await requestStorage.run(state, async () => {
      try {
        return await task()
      } finally {
        if (requests.get(requestId) === state) requests.delete(requestId)
      }
    })
  }

  const decorateOperation = (op, args) => {
    if (!visibleOperations.has(op)) return args
    const operationId = `agent_${randomUUID().replaceAll('-', '')}`
    requestStorage.getStore()?.operationIds.add(operationId)
    return { ...args, agent_operation_id: operationId }
  }

  const cancelRequest = async requestId => {
    const state = requests.get(String(requestId))
    if (state == null) return { ok: true, restored_pages: 0 }
    const results = await Promise.allSettled(
      [...state.operationIds].map(async operationId => await release(operationId))
    )
    return {
      ok: true,
      restored_pages: results.reduce(
        (total, result) => total + (result.status === 'fulfilled' ? Number(result.value?.restored_pages) || 0 : 0),
        0
      )
    }
  }

  return {
    cancelRequest,
    decorateOperation,
    driverInstanceId,
    releaseAll: async () => await release(),
    requestSignal: () => requestStorage.getStore()?.signal,
    withRequest
  }
}
