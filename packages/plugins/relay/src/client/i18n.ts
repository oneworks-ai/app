/* eslint-disable max-lines -- relay client messages stay colocated for plugin and session group UI. */
export type RelayClientLocale = 'en' | 'zh-Hans'

export interface RelayClientMessages {
  actions: {
    cancelServer: string
    connect: string
    configSourceDisableProfile: string
    configSourceDisableTeam: string
    configSourceEnableProfile: string
    configSourceEnableTeam: string
    configSourceUpdated: string
    disconnect: string
    editServer: string
    forgetToken: string
    login: string
    refresh: string
    refreshConfig: string
    shareLoadTargets: string
    sharePreview: string
    sharePublish: string
    sharePublished: string
    saveServer: string
    serverSaved: string
  }
  aria: {
    moreDeviceActions: string
    serviceActions: string
  }
  configDistribution: {
    empty: string
    emptyDescription: string
    failed: string
    labels: {
      allowedFields: string
      hash: string
      lastAppliedAt: string
      lastError: string
      lastSyncedAt: string
      matchedProject: string
      marketplaces: string
      modelServices: string
      plugins: string
      skillRegistries: string
      skills: string
      sourceServer: string
      sources: string
      version: string
    }
    sourceDisabled: string
    sourceEnabled: string
    matched: string
    notMatched: string
    synced: string
    title: string
    unknown: string
  }
  devices: {
    count: (count: number) => string
    empty: string
    error: string
    features: {
      sessions: string
      terminal: string
      workspaceFiles: string
    }
    label: string
    local: string
    status: Record<string, string>
  }
  emptyAccounts: string
  emptyServers: string
  errors: {
    shareConfigInvalid: string
    shareTeamRequired: string
    loginUrlMissing: string
    optionsUpdateUnavailable: string
    relayActionFailed: (action: string, status: number) => string
    serverUrlInvalid: string
    statusRequestFailed: (status: number) => string
  }
  inputs: {
    shareConfig: string
    shareProfileName: string
    shareTeam: string
    serverName: string
    serverUrl: string
  }
  share: {
    draftReady: string
    emptyDraft: string
    labels: {
      fields: string
      issues: string
      rejected: string
      secrets: string
    }
    loginRequired: string
    noTeams: string
    pendingSecrets: (count: number) => string
    title: string
  }
  labels: {
    account: string
    device: string
    deviceId: string
    email: string
    no: string
    notSignedIn: string
    platform: string
    remote: string
    status: string
    token: string
    yes: string
  }
  launcher: {
    statusTitle: string
  }
  service: {
    active: string
    noToken: string
    registered: (registeredAt: string) => string
    tokenStored: string
  }
  sessionGroups: {
    createSession: string
  }
  status: Record<string, string>
}

export interface RelayClientI18nHost {
  select: <T>(values: Partial<Record<string, T>>, fallbackLanguage?: string) => T | undefined
}

