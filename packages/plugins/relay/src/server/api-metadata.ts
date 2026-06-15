export const relayApiDocumentation = {
  title: {
    en: 'Account scoped API',
    'zh-Hans': '账号作用域 API'
  },
  description: {
    en:
      'Controls relay device status, login URL generation, login callback registration, connect, config refresh, config source toggles, safe config share draft previews, team config targets and publishing, disconnect, and token removal.',
    'zh-Hans':
      '用于查询认证链接设备状态、生成登录地址、消费登录回调、连接、刷新配置、配置来源启停、安全配置分享草稿预览、团队配置目标和发布、断开连接和移除令牌。'
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
