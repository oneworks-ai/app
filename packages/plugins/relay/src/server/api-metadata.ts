export const relayApiDocumentation = {
  title: {
    en: 'Account scoped API',
    'zh-Hans': '账号作用域 API'
  },
  description: {
    en:
      'Controls relay device status, login URL generation, login callback registration, connect, config refresh, disconnect, and token removal.',
    'zh-Hans': '用于查询认证链接设备状态、生成登录地址、消费登录回调、连接、刷新配置、断开连接和移除令牌。'
  },
  headerSchema: {
    type: 'object',
    additionalProperties: {
      type: 'string'
    }
  },
  inputSchema: {
    type: 'object',
    additionalProperties: true
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true
  }
}
