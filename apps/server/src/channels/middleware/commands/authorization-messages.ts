import { defineMessages } from '../i18n'

defineMessages('zh', {
  'cmd.auth.description': '管理频道授权请求',
  'cmd.auth.request.description': '为当前发送者创建一个待授权请求',
  'cmd.auth.list.description': '查看当前发送者的待授权请求',
  'cmd.auth.grant.description': '批准一个待授权请求',
  'cmd.auth.deny.description': '拒绝一个待授权请求',
  'cmd.auth.resume.description': '手动恢复一个已处理的授权请求',
  'auth.senderMissing': '无法识别当前发送者，不能创建授权请求。',
  'auth.request.created': ({ id, capability }) => `已创建授权请求 ${id}：${capability}`,
  'auth.list.empty': '当前没有待处理的授权请求。',
  'auth.list.header': ({ count }) => `待处理授权请求（${count} 个）：`,
  'auth.list.item': ({ index, id, capability, requester, channelLink, message }) =>
    `${index}. ${id} | ${capability} | ${requester} | ${channelLink}${message ? ` | ${message}` : ''}`,
  'auth.resumable.empty': '当前没有可恢复的授权任务。',
  'auth.resumable.header': ({ count }) => `可恢复授权任务（${count} 个）：`,
  'auth.resumable.item': ({ index, id, mode, sessionId, owner, capability }) =>
    `${index}. ${id} | ${mode} | ${capability} | ${owner} | session=${sessionId}`,
  'auth.scope.pending': '待处理',
  'auth.scope.resumable': '可恢复',
  'auth.notFound': ({ id }) => `未找到授权请求 ${id}。`,
  'auth.notResolvable': ({ id }) => `授权请求 ${id} 不属于当前频道、当前审批人，或已经处理。`,
  'auth.resolved': ({ id, status }) => `授权请求 ${id} 已标记为 ${status}。`,
  'auth.resume.empty': ({ id }) => `授权请求 ${id} 当前没有可恢复的会话。`,
  'auth.resume.done': ({ id, count }) => `授权请求 ${id} 已触发 ${count} 个恢复任务。`,
  'auth.status.granted': '已批准',
  'auth.status.denied': '已拒绝'
})

defineMessages('en', {
  'cmd.auth.description': 'Manage channel authorization requests',
  'cmd.auth.request.description': 'Create an authorization request for the current sender',
  'cmd.auth.list.description': 'List pending authorization requests for the current sender',
  'cmd.auth.grant.description': 'Grant an authorization request',
  'cmd.auth.deny.description': 'Deny an authorization request',
  'cmd.auth.resume.description': 'Manually resume a resolved authorization request',
  'auth.senderMissing': 'Cannot identify the current sender, so no authorization request was created.',
  'auth.request.created': ({ id, capability }) => `Authorization request ${id} created: ${capability}`,
  'auth.list.empty': 'There are no pending authorization requests.',
  'auth.list.header': ({ count }) => `Pending authorization requests (${count}):`,
  'auth.list.item': ({ index, id, capability, requester, channelLink, message }) =>
    `${index}. ${id} | ${capability} | ${requester} | ${channelLink}${message ? ` | ${message}` : ''}`,
  'auth.resumable.empty': 'There are no resumable authorization tasks.',
  'auth.resumable.header': ({ count }) => `Resumable authorization tasks (${count}):`,
  'auth.resumable.item': ({ index, id, mode, sessionId, owner, capability }) =>
    `${index}. ${id} | ${mode} | ${capability} | ${owner} | session=${sessionId}`,
  'auth.scope.pending': 'pending',
  'auth.scope.resumable': 'resumable',
  'auth.notFound': ({ id }) => `Authorization request ${id} was not found.`,
  'auth.notResolvable': ({ id }) =>
    `Authorization request ${id} is outside this channel or approver scope, or is already resolved.`,
  'auth.resolved': ({ id, status }) => `Authorization request ${id} marked as ${status}.`,
  'auth.resume.empty': ({ id }) => `Authorization request ${id} has no resumable session right now.`,
  'auth.resume.done': ({ id, count }) => `Authorization request ${id} resumed ${count} pending task(s).`,
  'auth.status.granted': 'granted',
  'auth.status.denied': 'denied'
})