const relayClientMessages: Record<RelayClientLocale, RelayClientMessages> = {
  en: {
    actions: {
      cancelServer: 'Cancel',
      connect: 'Connect',
      configSourceDisableProfile: 'Disable profile on this device',
      configSourceDisableTeam: 'Disable team on this device',
      configSourceEnableProfile: 'Enable profile on this device',
      configSourceEnableTeam: 'Enable team on this device',
      configSourceUpdated: 'Relay config source updated.',
      disconnect: 'Disconnect',
      editServer: 'Edit server',
      forgetToken: 'Forget token',
      login: 'Login',
      refresh: 'Refresh',
      refreshConfig: 'Refresh Relay configuration',
      shareLoadTargets: 'Load teams',
      sharePreview: 'Preview share',
      sharePublish: 'Publish share',
      sharePublished: 'Relay config share published.',
      saveServer: 'Save',
      serverSaved: 'Relay server saved.'
    },
    aria: {
      moreDeviceActions: 'More device actions',
      serviceActions: 'Service actions'
    },
    configDistribution: {
      empty: 'not received',
      emptyDescription: 'No Relay configuration received yet.',
      failed: 'Sync failed',
      labels: {
        allowedFields: 'Allowed fields',
        hash: 'Hash',
        lastAppliedAt: 'Last applied',
        lastError: 'Last error',
        lastSyncedAt: 'Last synced',
        matchedProject: 'Project match',
        marketplaces: 'Marketplaces',
        modelServices: 'Model services',
        plugins: 'Plugins',
        skillRegistries: 'Skill registries',
        skills: 'Skills',
        sourceServer: 'Source server',
        sources: 'Sources',
        version: 'Version'
      },
      sourceDisabled: 'disabled locally',
      sourceEnabled: 'enabled',
      matched: 'matched',
      notMatched: 'not matched',
      synced: 'synced',
      title: 'Relay configuration',
      unknown: 'unknown'
    },
    devices: {
      count: count => `${count} ${count === 1 ? 'device' : 'devices'}`,
      empty: 'No devices connected.',
      error: 'Devices unavailable.',
      features: {
        sessions: 'sessions',
        terminal: 'terminal',
        workspaceFiles: 'files'
      },
      label: 'Devices',
      local: 'This device',
      status: {
        offline: 'offline',
        online: 'online',
        stale: 'stale'
      }
    },
    emptyAccounts: 'No SSO accounts connected.',
    emptyServers: 'No relay servers configured.',
    errors: {
      shareConfigInvalid: 'Enter valid JSON before previewing or publishing.',
      shareTeamRequired: 'Choose a team before publishing.',
      loginUrlMissing: 'Relay login URL was not returned.',
      optionsUpdateUnavailable: 'Plugin options update is unavailable.',
      relayActionFailed: (action, status) => `Relay ${action} failed with ${status}`,
      serverUrlInvalid: 'Enter a valid http or https API URL.',
      statusRequestFailed: status => `Status request failed with ${status}`
    },
    inputs: {
      shareConfig: 'Config JSON',
      shareProfileName: 'Profile name',
      shareTeam: 'Team',
      serverName: 'Server name',
      serverUrl: 'Server API URL'
    },
    labels: {
      account: 'Account',
      device: 'Device',
      deviceId: 'Device ID',
      email: 'Email',
      no: 'no',
      notSignedIn: 'Not signed in',
      platform: 'Platform',
      remote: 'Remote',
      status: 'Status',
      token: 'Token',
      yes: 'yes'
    },
    launcher: {
      statusTitle: 'Account status'
    },
    service: {
      active: 'active',
      noToken: 'no token',
      registered: registeredAt => `registered ${registeredAt}`,
      tokenStored: 'token stored'
    },
    share: {
      draftReady: 'draft ready',
      emptyDraft: 'no draft',
      labels: {
        fields: 'Fields',
        issues: 'Issues',
        rejected: 'Rejected',
        secrets: 'Secrets'
      },
      loginRequired: 'Login is required for team publishing.',
      noTeams: 'No writable teams loaded.',
      pendingSecrets: count => `${count} secret ${count === 1 ? 'field' : 'fields'}`,
      title: 'Team config share'
    },
    sessionGroups: {
      createSession: 'New session from this connection'
    },
    status: {
      connected: 'connected',
      connecting: 'connecting',
      error: 'error',
      idle: 'idle',
      loading: 'loading',
      registered: 'registered'
    }
  },
  'zh-Hans': {
    actions: {
      cancelServer: '取消',
      connect: '连接',
      configSourceDisableProfile: '在本机禁用该 profile',
      configSourceDisableTeam: '在本机禁用该团队',
      configSourceEnableProfile: '在本机启用该 profile',
      configSourceEnableTeam: '在本机启用该团队',
      configSourceUpdated: 'Relay 配置来源已更新。',
      disconnect: '断开连接',
      editServer: '编辑服务',
      forgetToken: '忘记令牌',
      login: '登录',
      refresh: '刷新',
      refreshConfig: '刷新 Relay 配置',
      shareLoadTargets: '加载团队',
      sharePreview: '预览分享',
      sharePublish: '发布分享',
      sharePublished: 'Relay 配置分享已发布。',
      saveServer: '保存',
      serverSaved: '认证服务已保存。'
    },
    aria: {
      moreDeviceActions: '更多设备操作',
      serviceActions: '服务操作'
    },
    configDistribution: {
      empty: '未收到',
      emptyDescription: '还没有收到 Relay 配置。',
      failed: '同步失败',
      labels: {
        allowedFields: '允许字段',
        hash: '哈希',
        lastAppliedAt: '最后应用',
        lastError: '最后错误',
        lastSyncedAt: '最后同步',
        matchedProject: '项目命中',
        marketplaces: '市场',
        modelServices: '模型服务',
        plugins: '插件',
        skillRegistries: 'Skill registries',
        skills: 'Skills',
        sourceServer: '来源服务',
        sources: '来源',
        version: '版本'
      },
      sourceDisabled: '本机已禁用',
      sourceEnabled: '已启用',
      matched: '已命中',
      notMatched: '未命中',
      synced: '已同步',
      title: 'Relay 配置',
      unknown: '未知'
    },
    devices: {
      count: count => `${count} 台设备`,
      empty: '暂无设备',
      error: '设备暂不可用',
      features: {
        sessions: '会话',
        terminal: '终端',
        workspaceFiles: '文件'
      },
      label: '设备',
      local: '本机',
      status: {
        offline: '离线',
        online: '在线',
        stale: '离线较久'
      }
    },
    emptyAccounts: '还没有连接 SSO 登录账号。',
    emptyServers: '还没有配置认证链接服务。',
    errors: {
      shareConfigInvalid: '请先输入有效 JSON。',
      shareTeamRequired: '发布前请选择团队。',
      loginUrlMissing: '没有返回 Relay 登录地址。',
      optionsUpdateUnavailable: '当前宿主不支持更新插件配置。',
      relayActionFailed: (action, status) => `Relay ${action} 失败，状态码 ${status}`,
      serverUrlInvalid: '请输入有效的 http 或 https API 地址。',
      statusRequestFailed: status => `状态请求失败，状态码 ${status}`
    },
    inputs: {
      shareConfig: '配置 JSON',
      shareProfileName: 'Profile 名称',
      shareTeam: '团队',
      serverName: '服务名称',
      serverUrl: '服务 API 地址'
    },
    labels: {
      account: '账号',
      device: '设备',
      deviceId: '设备 ID',
      email: '邮箱',
      no: '否',
      notSignedIn: '未登录',
      platform: '平台',
      remote: '远端',
      status: '状态',
      token: '令牌',
      yes: '是'
    },
    launcher: {
      statusTitle: '账号状态'
    },
    service: {
      active: '当前',
      noToken: '未保存令牌',
      registered: registeredAt => `已注册 ${registeredAt}`,
      tokenStored: '已保存令牌'
    },
    share: {
      draftReady: '草稿就绪',
      emptyDraft: '暂无草稿',
      labels: {
        fields: '字段',
        issues: '问题',
        rejected: '已拒绝',
        secrets: '密钥'
      },
      loginRequired: '发布到团队前需要登录。',
      noTeams: '还没有加载可写团队。',
      pendingSecrets: count => `${count} 个密钥字段`,
      title: '团队配置分享'
    },
    sessionGroups: {
      createSession: '基于此连接新建会话'
    },
    status: {
      connected: '已连接',
      connecting: '连接中',
      error: '错误',
      idle: '空闲',
      loading: '加载中',
      registered: '已注册'
    }
  }
}

export const relayClientLauncherStatusTitleI18n = {
  en: relayClientMessages.en.launcher.statusTitle,
  'zh-Hans': relayClientMessages['zh-Hans'].launcher.statusTitle
}

export const relayClientSessionGroupCreateTitleI18n = {
  en: relayClientMessages.en.sessionGroups.createSession,
  'zh-Hans': relayClientMessages['zh-Hans'].sessionGroups.createSession
}

export const createRelayClientI18n = (i18n?: RelayClientI18nHost) =>
  i18n?.select(relayClientMessages, 'en') ?? relayClientMessages.en
