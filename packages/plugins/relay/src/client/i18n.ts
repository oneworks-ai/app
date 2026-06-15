/* eslint-disable max-lines -- relay client messages stay colocated for plugin and session group UI. */
export type RelayClientLocale = 'en' | 'zh-Hans'

export interface RelayClientMessages {
  actions: {
    cancelServer: string
    connect: string
    disconnect: string
    editServer: string
    forgetToken: string
    login: string
    refresh: string
    refreshConfig: string
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
      modelServices: string
      sourceServer: string
      version: string
    }
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
    loginUrlMissing: string
    optionsUpdateUnavailable: string
    relayActionFailed: (action: string, status: number) => string
    serverUrlInvalid: string
    statusRequestFailed: (status: number) => string
  }
  inputs: {
    serverName: string
    serverUrl: string
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
      disconnect: 'Disconnect',
      editServer: 'Edit server',
      forgetToken: 'Forget token',
      login: 'Login',
      refresh: 'Refresh',
      refreshConfig: 'Refresh Relay configuration',
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
        modelServices: 'Model services',
        sourceServer: 'Source server',
        version: 'Version'
      },
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
      loginUrlMissing: 'Relay login URL was not returned.',
      optionsUpdateUnavailable: 'Plugin options update is unavailable.',
      relayActionFailed: (action, status) => `Relay ${action} failed with ${status}`,
      serverUrlInvalid: 'Enter a valid http or https API URL.',
      statusRequestFailed: status => `Status request failed with ${status}`
    },
    inputs: {
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
      disconnect: '断开连接',
      editServer: '编辑服务',
      forgetToken: '忘记令牌',
      login: '登录',
      refresh: '刷新',
      refreshConfig: '刷新 Relay 配置',
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
        modelServices: '模型服务',
        sourceServer: '来源服务',
        version: '版本'
      },
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
      loginUrlMissing: '没有返回 Relay 登录地址。',
      optionsUpdateUnavailable: '当前宿主不支持更新插件配置。',
      relayActionFailed: (action, status) => `Relay ${action} 失败，状态码 ${status}`,
      serverUrlInvalid: '请输入有效的 http 或 https API 地址。',
      statusRequestFailed: status => `状态请求失败，状态码 ${status}`
    },
    inputs: {
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
