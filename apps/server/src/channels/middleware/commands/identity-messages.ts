import { defineMessages } from '../i18n'

defineMessages('zh', {
  'cmd.identity.description': '管理当前发送者的频道身份绑定',
  'cmd.identity.whoami.description': '查看当前身份、账号绑定与凭证状态',
  'cmd.identity.link.description': '生成或消费跨频道身份绑定码',
  'cmd.identity.accounts.description': '查看当前统一用户绑定的频道账号',
  'identity.senderMissing': '无法识别当前发送者，不能处理身份绑定。',
  'identity.link.directOnly': '身份绑定码只能在私聊中生成或使用，请私聊机器人后重试。',
  'identity.link.created': ({ code, minutes, userId }) =>
    `身份绑定码：${code}\n${minutes} 分钟内在另一个频道账号发送 /identity link ${code}，即可绑定到统一用户 ${userId}。`,
  'identity.link.note': '注意：这只绑定身份和记忆归属，不授予该账号的 API 登录态或个人权限。',
  'identity.link.consumed': ({ userId }) => `已把当前频道账号绑定到统一用户 ${userId}。`,
  'identity.link.alreadyLinked': ({ userId }) => `当前频道账号已经绑定到统一用户 ${userId}，无需重复绑定。`,
  'identity.link.conflict': ({ userId }) =>
    `当前频道账号已绑定到另一个统一用户 ${userId}，为避免误合并，请联系管理员处理。`,
  'identity.link.expired': '这个身份绑定码已过期，请在原账号重新生成。',
  'identity.link.notActive': '这个身份绑定码已经被使用或停用，请重新生成。',
  'identity.link.notFound': '未找到这个身份绑定码，请检查是否输入正确。',
  'identity.accounts.unlinked':
    '当前频道账号尚未绑定统一用户。先发送 /identity link 生成身份，或消费另一个账号生成的绑定码。',
  'identity.accounts.empty': '当前统一用户还没有绑定频道账号。',
  'identity.accounts.header': ({ userId, count }) => `统一用户 ${userId} 已绑定 ${count} 个频道账号：`
})

defineMessages('en', {
  'cmd.identity.description': 'Manage identity links for the current sender',
  'cmd.identity.whoami.description': 'Show current identity, account link, and credential state',
  'cmd.identity.link.description': 'Create or consume a cross-channel identity link code',
  'cmd.identity.accounts.description': 'List channel accounts linked to the current canonical user',
  'identity.senderMissing': 'Cannot identify the current sender, so identity linking cannot continue.',
  'identity.link.directOnly': 'Identity link codes can only be created or used in a direct chat. DM the bot and retry.',
  'identity.link.created': ({ code, minutes, userId }) =>
    `Identity link code: ${code}\nSend /identity link ${code} from another channel account within ${minutes} minutes to link it to canonical user ${userId}.`,
  'identity.link.note':
    'Note: this only links identity and memory ownership; it does not grant API login state or personal permissions.',
  'identity.link.consumed': ({ userId }) => `Current channel account is now linked to canonical user ${userId}.`,
  'identity.link.alreadyLinked': ({ userId }) =>
    `Current channel account is already linked to canonical user ${userId}; nothing changed.`,
  'identity.link.conflict': ({ userId }) =>
    `Current channel account is already linked to another canonical user ${userId}. Ask an admin to resolve the merge.`,
  'identity.link.expired': 'This identity link code has expired. Generate a new one from the source account.',
  'identity.link.notActive': 'This identity link code has already been used or disabled. Generate a new one.',
  'identity.link.notFound': 'This identity link code was not found. Check the code and try again.',
  'identity.accounts.unlinked':
    'Current channel account is not linked to a canonical user. Send /identity link to create one, or consume a code from another account.',
  'identity.accounts.empty': 'No channel accounts are linked to the current canonical user.',
  'identity.accounts.header': ({ userId, count }) => `Canonical user ${userId} has ${count} linked channel account(s):`
})
