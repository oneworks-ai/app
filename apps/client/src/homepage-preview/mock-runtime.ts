/* eslint-disable max-lines -- homepage preview runtime keeps mocked sessions, rooms, assets, and transport hooks together. */

import type { ChatMessage, ChatMessageContent, Session, WSEvent } from '@oneworks/core'
import type {
  AgentRoomDetailResponse,
  AgentRoomMessage,
  AgentRoomRun,
  ConfigResponse,
  TerminalSessionCommand,
  TerminalSessionEvent
} from '@oneworks/types'

import type {
  EntityDetail,
  EntitySummary,
  RuleDetail,
  RuleSummary,
  SkillDetail,
  SkillHubInstallResult,
  SkillHubItem,
  SkillHubRegistrySummary,
  SkillHubSearchResult,
  SkillSummary,
  SpecDetail,
  SpecSummary,
  WorkspaceSummary
} from '#~/api.js'
import i18n from '#~/i18n'
import { SERVER_BASE_URL_STORAGE_KEY } from '#~/runtime-config'

import enHomepagePreviewTranslations from './locales/en.json'
import zhHomepagePreviewTranslations from './locales/zh.json'

type HomepagePreviewLocale = 'zh' | 'en'
type HomepagePreviewTheme = 'light' | 'dark' | 'system'
type HomepagePreviewMessageRole = 'user' | 'assistant' | 'system'

interface HomepagePreviewMockMessage {
  id?: string
  role?: HomepagePreviewMessageRole
  content?: string | ChatMessageContent[]
  createdAt?: number
}

interface HomepagePreviewMockData {
  sessionId?: string
  title?: string
  messages?: HomepagePreviewMockMessage[]
}

interface HomepagePreviewConfig {
  downloadUrl: string
  locale: HomepagePreviewLocale
  mockData?: HomepagePreviewMockData
  theme: HomepagePreviewTheme
}

interface HomepagePreviewStore {
  history: Map<string, WSEvent[]>
  nextMessageIndex: number
  rooms: Map<string, AgentRoomDetailResponse>
  nextRoomMessageIndex: number
  sessions: Map<string, Session>
  userInteracted: boolean
}

interface HomepagePreviewRequestResult {
  body: unknown
  status?: number
}

interface MockWorkspaceTreeEntry {
  absolutePath: string
  path: string
  name: string
  type: 'file' | 'directory'
}

const HOMEPAGE_PREVIEW_QUERY = 'owPreview'
const HOMEPAGE_PREVIEW_QUERY_VALUE = 'homepage'
const HOMEPAGE_PREVIEW_MESSAGE = 'oneworks:homepage-preview'
const HOMEPAGE_PREVIEW_SOURCE = 'oneworks-homepage'
const HOMEPAGE_PREVIEW_RUNTIME_STORAGE_KEY = 'oneworks:homepage-preview-runtime'
const DEFAULT_SESSION_ID = 'homepage-preview'
const ROOM_HOST_SESSION_ID = 'homepage-room-host'
const DEFAULT_ROOM_ID = 'homepage-agent-room'
const GITHUB_RELEASES_URL = 'https://github.com/oneworks-ai/app/releases'
const DESKTOP_RELEASE_VERSION = '4.0.0-alpha.13'
const DESKTOP_RELEASE_TAG = `pkg/oneworks-desktop/v${DESKTOP_RELEASE_VERSION}`
const DESKTOP_RELEASE_DOWNLOAD_BASE_URL = `https://github.com/oneworks-ai/app/releases/download/${
  encodeURIComponent(DESKTOP_RELEASE_TAG)
}`
const INITIAL_CONFIG_WAIT_MS = 180
const EMPTY_QUEUE = { steer: [], next: [] }
const HOMEPAGE_PREVIEW_TRANSLATIONS = {
  en: enHomepagePreviewTranslations,
  zh: zhHomepagePreviewTranslations
}

let previewConfig: HomepagePreviewConfig | undefined
let previewStore: HomepagePreviewStore | undefined
let didInstall = false
let downloadUrlConfigured = false
let initialConfigTimer: number | undefined
let initialConfigWait: Promise<void> | undefined
let resolveInitialConfigWait: (() => void) | undefined

const activeSockets = new Set<HomepagePreviewSocket>()

const installHomepagePreviewTranslations = () => {
  for (const [language, resource] of Object.entries(HOMEPAGE_PREVIEW_TRANSLATIONS)) {
    i18n.addResourceBundle(
      language,
      'translation',
      { homepagePreview: resource },
      true,
      true
    )
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeLocale = (value?: unknown): HomepagePreviewLocale => {
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('en')) {
    return 'en'
  }
  return 'zh'
}

const normalizeTheme = (value?: unknown): HomepagePreviewTheme => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value
  }
  return 'system'
}

const getNavigatorPlatformText = () => {
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return [
    userAgentData?.platform,
    navigator.platform,
    navigator.userAgent
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

const buildMacDesktopDownloadUrl = (arch: 'arm64' | 'x64') => (
  `${DESKTOP_RELEASE_DOWNLOAD_BASE_URL}/oneworks-${DESKTOP_RELEASE_VERSION}-mac-${arch}.dmg`
)

const resolveDefaultDownloadUrl = () => {
  const platformText = getNavigatorPlatformText()
  if (platformText.includes('mac')) {
    return buildMacDesktopDownloadUrl('arm64')
  }
  return GITHUB_RELEASES_URL
}

const maybeResolveHighEntropyMacDownloadUrl = async () => {
  const userAgentData = (navigator as Navigator & {
    userAgentData?: {
      getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; platform?: string }>
    }
  }).userAgentData

  if (userAgentData?.getHighEntropyValues == null) {
    return undefined
  }

  const values = await userAgentData.getHighEntropyValues(['architecture', 'platform'])
  const platform = values.platform?.toLowerCase() ?? ''
  if (!platform.includes('mac')) {
    return undefined
  }

  const architecture = values.architecture?.toLowerCase() ?? ''
  return buildMacDesktopDownloadUrl(architecture.includes('x86') || architecture.includes('x64') ? 'x64' : 'arm64')
}

const refineDefaultDownloadUrl = () => {
  if (downloadUrlConfigured) return

  void maybeResolveHighEntropyMacDownloadUrl()
    .then((downloadUrl) => {
      if (downloadUrl == null || downloadUrlConfigured) return
      mergePreviewConfig({ downloadUrl })
    })
    .catch(() => undefined)
}

const normalizeDownloadUrl = (value?: unknown) => {
  if (typeof value !== 'string') return resolveDefaultDownloadUrl()
  const trimmed = value.trim()
  if (trimmed === '') return resolveDefaultDownloadUrl()

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
  } catch {}

  return resolveDefaultDownloadUrl()
}

const normalizeMockMessage = (value: unknown, index: number): HomepagePreviewMockMessage | undefined => {
  if (!isRecord(value)) return undefined
  const role = value.role === 'user' || value.role === 'assistant' || value.role === 'system'
    ? value.role
    : undefined
  if (role == null) return undefined

  const content = typeof value.content === 'string' || Array.isArray(value.content)
    ? value.content
    : undefined
  if (content == null) return undefined

  return {
    id: typeof value.id === 'string' && value.id.trim() !== '' ? value.id : `homepage-seed-${index}`,
    role,
    content,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : undefined
  }
}

const normalizeMockData = (value: unknown): HomepagePreviewMockData | undefined => {
  if (!isRecord(value)) return undefined
  const messages = Array.isArray(value.messages)
    ? value.messages
      .map(normalizeMockMessage)
      .filter((item): item is HomepagePreviewMockMessage => item != null)
    : undefined

  return {
    sessionId: typeof value.sessionId === 'string' && value.sessionId.trim() !== ''
      ? value.sessionId.trim()
      : undefined,
    title: typeof value.title === 'string' && value.title.trim() !== ''
      ? value.title.trim()
      : undefined,
    ...(messages != null && messages.length > 0 ? { messages } : {})
  }
}

const getInitialPreviewConfig = (): HomepagePreviewConfig => {
  if (typeof window === 'undefined') {
    return {
      downloadUrl: GITHUB_RELEASES_URL,
      locale: 'zh',
      theme: 'system'
    }
  }

  const params = new URLSearchParams(window.location.search)
  downloadUrlConfigured = (params.get('downloadUrl')?.trim() ?? '') !== ''
  return {
    downloadUrl: normalizeDownloadUrl(params.get('downloadUrl')),
    locale: normalizeLocale(params.get('locale') ?? document.documentElement.lang ?? navigator.language),
    theme: normalizeTheme(params.get('theme') ?? 'system')
  }
}

const getPreviewConfig = () => {
  previewConfig ??= getInitialPreviewConfig()
  return previewConfig
}

const mergePreviewConfig = (patch: Partial<HomepagePreviewConfig>) => {
  const current = getPreviewConfig()
  previewConfig = {
    ...current,
    ...patch,
    downloadUrl: patch.downloadUrl ?? current.downloadUrl,
    locale: patch.locale ?? current.locale,
    theme: patch.theme ?? current.theme
  }

  applyPreviewDocumentConfig(previewConfig)

  if (previewStore != null && !previewStore.userInteracted) {
    previewStore = undefined
  }
}

const startInitialConfigWait = () => {
  if (initialConfigWait != null) return

  initialConfigWait = new Promise<void>((resolve) => {
    resolveInitialConfigWait = resolve
    initialConfigTimer = window.setTimeout(() => {
      settleInitialConfigWait()
    }, INITIAL_CONFIG_WAIT_MS)
  })
}

const settleInitialConfigWait = () => {
  if (initialConfigTimer != null) {
    window.clearTimeout(initialConfigTimer)
    initialConfigTimer = undefined
  }
  resolveInitialConfigWait?.()
  resolveInitialConfigWait = undefined
}

const waitForInitialConfig = async () => {
  await initialConfigWait
}

const isHomepagePreviewQueryEnabled = () => (
  new URLSearchParams(window.location.search).get(HOMEPAGE_PREVIEW_QUERY) === HOMEPAGE_PREVIEW_QUERY_VALUE
)

const isEmbeddedPreviewFrame = () => window.parent !== window

const clearStaleHomepagePreviewRuntimeState = () => {
  try {
    sessionStorage.removeItem(HOMEPAGE_PREVIEW_RUNTIME_STORAGE_KEY)
  } catch {}

  try {
    const storedServerBaseUrl = localStorage.getItem(SERVER_BASE_URL_STORAGE_KEY)
    if (storedServerBaseUrl != null && new URL(storedServerBaseUrl).origin === window.location.origin) {
      localStorage.removeItem(SERVER_BASE_URL_STORAGE_KEY)
    }
  } catch {}
}

export const isHomepagePreviewRuntimeEnabled = () => {
  if (typeof window === 'undefined') return false
  return didInstall ||
    (isHomepagePreviewQueryEnabled() && (isEmbeddedPreviewFrame() || __ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__))
}

const getPreviewSessionId = () => getPreviewConfig().mockData?.sessionId ?? DEFAULT_SESSION_ID

const t = (key: string, options?: Record<string, unknown>) => i18n.t(`homepagePreview.mock.${key}`, options)

const extractTextContent = (content: string | ChatMessageContent[] | undefined) => {
  if (content == null) return ''
  if (typeof content === 'string') return content
  return content
    .filter((item): item is Extract<ChatMessageContent, { type: 'text' }> => item.type === 'text')
    .map(item => item.text)
    .join('\n')
    .trim()
}

const createTextContent = (text: string): ChatMessageContent => ({ type: 'text', text })

const createToolUseContent = (
  id: string,
  name: string,
  input: Record<string, unknown>
): ChatMessageContent => ({
  type: 'tool_use',
  id,
  name,
  input
})

const createToolResultContent = (
  toolUseId: string,
  content: unknown,
  isError = false
): ChatMessageContent => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  content,
  ...(isError ? { is_error: true } : {})
})

const createMessage = (
  role: HomepagePreviewMessageRole,
  content: string | ChatMessageContent[],
  createdAt: number,
  id?: string
): ChatMessage => ({
  id: id ?? `homepage-message-${createdAt}-${Math.random().toString(16).slice(2)}`,
  role,
  content,
  createdAt
})

const buildToolShowcaseMessages = (now: number): ChatMessage[] => [
  createMessage(
    'assistant',
    [
      createTextContent(t('toolSessionIntro')),
      createToolUseContent('homepage-tool-todos', 'adapter:claude-code:TodoWrite', {
        todos: [
          {
            content: t('todoAuditAdapters'),
            status: 'completed'
          },
          {
            content: t('todoConnectIm'),
            activeForm: t('todoConnectImActive'),
            status: 'in_progress'
          },
          {
            content: t('todoVerifyMobile'),
            status: 'pending'
          }
        ]
      }),
      createToolResultContent('homepage-tool-todos', t('toolTodosResult')),
      createToolUseContent('homepage-tool-ls', 'adapter:claude-code:LS', {
        path: 'src',
        ignore: ['node_modules', 'dist']
      }),
      createToolResultContent('homepage-tool-ls', {
        stdout: [
          'src/',
          '  components/',
          '  pages/',
          '  styles/',
          '  lib/'
        ].join('\n')
      })
    ],
    now - 36_000,
    'homepage-seed-tools'
  ),
  createMessage(
    'assistant',
    [
      createTextContent(t('toolSessionSummary')),
      createToolUseContent('homepage-tool-bash', 'adapter:claude-code:Bash', {
        command: 'pnpm test -- --runInBand',
        description: t('bashToolDescription'),
        timeout: 120_000
      }),
      createToolResultContent('homepage-tool-bash', {
        stdout: '12 specs passed\n0 failed\npreview runtime healthy'
      })
    ],
    now - 18_000,
    'homepage-seed-verification'
  )
]

const buildSeedMessages = (now: number) => {
  const injectedMessages = getPreviewConfig().mockData?.messages
  if (injectedMessages != null && injectedMessages.length > 0) {
    return injectedMessages.map((message, index) =>
      createMessage(
        message.role ?? 'assistant',
        message.content ?? '',
        message.createdAt ?? now - (injectedMessages.length - index) * 45_000,
        message.id
      )
    )
  }

  return [
    createMessage('user', t('seedUserMessage'), now - 90_000, 'homepage-seed-user'),
    createMessage('assistant', t('seedAssistantMessage'), now - 52_000, 'homepage-seed-assistant')
  ]
}

const buildSessionFromMessages = (
  input: {
    adapter?: string
    createdAt?: number
    effort?: Session['effort']
    id: string
    messages: ChatMessage[]
    model?: string
    permissionMode?: Session['permissionMode']
    status?: Session['status']
    tags?: string[]
    title?: string
  }
): Session => {
  const messages = input.messages
  const lastMessage = messages[messages.length - 1]
  return {
    id: input.id,
    ...(input.title != null ? { title: input.title } : {}),
    createdAt: input.createdAt ?? Date.now(),
    messageCount: messages.length,
    lastMessage: extractTextContent(lastMessage?.content),
    lastUserMessage: extractTextContent([...messages].reverse().find(message => message.role === 'user')?.content),
    status: input.status ?? 'completed',
    model: input.model ?? 'codex',
    adapter: input.adapter ?? 'codex',
    permissionMode: input.permissionMode ?? 'acceptEdits',
    effort: input.effort ?? 'medium',
    ...(input.tags != null ? { tags: input.tags } : {}),
    workspaceFileState: {
      isOpen: false,
      openPaths: []
    }
  }
}

const buildPreviewSession = (now: number, messages = buildSeedMessages(now)): Session =>
  buildSessionFromMessages({
    id: getPreviewSessionId(),
    title: getPreviewConfig().mockData?.title ?? t('sessionTitle'),
    createdAt: now - 120_000,
    messages,
    adapter: 'codex',
    model: 'codex',
    tags: [t('tagHomepage'), t('tagPreview')]
  })

const buildSecondarySessionMessages = (now: number): ChatMessage[] => [
  createMessage('user', t('secondaryUserMessage'), now - 9 * 60_000, 'homepage-secondary-user'),
  createMessage(
    'assistant',
    [
      createTextContent(t('secondaryAssistantIntro')),
      createToolUseContent('homepage-secondary-read', 'adapter:claude-code:Read', {
        file_path: 'src/components/AgentDock.tsx',
        limit: 80,
        offset: 1
      }),
      createToolResultContent(
        'homepage-secondary-read',
        [
          'export function AgentDock() {',
          '  return <aside className="agent-dock" />',
          '}'
        ].join('\n')
      ),
      createToolUseContent('homepage-secondary-grep', 'adapter:claude-code:Grep', {
        pattern: 'adapter',
        path: 'src',
        output_mode: 'content'
      }),
      createToolResultContent('homepage-secondary-grep', {
        matches: [
          'src/lib/adapters.ts: export const adapters = [...]',
          'src/components/AgentDock.tsx: adapters.map(...)'
        ]
      })
    ],
    now - 8 * 60_000,
    'homepage-secondary-tools'
  ),
  createMessage('assistant', t('secondaryAssistantSummary'), now - 7 * 60_000, 'homepage-secondary-summary')
]

const buildImSessionMessages = (now: number): ChatMessage[] => [
  createMessage('user', t('imUserMessage'), now - 16 * 60_000, 'homepage-im-user'),
  createMessage(
    'assistant',
    [
      createTextContent(t('imAssistantIntro')),
      createToolUseContent('homepage-im-webhook', 'adapter:claude-code:Bash', {
        command: 'pnpm run channel:preview -- --lark --discord --qq',
        description: t('imBashDescription')
      }),
      createToolResultContent('homepage-im-webhook', {
        stdout: [
          'lark webhook: ready',
          'discord bridge: ready',
          'qq relay: ready'
        ].join('\n')
      })
    ],
    now - 15 * 60_000,
    'homepage-im-tools'
  ),
  createMessage('assistant', t('imAssistantSummary'), now - 14 * 60_000, 'homepage-im-summary')
]

const buildRoomRunMessages = (now: number, kind: 'codex' | 'claude'): ChatMessage[] => {
  if (kind === 'codex') {
    return [
      createMessage('user', t('roomCodexUserMessage'), now - 11 * 60_000, 'homepage-room-codex-user'),
      createMessage(
        'assistant',
        [
          createTextContent(t('roomCodexAssistantIntro')),
          createToolUseContent('homepage-room-codex-plan', 'adapter:claude-code:TodoWrite', {
            todos: [
              { content: t('roomCodexTodoOne'), status: 'completed' },
              { content: t('roomCodexTodoTwo'), status: 'completed' }
            ]
          }),
          createToolResultContent('homepage-room-codex-plan', t('roomCodexResult'))
        ],
        now - 10 * 60_000,
        'homepage-room-codex-tools'
      )
    ]
  }

  return [
    createMessage('user', t('roomClaudeUserMessage'), now - 12 * 60_000, 'homepage-room-claude-user'),
    createMessage(
      'assistant',
      [
        createTextContent(t('roomClaudeAssistantIntro')),
        createToolUseContent('homepage-room-claude-edit', 'adapter:claude-code:Edit', {
          file_path: 'src/components/DeviceSwitcher.tsx',
          old_string: 'const devices = []',
          new_string: 'const devices = mockConnectedDevices'
        }),
        createToolResultContent('homepage-room-claude-edit', t('roomClaudeResult'))
      ],
      now - 11 * 60_000,
      'homepage-room-claude-tools'
    )
  ]
}

const createRoomMessage = (
  roomId: string,
  role: AgentRoomMessage['role'],
  content: string,
  createdAt: number,
  patch: Partial<AgentRoomMessage> = {}
): AgentRoomMessage => ({
  id: patch.id ?? `${roomId}-message-${createdAt}`,
  roomId,
  role,
  content,
  createdAt,
  ...patch
})

const buildPreviewRoomDetail = (now: number, hostSessionId: string): AgentRoomDetailResponse => {
  const roomId = DEFAULT_ROOM_ID
  const codexRun: AgentRoomRun = {
    roomId,
    key: 'run:codex-homepage',
    memberKey: 'agent:codex',
    sessionId: 'homepage-room-codex-run',
    title: t('roomCodexSessionTitle'),
    status: 'completed',
    latestSummary: t('roomCodexLatestSummary'),
    createdAt: now - 12 * 60_000,
    updatedAt: now - 8 * 60_000
  }
  const claudeRun: AgentRoomRun = {
    roomId,
    key: 'run:claude-device',
    memberKey: 'agent:claude',
    sessionId: 'homepage-room-claude-run',
    title: t('roomClaudeSessionTitle'),
    status: 'waiting',
    latestSummary: t('roomClaudeLatestSummary'),
    interactionId: 'homepage-room-approval',
    requestKind: 'confirmation',
    options: [
      {
        label: t('roomApprovalInstallLabel'),
        value: 'install',
        description: t('roomApprovalInstallDescription')
      },
      {
        label: t('roomApprovalPreviewLabel'),
        value: 'preview',
        description: t('roomApprovalPreviewDescription')
      }
    ],
    createdAt: now - 13 * 60_000,
    updatedAt: now - 5 * 60_000
  }
  const codexMember = {
    key: 'agent:codex',
    kind: 'entity' as const,
    label: 'Codex',
    subtitle: t('roomCodexSubtitle')
  }
  const claudeMember = {
    key: 'agent:claude',
    kind: 'entity' as const,
    label: 'Claude Code',
    subtitle: t('roomClaudeSubtitle')
  }
  return {
    room: {
      id: roomId,
      title: t('roomTitle'),
      hostSessionId,
      status: 'active',
      lastMessage: t('roomLastMessage'),
      createdAt: now - 15 * 60_000,
      updatedAt: now - 2 * 60_000
    },
    members: [
      {
        roomId,
        key: `host:${hostSessionId}`,
        kind: 'host',
        label: 'OneWorks',
        subtitle: t('roomHostSubtitle'),
        status: 'active',
        latestSummary: t('roomHostLatestSummary'),
        activeRunCount: 0,
        pendingCount: 0,
        createdAt: now - 15 * 60_000,
        updatedAt: now - 2 * 60_000
      },
      {
        roomId,
        ...codexMember,
        status: 'completed',
        latestSummary: codexRun.latestSummary,
        activeRunCount: 0,
        pendingCount: 0,
        createdAt: now - 14 * 60_000,
        updatedAt: now - 8 * 60_000
      },
      {
        roomId,
        ...claudeMember,
        status: 'waiting',
        latestSummary: claudeRun.latestSummary,
        activeRunCount: 1,
        pendingCount: 1,
        createdAt: now - 14 * 60_000,
        updatedAt: now - 5 * 60_000
      }
    ],
    runs: [claudeRun, codexRun],
    messages: [
      createRoomMessage(roomId, 'system', t('roomMemberJoined', { member: 'Codex' }), now - 14 * 60_000, {
        id: 'homepage-room-member-codex',
        eventType: 'member_joined',
        memberKey: codexMember.key,
        payload: {
          type: 'member_joined',
          member: codexMember
        }
      }),
      createRoomMessage(roomId, 'system', t('roomMemberJoined', { member: 'Claude Code' }), now - 13 * 60_000, {
        id: 'homepage-room-member-claude',
        eventType: 'member_joined',
        memberKey: claudeMember.key,
        payload: {
          type: 'member_joined',
          member: claudeMember
        }
      }),
      createRoomMessage(roomId, 'agent', t('roomAssignmentCodex'), now - 12 * 60_000, {
        id: 'homepage-room-assignment-codex',
        eventType: 'assignment_sent',
        memberKey: codexMember.key,
        runKey: codexRun.key,
        payload: {
          type: 'assignment_sent',
          member: codexMember,
          run: {
            key: codexRun.key,
            sessionId: codexRun.sessionId,
            title: codexRun.title
          },
          summary: t('roomAssignmentCodex')
        }
      }),
      createRoomMessage(roomId, 'agent', t('roomAttentionClaude'), now - 5 * 60_000, {
        id: 'homepage-room-attention-claude',
        eventType: 'attention_requested',
        memberKey: claudeMember.key,
        runKey: claudeRun.key,
        payload: {
          type: 'attention_requested',
          member: claudeMember,
          run: {
            key: claudeRun.key,
            sessionId: claudeRun.sessionId,
            title: claudeRun.title
          },
          interactionId: claudeRun.interactionId,
          summary: t('roomAttentionClaude'),
          requestKind: 'confirmation',
          options: claudeRun.options
        }
      }),
      createRoomMessage(roomId, 'agent', t('roomCompletedCodex'), now - 4 * 60_000, {
        id: 'homepage-room-completed-codex',
        eventType: 'run_completed',
        memberKey: codexMember.key,
        runKey: codexRun.key,
        payload: {
          type: 'run_completed',
          member: codexMember,
          run: {
            key: codexRun.key,
            sessionId: codexRun.sessionId,
            title: codexRun.title
          },
          summary: t('roomCompletedCodex')
        }
      })
    ]
  }
}

const createPreviewStore = (): HomepagePreviewStore => {
  const now = Date.now()
  const primaryMessages = buildSeedMessages(now)
  const primarySession = buildPreviewSession(now, primaryMessages)
  const secondaryMessages = [
    ...buildSecondarySessionMessages(now),
    ...buildToolShowcaseMessages(now)
  ]
  const secondarySession = buildSessionFromMessages({
    id: 'homepage-claude-refactor',
    title: t('secondarySessionTitle'),
    createdAt: now - 10 * 60_000,
    messages: secondaryMessages,
    adapter: 'claude-code',
    model: 'claude-code',
    effort: 'high',
    tags: [t('tagTooling')]
  })
  const imMessages = buildImSessionMessages(now)
  const imSession = buildSessionFromMessages({
    id: 'homepage-im-sync',
    title: t('imSessionTitle'),
    createdAt: now - 17 * 60_000,
    messages: imMessages,
    adapter: 'kimi',
    model: 'kimi-k2',
    effort: 'medium',
    tags: [t('tagIm')]
  })
  const roomHostMessages = [
    createMessage('user', t('roomHostUserMessage'), now - 15 * 60_000, 'homepage-room-host-user'),
    createMessage('assistant', t('roomHostAssistantMessage'), now - 14 * 60_000, 'homepage-room-host-assistant')
  ]
  const roomHostSession = buildSessionFromMessages({
    id: ROOM_HOST_SESSION_ID,
    title: t('roomTitle'),
    createdAt: now - 15 * 60_000,
    messages: roomHostMessages,
    adapter: 'codex',
    model: 'codex',
    tags: [t('tagRoom')]
  })
  const roomCodexMessages = buildRoomRunMessages(now, 'codex')
  const roomCodexSession = buildSessionFromMessages({
    id: 'homepage-room-codex-run',
    title: t('roomCodexSessionTitle'),
    createdAt: now - 11 * 60_000,
    messages: roomCodexMessages,
    adapter: 'codex',
    model: 'codex',
    tags: [t('tagRoom')]
  })
  const roomClaudeMessages = buildRoomRunMessages(now, 'claude')
  const roomClaudeSession = buildSessionFromMessages({
    id: 'homepage-room-claude-run',
    title: t('roomClaudeSessionTitle'),
    createdAt: now - 12 * 60_000,
    messages: roomClaudeMessages,
    adapter: 'claude-code',
    model: 'claude-code',
    tags: [t('tagRoom')]
  })
  const sessions = [
    primarySession,
    secondarySession,
    imSession,
    roomHostSession,
    roomCodexSession,
    roomClaudeSession
  ]
  const histories = new Map<string, WSEvent[]>([
    [primarySession.id, primaryMessages.map(message => ({ type: 'message', message }))],
    [secondarySession.id, secondaryMessages.map(message => ({ type: 'message', message }))],
    [imSession.id, imMessages.map(message => ({ type: 'message', message }))],
    [roomHostSession.id, roomHostMessages.map(message => ({ type: 'message', message }))],
    [roomCodexSession.id, roomCodexMessages.map(message => ({ type: 'message', message }))],
    [roomClaudeSession.id, roomClaudeMessages.map(message => ({ type: 'message', message }))]
  ])
  const roomDetail = buildPreviewRoomDetail(now, roomHostSession.id)
  return {
    history: histories,
    nextMessageIndex: Array.from(histories.values()).reduce((count, events) => count + events.length, 1),
    rooms: new Map([[roomDetail.room.id, roomDetail]]),
    nextRoomMessageIndex: roomDetail.messages.length + 1,
    sessions: new Map(sessions.map(session => [session.id, session])),
    userInteracted: false
  }
}

const getPreviewStore = () => {
  previewStore ??= createPreviewStore()
  return previewStore
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    }
  })

const parseJsonBody = async (init?: RequestInit): Promise<Record<string, unknown>> => {
  const raw = init?.body
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const normalizeWorkspacePath = (value?: string | null) => (
  (value ?? '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(segment => segment !== '' && segment !== '.')
    .join('/')
)

const getMockWorkspaceFiles = () =>
  new Map<string, string>([
    [
      'package.json',
      JSON.stringify(
        {
          scripts: {
            dev: 'vite --host 0.0.0.0',
            build: 'vite build',
            test: 'vitest run'
          },
          dependencies: {
            '@vitejs/plugin-react': 'latest',
            vite: 'latest',
            react: 'latest',
            'react-dom': 'latest'
          },
          devDependencies: {
            typescript: 'latest',
            vitest: 'latest'
          }
        },
        null,
        2
      )
    ],
    [
      'README.md',
      [
        '# OneWorks Preview App',
        '',
        t('workspaceReadmeIntro'),
        '',
        '- Claude Code / Codex / Kimi adapters',
        '- IM bridge preview',
        '- Multi-device control surface'
      ].join('\n')
    ],
    ['index.html', '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n'],
    [
      'src/main.tsx',
      [
        "import React from 'react'",
        "import { createRoot } from 'react-dom/client'",
        "import { App } from './App'",
        "import './styles.css'",
        '',
        "createRoot(document.getElementById('root')!).render(<App />)"
      ].join('\n')
    ],
    [
      'src/App.tsx',
      [
        "import { AgentDock } from './components/AgentDock'",
        "import { DeviceSwitcher } from './components/DeviceSwitcher'",
        "import { adapters } from './lib/adapters'",
        '',
        'export function App() {',
        '  return (',
        '    <main className="app-shell">',
        '      <AgentDock adapters={adapters} />',
        '      <DeviceSwitcher />',
        '    </main>',
        '  )',
        '}'
      ].join('\n')
    ],
    [
      'src/components/AgentDock.tsx',
      [
        "import type { Adapter } from '../lib/adapters'",
        '',
        'export function AgentDock({ adapters }: { adapters: Adapter[] }) {',
        '  return (',
        '    <section className="agent-dock">',
        '      {adapters.map(adapter => <button key={adapter.id}>{adapter.name}</button>)}',
        '    </section>',
        '  )',
        '}'
      ].join('\n')
    ],
    [
      'src/components/DeviceSwitcher.tsx',
      [
        'const mockConnectedDevices = [',
        "  'MacBook Pro',",
        "  'Studio Display',",
        "  'Remote Windows Workstation'",
        ']',
        '',
        'export function DeviceSwitcher() {',
        '  return <ul>{mockConnectedDevices.map(device => <li key={device}>{device}</li>)}</ul>',
        '}'
      ].join('\n')
    ],
    [
      'src/lib/adapters.ts',
      [
        'export interface Adapter {',
        '  id: string',
        '  name: string',
        '  channel: string',
        '}',
        '',
        'export const adapters: Adapter[] = [',
        "  { id: 'codex', name: 'Codex', channel: 'desktop' },",
        "  { id: 'claude-code', name: 'Claude Code', channel: 'terminal' },",
        "  { id: 'kimi', name: 'Kimi', channel: 'im' }",
        ']'
      ].join('\n')
    ],
    [
      'src/styles.css',
      [
        '.app-shell {',
        '  min-height: 100vh;',
        '  display: grid;',
        '  place-items: center;',
        '}',
        '',
        '.agent-dock {',
        '  display: flex;',
        '  gap: 12px;',
        '}'
      ].join('\n')
    ],
    [
      'public/manifest.webmanifest',
      JSON.stringify(
        {
          name: 'OneWorks Preview',
          short_name: 'OneWorks',
          display: 'standalone',
          start_url: '/'
        },
        null,
        2
      )
    ]
  ])

const listMockWorkspaceTree = (path?: string | null) => {
  const normalizedPath = normalizeWorkspacePath(path)
  const prefix = normalizedPath === '' ? '' : `${normalizedPath}/`
  const files = getMockWorkspaceFiles()
  const entriesByName = new Map<string, MockWorkspaceTreeEntry>()

  for (const filePath of files.keys()) {
    if (!filePath.startsWith(prefix)) continue
    const rest = filePath.slice(prefix.length)
    if (rest === '') continue

    const [name, ...remaining] = rest.split('/')
    if (name == null || name === '') continue

    const isDirectory = remaining.length > 0
    const entryPath = prefix + name
    const existing = entriesByName.get(name)
    if (existing?.type === 'directory') continue

    entriesByName.set(name, {
      absolutePath: `${t('workspaceFolder')}/${entryPath}`,
      name,
      path: entryPath,
      type: isDirectory ? 'directory' : 'file'
    })
  }

  return {
    path: normalizedPath,
    entries: Array.from(entriesByName.values()).sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
  }
}

const readMockWorkspaceFile = (path?: string | null): HomepagePreviewRequestResult => {
  const requestedPath = normalizeWorkspacePath(path) || 'README.md'
  const content = getMockWorkspaceFiles().get(requestedPath)
  if (content == null) {
    return {
      status: 404,
      body: {
        success: false,
        error: {
          code: 'homepage_preview_file_not_found',
          message: t('workspaceFileNotFound', { path: requestedPath })
        }
      }
    }
  }

  return {
    body: {
      content,
      encoding: 'utf-8',
      path: requestedPath,
      size: new Blob([content]).size
    }
  }
}

const readonlyWorkspaceWriteResponse = (): HomepagePreviewRequestResult => ({
  status: 403,
  body: {
    success: false,
    error: {
      code: 'homepage_preview_readonly_workspace',
      message: t('readonlyWorkspaceMessage', {
        downloadUrl: getPreviewConfig().downloadUrl
      })
    }
  }
})

const createKnowledgeSkillSource = (): SkillSummary['sourceDetail'] => ({
  kind: 'projectConfig',
  configSource: 'project',
  configLabel: t('knowledgeConfigLabel')
})

const buildMockSpecs = (): SpecDetail[] => [
  {
    id: 'homepage-onboarding-flow',
    name: t('specOnboardingName'),
    description: t('specOnboardingDescription'),
    params: [
      { name: 'adapter', description: t('specParamAdapter') },
      { name: 'channel', description: t('specParamChannel') }
    ],
    always: true,
    tags: [t('tagHomepage'), t('tagTooling')],
    skills: ['adapter-routing', 'multi-device-handoff'],
    rules: ['preview-readonly-workspace'],
    body: t('specOnboardingBody')
  },
  {
    id: 'im-handoff-flow',
    name: t('specImName'),
    description: t('specImDescription'),
    params: [
      { name: 'room', description: t('specParamRoom') },
      { name: 'summary', description: t('specParamSummary') }
    ],
    always: false,
    tags: [t('tagIm'), t('tagRoom')],
    skills: ['im-bridge-notifier'],
    rules: ['download-for-real-actions'],
    body: t('specImBody')
  }
]

const toSpecSummary = (detail: SpecDetail): SpecSummary => ({
  id: detail.id,
  name: detail.name,
  description: detail.description,
  params: detail.params,
  always: detail.always,
  tags: detail.tags,
  skills: detail.skills,
  rules: detail.rules
})

const buildMockEntities = (): EntityDetail[] => [
  {
    id: 'agent-codex',
    name: 'Codex',
    avatar: 'psychology',
    description: t('entityCodexDescription'),
    always: true,
    tags: [t('tagTooling')],
    skills: ['adapter-routing'],
    rules: ['preview-readonly-workspace'],
    body: t('entityCodexBody')
  },
  {
    id: 'agent-kimi',
    name: 'Kimi',
    avatar: 'forum',
    description: t('entityKimiDescription'),
    always: false,
    tags: [t('tagIm')],
    skills: ['im-bridge-notifier'],
    rules: ['download-for-real-actions'],
    body: t('entityKimiBody')
  }
]

const toEntitySummary = (detail: EntityDetail): EntitySummary => ({
  id: detail.id,
  name: detail.name,
  description: detail.description,
  always: detail.always,
  tags: detail.tags,
  skills: detail.skills,
  rules: detail.rules,
  ...(detail.avatar == null ? {} : { avatar: detail.avatar })
})

const buildMockRules = (): RuleDetail[] => [
  {
    id: 'preview-readonly-workspace',
    name: t('ruleReadonlyName'),
    description: t('ruleReadonlyDescription'),
    always: true,
    globs: ['src/**/*', 'package.json', 'README.md'],
    body: t('ruleReadonlyBody', { downloadUrl: getPreviewConfig().downloadUrl })
  },
  {
    id: 'download-for-real-actions',
    name: t('ruleDownloadName'),
    description: t('ruleDownloadDescription'),
    always: true,
    globs: ['.oo/**/*', 'apps/**/*'],
    body: t('ruleDownloadBody', { downloadUrl: getPreviewConfig().downloadUrl })
  }
]

const toRuleSummary = (detail: RuleDetail): RuleSummary => ({
  id: detail.id,
  name: detail.name,
  description: detail.description,
  always: detail.always,
  ...(detail.globs == null ? {} : { globs: detail.globs })
})

const buildMockSkills = (): SkillDetail[] => [
  {
    id: 'adapter-routing',
    name: t('skillAdapterRoutingName'),
    description: t('skillAdapterRoutingDescription'),
    always: true,
    source: 'project',
    sourceDetail: createKnowledgeSkillSource(),
    body: t('skillAdapterRoutingBody')
  },
  {
    id: 'im-bridge-notifier',
    name: t('skillImBridgeName'),
    description: t('skillImBridgeDescription'),
    always: false,
    source: 'project',
    sourceDetail: createKnowledgeSkillSource(),
    body: t('skillImBridgeBody')
  },
  {
    id: 'multi-device-handoff',
    name: t('skillMultiDeviceName'),
    description: t('skillMultiDeviceDescription'),
    always: false,
    source: 'project',
    sourceDetail: createKnowledgeSkillSource(),
    body: t('skillMultiDeviceBody')
  }
]

const toSkillSummary = (detail: SkillDetail): SkillSummary => ({
  id: detail.id,
  name: detail.name,
  description: detail.description,
  always: detail.always,
  source: detail.source,
  sourceDetail: detail.sourceDetail,
  ...(detail.instancePath == null ? {} : { instancePath: detail.instancePath })
})

const buildMockWorkspaces = (): WorkspaceSummary[] => [
  {
    id: 'homepage-preview-workspace',
    name: t('workspaceAssetName'),
    description: t('workspaceAssetDescription'),
    path: t('workspaceFolder'),
    cwd: t('workspaceFolder'),
    pattern: 'apps/client/**/*'
  }
]

const getKnowledgeDetailPath = (url: URL) => url.searchParams.get('path') ?? ''

const findKnowledgeItem = <T extends { id: string }>(items: T[], id: string) =>
  items.find(item => item.id === id) ?? items[0]

const buildCreatedSkillResponse = async (init?: RequestInit): Promise<HomepagePreviewRequestResult> => {
  const body = await parseJsonBody(init)
  const rawName = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : t('skillCreatedName')
  const id = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'homepage-preview-skill'
  const skill: SkillDetail = {
    id,
    name: rawName,
    description: typeof body.description === 'string' && body.description.trim() !== ''
      ? body.description.trim()
      : t('skillCreatedDescription'),
    always: false,
    source: 'project',
    sourceDetail: createKnowledgeSkillSource(),
    body: typeof body.body === 'string' && body.body.trim() !== ''
      ? body.body.trim()
      : t('skillCreatedBody', { downloadUrl: getPreviewConfig().downloadUrl })
  }
  return { body: { skill } }
}

const buildSkillHubRegistries = (): SkillHubRegistrySummary[] => [
  {
    id: 'homepage-preview-skills',
    name: 'homepage-preview-skills',
    type: 'skills-cli',
    enabled: true,
    searchable: true,
    source: 'https://github.com/oneworks-ai/skills',
    title: t('skillHubRegistryTitle'),
    description: t('skillHubRegistryDescription'),
    configSource: 'project',
    configLabel: t('knowledgeConfigLabel')
  }
]

const buildSkillHubItems = (): SkillHubItem[] => [
  {
    id: 'homepage-preview-skills:ui-review',
    registry: 'homepage-preview-skills',
    registryName: t('skillHubRegistryTitle'),
    configSource: 'project',
    configLabel: t('knowledgeConfigLabel'),
    name: 'homepage/ui-review',
    description: t('skillHubUiReviewDescription'),
    skills: ['ui-review', 'accessibility-audit'],
    commands: ['pnpm lint', 'pnpm typecheck'],
    agents: ['Codex', 'Claude Code'],
    mcpServers: [],
    hasHooks: true,
    installed: false,
    declared: false,
    installRef: 'homepage/ui-review',
    source: 'homepage-preview'
  },
  {
    id: 'homepage-preview-skills:adapter-smoke',
    registry: 'homepage-preview-skills',
    registryName: t('skillHubRegistryTitle'),
    configSource: 'project',
    configLabel: t('knowledgeConfigLabel'),
    name: 'runtime/adapter-smoke',
    description: t('skillHubAdapterSmokeDescription'),
    skills: ['adapter-routing'],
    commands: ['pnpm test -- adapter'],
    agents: ['Codex'],
    mcpServers: ['filesystem'],
    hasHooks: false,
    installed: false,
    declared: false,
    installRef: 'runtime/adapter-smoke',
    source: 'homepage-preview'
  },
  {
    id: 'homepage-preview-skills:im-handoff',
    registry: 'homepage-preview-skills',
    registryName: t('skillHubRegistryTitle'),
    configSource: 'project',
    configLabel: t('knowledgeConfigLabel'),
    name: 'channels/im-handoff',
    description: t('skillHubImHandoffDescription'),
    skills: ['im-bridge-notifier', 'multi-device-handoff'],
    commands: [],
    agents: ['Kimi', 'Claude Code'],
    mcpServers: [],
    hasHooks: true,
    installed: false,
    declared: false,
    installRef: 'channels/im-handoff',
    source: 'homepage-preview'
  }
]

const buildSkillHubSearchResponse = (url: URL): SkillHubSearchResult => {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const registry = url.searchParams.get('registry') ?? 'all'
  const parsedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100
  const matchesRegistry = (item: SkillHubItem) => registry === 'all' || registry === '' || item.registry === registry
  const matchesQuery = (item: SkillHubItem) => {
    if (query === '') return true
    return [
      item.name,
      item.description ?? '',
      item.skills.join(' '),
      item.commands.join(' '),
      item.agents.join(' ')
    ].join(' ').toLowerCase().includes(query)
  }
  const items = buildSkillHubItems().filter(item => matchesRegistry(item) && matchesQuery(item))

  return {
    hasMore: items.length > limit,
    registries: buildSkillHubRegistries(),
    items: items.slice(0, limit)
  }
}

const buildSkillHubInstallResponse = async (init?: RequestInit): Promise<HomepagePreviewRequestResult> => {
  const body = await parseJsonBody(init)
  const skill = typeof body.skill === 'string' && body.skill.trim() !== ''
    ? body.skill.trim()
    : 'homepage/ui-review'
  const registry = typeof body.registry === 'string' && body.registry.trim() !== ''
    ? body.registry.trim()
    : 'homepage-preview-skills'
  const item = buildSkillHubItems().find(candidate => candidate.registry === registry && candidate.installRef === skill)
  const result: SkillHubInstallResult = {
    registry,
    registryName: item?.registryName ?? t('skillHubRegistryTitle'),
    configSource: 'project',
    configLabel: t('knowledgeConfigLabel'),
    configPath: '.oo.config.json',
    source: item?.source ?? 'homepage-preview',
    skill,
    name: item?.name ?? skill,
    installedAt: new Date().toISOString(),
    installDir: `${t('workspaceFolder')}/.oo/skills/${skill.replace(/[^a-z0-9-]+/gi, '-')}`
  }
  return { body: result }
}

const buildConfigResponse = (): ConfigResponse => {
  const config = getPreviewConfig()
  const conversation = {
    runCommands: [
      {
        id: 'homepage-preview-dev',
        name: t('runCommandDev'),
        icon: 'play_arrow',
        isFavorite: true,
        script: 'pnpm dev'
      },
      {
        id: 'homepage-preview-test',
        name: t('runCommandTest'),
        icon: 'check_circle',
        script: 'pnpm test'
      },
      {
        id: 'homepage-preview-mobile',
        name: t('runCommandMobile'),
        icon: 'devices',
        script: 'pnpm preview:mobile'
      }
    ]
  }
  const adapters = {
    'claude-code': {},
    codex: {},
    kimi: {},
    gemini: {},
    copilot: {},
    opencode: {}
  }
  const adapterBuiltinModels = {
    'claude-code': [
      { value: 'claude-code', title: 'Claude Code', description: t('claudeCodeModelDescription') }
    ],
    codex: [
      { value: 'codex', title: 'Codex', description: t('codexModelDescription') }
    ],
    kimi: [
      { value: 'kimi-k2', title: 'Kimi K2', description: t('kimiModelDescription') }
    ],
    gemini: [
      { value: 'gemini-cli', title: 'Gemini CLI', description: t('geminiModelDescription') }
    ],
    copilot: [
      { value: 'copilot', title: 'GitHub Copilot', description: t('copilotModelDescription') }
    ],
    opencode: [
      { value: 'opencode', title: 'OpenCode', description: t('opencodeModelDescription') }
    ]
  }
  const merged = {
    adapterBuiltinModels,
    adapters,
    experiments: {
      agentRoom: true,
      benchmark: false,
      sessionTimeline: false
    },
    general: {
      defaultAdapter: 'codex',
      defaultModel: 'codex',
      interfaceLanguage: config.locale,
      messageLinks: {
        workspaceFileOpener: 'vscode'
      },
      recommendedModels: [
        {
          model: 'codex',
          title: 'Codex',
          description: t('codexModelDescription'),
          placement: 'modelSelector'
        },
        {
          model: 'claude-code',
          title: 'Claude Code',
          description: t('claudeCodeModelDescription'),
          placement: 'modelSelector'
        },
        {
          model: 'kimi-k2',
          title: 'Kimi K2',
          description: t('kimiModelDescription'),
          placement: 'modelSelector'
        }
      ]
    },
    conversation,
    models: {}
  } as unknown as NonNullable<NonNullable<ConfigResponse['sources']>['merged']>

  return {
    sources: {
      project: {
        conversation
      },
      user: {},
      merged
    },
    resolvedSources: {
      project: {
        conversation
      },
      user: {}
    },
    meta: {
      workspaceFolder: t('workspaceFolder'),
      configPresent: {
        project: true,
        user: false
      },
      experiments: merged.experiments,
      about: {
        version: 'preview'
      }
    }
  }
}

const getSessionOrDefault = (sessionId: string) => {
  const store = getPreviewStore()
  const existing = store.sessions.get(sessionId)
  if (existing != null) return existing

  const fallback = {
    ...buildPreviewSession(Date.now()),
    id: sessionId
  }
  store.sessions.set(sessionId, fallback)
  store.history.set(sessionId, [])
  return fallback
}

const updateSession = (sessionId: string, patch: Partial<Session>) => {
  const store = getPreviewStore()
  const current = getSessionOrDefault(sessionId)
  const next = {
    ...current,
    ...patch
  }
  store.sessions.set(sessionId, next)
  emitToSession(sessionId, { type: 'session_updated', session: next })
  return next
}

const appendMessage = (sessionId: string, message: ChatMessage, options: { emit?: boolean } = {}) => {
  const store = getPreviewStore()
  const events = store.history.get(sessionId) ?? []
  const nextEvents = [...events, { type: 'message' as const, message }]
  store.history.set(sessionId, nextEvents)
  const current = getSessionOrDefault(sessionId)
  store.sessions.set(sessionId, {
    ...current,
    messageCount: nextEvents.filter(event => event.type === 'message').length,
    lastMessage: extractTextContent(message.content),
    ...(message.role === 'user' ? { lastUserMessage: extractTextContent(message.content) } : {})
  })

  if (options.emit === true) {
    emitToSession(sessionId, { type: 'message', message })
  }
}

const getDownloadReplyKey = (session: Session) => {
  const adapter = `${session.adapter ?? ''} ${session.model ?? ''}`.toLowerCase()
  if (adapter.includes('claude')) return 'downloadReplyClaudeCode'
  if (adapter.includes('kimi')) return 'downloadReplyKimi'
  if (adapter.includes('gemini')) return 'downloadReplyGemini'
  if (adapter.includes('copilot')) return 'downloadReplyCopilot'
  if (adapter.includes('opencode') || adapter.includes('open-code')) return 'downloadReplyOpencode'
  if (adapter.includes('codex')) return 'downloadReplyCodex'
  return 'downloadReply'
}

const createDownloadReply = (sessionId: string) =>
  t(getDownloadReplyKey(getSessionOrDefault(sessionId)), {
    downloadUrl: getPreviewConfig().downloadUrl
  })

const scheduleAssistantReply = (sessionId: string) => {
  window.setTimeout(() => {
    const now = Date.now()
    const assistantMessage = createMessage(
      'assistant',
      createDownloadReply(sessionId),
      now,
      `homepage-assistant-${getPreviewStore().nextMessageIndex++}`
    )
    appendMessage(sessionId, assistantMessage, { emit: true })
    updateSession(sessionId, {
      status: 'completed'
    })
  }, 620)
}

const handleSendSessionMessage = async (
  sessionId: string,
  init?: RequestInit
): Promise<HomepagePreviewRequestResult> => {
  const store = getPreviewStore()
  store.userInteracted = true
  const body = await parseJsonBody(init)
  const content = typeof body.text === 'string'
    ? body.text.trim()
    : Array.isArray(body.content)
    ? body.content as ChatMessageContent[]
    : ''
  if (content === '' || (Array.isArray(content) && content.length === 0)) {
    return { body: { ok: false }, status: 400 }
  }

  const now = Date.now()
  const userMessage = createMessage(
    'user',
    content,
    now,
    `homepage-user-${store.nextMessageIndex++}`
  )
  appendMessage(sessionId, userMessage)
  updateSession(sessionId, {
    status: 'running'
  })
  window.setTimeout(() => emitToSession(sessionId, { type: 'message', message: userMessage }), 80)
  scheduleAssistantReply(sessionId)
  return { body: { ok: true } }
}

const handleCreateSession = async (init?: RequestInit): Promise<HomepagePreviewRequestResult> => {
  const store = getPreviewStore()
  store.userInteracted = true
  const body = await parseJsonBody(init)
  const id = typeof body.id === 'string' && body.id.trim() !== ''
    ? body.id.trim()
    : `homepage-session-${Date.now()}`
  const initialContent = typeof body.initialMessage === 'string'
    ? body.initialMessage.trim()
    : Array.isArray(body.initialContent)
    ? body.initialContent as ChatMessageContent[]
    : t('defaultUserMessage')
  const now = Date.now()
  const userMessage = createMessage('user', initialContent, now, `homepage-user-${store.nextMessageIndex++}`)
  const session: Session = {
    id,
    title: typeof body.title === 'string' && body.title.trim() !== ''
      ? body.title.trim()
      : extractTextContent(initialContent).slice(0, 42) || t('sessionTitle'),
    createdAt: now,
    messageCount: 1,
    lastMessage: extractTextContent(initialContent),
    lastUserMessage: extractTextContent(initialContent),
    status: 'running',
    model: typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : 'codex',
    adapter: isRecord(body.options) && typeof body.options.adapter === 'string'
      ? body.options.adapter
      : 'codex',
    permissionMode: 'acceptEdits',
    effort: 'medium',
    workspaceFileState: {
      isOpen: false,
      openPaths: []
    }
  }
  store.sessions.set(id, session)
  store.history.set(id, [{ type: 'message', message: userMessage }])
  emitToSessionSubscribers({
    type: 'session_creation_progress',
    sessionId: id,
    progress: {
      phase: 'workspace',
      step: 'workspace_ready',
      status: 'success',
      message: t('workspaceReady')
    }
  })
  scheduleAssistantReply(id)
  return { body: { session } }
}

const appendRoomMessage = (
  roomId: string,
  message: AgentRoomMessage,
  patchRoom?: Partial<AgentRoomDetailResponse['room']>
) => {
  const store = getPreviewStore()
  const detail = store.rooms.get(roomId)
  if (detail == null) return undefined

  const nextDetail = {
    ...detail,
    room: {
      ...detail.room,
      lastMessage: message.content,
      updatedAt: message.createdAt,
      ...patchRoom
    },
    messages: [...detail.messages, message]
  }
  store.rooms.set(roomId, nextDetail)
  return nextDetail
}

const handleSendRoomMessage = async (
  roomId: string,
  init?: RequestInit
): Promise<HomepagePreviewRequestResult> => {
  const store = getPreviewStore()
  const detail = store.rooms.get(roomId)
  if (detail == null) {
    return {
      status: 404,
      body: { success: false, error: { code: 'homepage_preview_room_not_found', message: t('roomNotFound') } }
    }
  }

  const body = await parseJsonBody(init)
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (content === '') {
    return {
      status: 400,
      body: { success: false, error: { code: 'homepage_preview_empty_room_message', message: t('emptyRoomMessage') } }
    }
  }

  const now = Date.now()
  const target = isRecord(body.target) ? body.target : undefined
  const userMessage = createRoomMessage(roomId, 'user', content, now, {
    id: `${roomId}-user-${store.nextRoomMessageIndex++}`,
    payload: {
      ...(target != null ? { target } : {})
    }
  })
  appendRoomMessage(roomId, userMessage)

  window.setTimeout(() => {
    appendRoomMessage(
      roomId,
      createRoomMessage(
        roomId,
        'agent',
        t('roomDownloadReply', {
          downloadUrl: getPreviewConfig().downloadUrl
        }),
        Date.now(),
        {
          id: `${roomId}-agent-${store.nextRoomMessageIndex++}`,
          memberKey: 'agent:claude',
          runKey: 'run:claude-device',
          payload: {
            source: 'child_session_message',
            sessionId: 'homepage-room-claude-run'
          }
        }
      )
    )
  }, 420)

  return { body: { message: userMessage } }
}

const handleRoomInteractionResponse = (roomId: string): HomepagePreviewRequestResult => {
  const detail = getPreviewStore().rooms.get(roomId)
  if (detail == null) {
    return {
      status: 404,
      body: { success: false, error: { code: 'homepage_preview_room_not_found', message: t('roomNotFound') } }
    }
  }

  const now = Date.now()
  const nextMembers = detail.members.map(member =>
    member.key === 'agent:claude'
      ? {
        ...member,
        status: 'completed' as const,
        pendingCount: 0,
        activeRunCount: 0,
        latestSummary: t('roomInteractionHandled'),
        updatedAt: now
      }
      : member
  )
  const nextRuns = detail.runs.map(run =>
    run.key === 'run:claude-device'
      ? {
        ...run,
        status: 'completed' as const,
        latestSummary: t('roomInteractionHandled'),
        interactionId: undefined,
        requestKind: undefined,
        options: undefined,
        updatedAt: now
      }
      : run
  )
  const message = createRoomMessage(roomId, 'agent', t('roomInteractionHandled'), now, {
    id: `${roomId}-interaction-${getPreviewStore().nextRoomMessageIndex++}`,
    eventType: 'run_completed',
    memberKey: 'agent:claude',
    runKey: 'run:claude-device',
    payload: {
      type: 'run_completed',
      member: {
        key: 'agent:claude',
        kind: 'entity',
        label: 'Claude Code',
        subtitle: t('roomClaudeSubtitle')
      },
      run: {
        key: 'run:claude-device',
        sessionId: 'homepage-room-claude-run',
        title: t('roomClaudeSessionTitle')
      },
      summary: t('roomInteractionHandled')
    }
  })
  getPreviewStore().rooms.set(roomId, {
    ...detail,
    room: {
      ...detail.room,
      lastMessage: message.content,
      status: 'completed',
      updatedAt: now
    },
    members: nextMembers,
    runs: nextRuns,
    messages: [...detail.messages, message]
  })
  return { body: { ok: true } }
}

const buildWorkspaceResponse = (sessionId: string) => ({
  workspace: {
    sessionId,
    kind: 'shared_workspace',
    workspaceFolder: t('workspaceFolder'),
    cleanupPolicy: 'retain',
    state: 'ready',
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 30_000
  }
})

const handleApiRequest = async (
  url: URL,
  init?: RequestInit
): Promise<HomepagePreviewRequestResult | undefined> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname.replace(/\/$/, '') || '/'
  const store = getPreviewStore()

  if (path === '/api/auth/status' && method === 'GET') {
    return {
      body: {
        enabled: false,
        authenticated: true,
        usernames: ['preview']
      }
    }
  }

  if (path === '/api/config' && method === 'GET') {
    return { body: buildConfigResponse() }
  }

  if (path === '/api/config' && method === 'PATCH') {
    return { body: { ok: true } }
  }

  if (path === '/api/config/schema' && method === 'GET') {
    return { body: { sections: [] } }
  }

  if (path === '/api/sessions' && method === 'GET') {
    return { body: { sessions: Array.from(store.sessions.values()) } }
  }

  if (path === '/api/sessions' && method === 'POST') {
    return handleCreateSession(init)
  }

  if (path === '/api/sessions/archived' && method === 'GET') {
    return { body: { sessions: [] } }
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(?:\/(.+))?$/)
  if (sessionMatch != null) {
    const sessionId = decodeURIComponent(sessionMatch[1] ?? '')
    const subpath = sessionMatch[2] ?? ''
    if (subpath === '' && method === 'GET') {
      return { body: { session: getSessionOrDefault(sessionId) } }
    }
    if (subpath === '' && method === 'PATCH') {
      const body = await parseJsonBody(init)
      updateSession(sessionId, body as Partial<Session>)
      return { body: { ok: true } }
    }
    if (subpath === 'messages' && method === 'GET') {
      return {
        body: {
          messages: store.history.get(sessionId) ?? [],
          queuedMessages: EMPTY_QUEUE,
          session: getSessionOrDefault(sessionId)
        }
      }
    }
    if (subpath === 'messages' && method === 'POST') {
      return handleSendSessionMessage(sessionId, init)
    }
    if (subpath === 'workspace' && method === 'GET') {
      return { body: buildWorkspaceResponse(sessionId) }
    }
    if (subpath === 'workspace/tree' && method === 'GET') {
      return { body: listMockWorkspaceTree(url.searchParams.get('path')) }
    }
    if (subpath === 'workspace/file' && method === 'GET') {
      return readMockWorkspaceFile(url.searchParams.get('path'))
    }
    if (subpath === 'workspace/file' && method === 'PUT') {
      return readonlyWorkspaceWriteResponse()
    }
    if (
      subpath === 'workspace/open-file' ||
      subpath === 'workspace/reveal-path' ||
      subpath === 'workspace/create-worktree' ||
      subpath === 'workspace/transfer-local' ||
      subpath === 'events' ||
      subpath.startsWith('queued-messages')
    ) {
      return { body: subpath.startsWith('queued-messages') ? { queuedMessages: EMPTY_QUEUE } : { ok: true } }
    }
  }

  if (path === '/api/agent-rooms' && method === 'GET') {
    return { body: { rooms: Array.from(store.rooms.values()).map(detail => detail.room) } }
  }

  if (path === '/api/agent-rooms/archived' && method === 'GET') {
    return { body: { rooms: [] } }
  }

  const roomMatch = path.match(/^\/api\/agent-rooms\/([^/]+)(?:\/(.+))?$/)
  if (roomMatch != null) {
    const roomId = decodeURIComponent(roomMatch[1] ?? '')
    const subpath = roomMatch[2] ?? ''
    if (subpath === '' && method === 'GET') {
      const detail = store.rooms.get(roomId)
      return detail == null
        ? {
          status: 404,
          body: {
            success: false,
            error: {
              code: 'homepage_preview_room_not_found',
              message: t('roomNotFound')
            }
          }
        }
        : { body: detail }
    }
    if (subpath === '' && method === 'PATCH') {
      const detail = store.rooms.get(roomId)
      if (detail == null) {
        return {
          status: 404,
          body: { success: false, error: { code: 'homepage_preview_room_not_found', message: t('roomNotFound') } }
        }
      }
      const body = await parseJsonBody(init)
      const now = Date.now()
      const nextDetail = {
        ...detail,
        room: {
          ...detail.room,
          updatedAt: now,
          ...(body.isArchived === true
            ? { archivedAt: now }
            : body.isArchived === false
            ? { archivedAt: undefined }
            : {}),
          ...(body.isFavorited === true
            ? { favoritedAt: now }
            : body.isFavorited === false
            ? { favoritedAt: undefined }
            : {})
        }
      }
      store.rooms.set(roomId, nextDetail)
      return { body: { room: nextDetail.room } }
    }
    if (subpath === 'messages' && method === 'POST') {
      return handleSendRoomMessage(roomId, init)
    }
    if (subpath.startsWith('interactions/') && subpath.endsWith('/responses') && method === 'POST') {
      return handleRoomInteractionResponse(roomId)
    }
  }

  if (path === '/api/worktree-environments') {
    return { body: { environments: [] } }
  }

  if (path === '/api/workspace/file-openers') {
    return { body: { defaultOpener: 'vscode', openers: [] } }
  }

  if (path === '/api/workspace/path-actions') {
    return {
      body: {
        fileManager: {
          available: false,
          canRevealFile: false,
          kind: 'finder',
          title: 'Finder'
        },
        terminalOpeners: []
      }
    }
  }

  if (path === '/api/workspace/tree') {
    return { body: listMockWorkspaceTree(url.searchParams.get('path')) }
  }

  if (path === '/api/workspace/file' && method === 'GET') {
    return readMockWorkspaceFile(url.searchParams.get('path'))
  }

  if (path === '/api/workspace/file' && method === 'PUT') {
    return readonlyWorkspaceWriteResponse()
  }

  if (
    (path === '/api/workspace/open-file' || path === '/api/workspace/reveal-path' ||
      path === '/api/workspace/open-workspace') &&
    method === 'POST'
  ) {
    return {
      body: {
        ok: true,
        path: t('workspaceFolder')
      }
    }
  }

  if (path === '/api/workspace/git' || /\/git(?:\/|$)/.test(path)) {
    return {
      body: {
        available: false,
        cwd: t('workspaceFolder'),
        reason: 'not_git_repository'
      }
    }
  }

  if (/^\/api\/adapters\/[^/]+\/accounts/.test(path)) {
    return {
      body: {
        defaultAccount: 'preview',
        accounts: [
          {
            key: 'preview',
            title: t('previewAccount'),
            status: 'ready',
            isDefault: true
          }
        ]
      }
    }
  }

  if (path === '/api/projects') {
    return { body: { projects: [] } }
  }

  if ((path === '/api/skill-hub/search' || path === '/api/skill-hub/skills-cli/search') && method === 'GET') {
    return { body: buildSkillHubSearchResponse(url) }
  }

  if ((path === '/api/skill-hub/install' || path === '/api/skill-hub/skills-cli/install') && method === 'POST') {
    return buildSkillHubInstallResponse(init)
  }

  if (path === '/api/ai/specs' && method === 'GET') {
    return { body: { specs: buildMockSpecs().map(toSpecSummary) } }
  }

  if (path === '/api/ai/specs/detail' && method === 'GET') {
    const spec = findKnowledgeItem(buildMockSpecs(), getKnowledgeDetailPath(url))
    return spec == null
      ? {
        status: 404,
        body: {
          success: false,
          error: { code: 'homepage_preview_spec_not_found', message: t('knowledgeItemNotFound') }
        }
      }
      : { body: { spec } }
  }

  if (path === '/api/ai/entities' && method === 'GET') {
    return { body: { entities: buildMockEntities().map(toEntitySummary) } }
  }

  if (path === '/api/ai/entities/detail' && method === 'GET') {
    const entity = findKnowledgeItem(buildMockEntities(), getKnowledgeDetailPath(url))
    return entity == null
      ? {
        status: 404,
        body: {
          success: false,
          error: { code: 'homepage_preview_entity_not_found', message: t('knowledgeItemNotFound') }
        }
      }
      : { body: { entity } }
  }

  if (path === '/api/ai/workspaces' && method === 'GET') {
    return { body: { workspaces: buildMockWorkspaces() } }
  }

  if (path === '/api/ai/rules' && method === 'GET') {
    return { body: { rules: buildMockRules().map(toRuleSummary) } }
  }

  if (path === '/api/ai/rules/detail' && method === 'GET') {
    const rule = findKnowledgeItem(buildMockRules(), getKnowledgeDetailPath(url))
    return rule == null
      ? {
        status: 404,
        body: {
          success: false,
          error: { code: 'homepage_preview_rule_not_found', message: t('knowledgeItemNotFound') }
        }
      }
      : { body: { rule } }
  }

  if (path === '/api/ai/skills/import' && method === 'POST') {
    return { body: { fileCount: 3, targetDir: `${t('workspaceFolder')}/.oo/skills/homepage-preview` } }
  }

  if (path === '/api/ai/skills' && method === 'GET') {
    return { body: { skills: buildMockSkills().map(toSkillSummary) } }
  }

  if (path === '/api/ai/skills' && method === 'POST') {
    return buildCreatedSkillResponse(init)
  }

  if (path === '/api/ai/skills/detail' && method === 'GET') {
    const skill = findKnowledgeItem(buildMockSkills(), getKnowledgeDetailPath(url))
    return skill == null
      ? {
        status: 404,
        body: {
          success: false,
          error: { code: 'homepage_preview_skill_not_found', message: t('knowledgeItemNotFound') }
        }
      }
      : { body: { skill } }
  }

  if (path === '/api/automation/rules') {
    return { body: { rules: [] } }
  }

  if (path === '/api/automation/runs') {
    return { body: { runs: [] } }
  }

  if (path === '/api/benchmark/categories') {
    return { body: { categories: [] } }
  }

  return {
    status: 404,
    body: {
      success: false,
      error: {
        code: 'homepage_preview_unhandled',
        message: `Unhandled homepage preview API: ${method} ${path}`
      }
    }
  }
}

export const handleHomepagePreviewFetch = async (
  url: string,
  init?: RequestInit
): Promise<Response | undefined> => {
  if (!isHomepagePreviewRuntimeEnabled()) {
    return undefined
  }

  const requestUrl = new URL(url, window.location.origin)
  if (!requestUrl.pathname.startsWith('/api/')) {
    return undefined
  }

  await waitForInitialConfig()

  const result = await handleApiRequest(requestUrl, init)
  if (result == null) {
    return undefined
  }

  return jsonResponse(result.body, result.status)
}

class HomepagePreviewSocket extends EventTarget {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readonly binaryType: BinaryType = 'blob'
  readonly bufferedAmount = 0
  readonly channel?: string
  readonly extensions = ''
  readonly protocol = ''
  readonly sessionId?: string
  readonly subscribe?: string
  readonly terminalId?: string
  readonly terminalRows?: number
  readonly terminalCols?: number
  readonly url: string
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
  readyState: number = WebSocket.CONNECTING
  private terminalNoticeShown = false

  constructor(url: string) {
    super()
    this.url = url
    const parsedUrl = new URL(url)
    this.channel = parsedUrl.searchParams.get('channel') ?? undefined
    this.sessionId = parsedUrl.searchParams.get('sessionId') ?? undefined
    this.subscribe = parsedUrl.searchParams.get('subscribe') ?? undefined
    this.terminalId = parsedUrl.searchParams.get('terminalId') ?? undefined
    this.terminalCols = Number.parseInt(parsedUrl.searchParams.get('cols') ?? '80', 10)
    this.terminalRows = Number.parseInt(parsedUrl.searchParams.get('rows') ?? '24', 10)
    activeSockets.add(this)

    window.setTimeout(() => this.open(), 24)
  }

  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) {
      return
    }
    this.readyState = WebSocket.CLOSING
    window.setTimeout(() => {
      this.readyState = WebSocket.CLOSED
      activeSockets.delete(this)
      this.emitClose(code, reason)
    }, 16)
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.channel !== 'terminal' || typeof data !== 'string') {
      return
    }

    let command: TerminalSessionCommand | undefined
    try {
      command = JSON.parse(data) as TerminalSessionCommand
    } catch {
      return
    }

    switch (command.type) {
      case 'terminal_input':
        this.emitTerminalInstallNotice()
        return
      case 'terminal_restart':
        this.terminalNoticeShown = false
        this.dispatchPreviewMessage(this.buildTerminalReadyEvent())
        break
      case 'terminal_terminate':
        this.dispatchPreviewMessage({ type: 'terminal_exit', exitCode: 0, signal: null })
        break
      case 'terminal_resize':
        break
    }
  }

  dispatchPreviewMessage(data: WSEvent | TerminalSessionEvent) {
    if (this.readyState !== WebSocket.OPEN) {
      return
    }
    const event = new MessageEvent('message', {
      data: JSON.stringify(data)
    })
    this.onmessage?.call(this as unknown as WebSocket, event)
    this.dispatchEvent(event)
  }

  private open() {
    if (this.readyState !== WebSocket.CONNECTING) {
      return
    }
    this.readyState = WebSocket.OPEN
    const event = new Event('open')
    this.onopen?.call(this as unknown as WebSocket, event)
    this.dispatchEvent(event)
    if (this.channel === 'terminal') {
      this.dispatchPreviewMessage(this.buildTerminalReadyEvent())
    }
  }

  private emitClose(code: number, reason: string) {
    const event = new CloseEvent('close', {
      code,
      reason,
      wasClean: code === 1000
    })
    this.onclose?.call(this as unknown as WebSocket, event)
    this.dispatchEvent(event)
  }

  private buildTerminalReadyEvent(): TerminalSessionEvent {
    return {
      type: 'terminal_ready',
      info: {
        sessionId: this.sessionId ?? getPreviewSessionId(),
        terminalId: this.terminalId,
        shellKind: 'default',
        cwd: t('workspaceFolder'),
        shell: '/bin/zsh',
        cols: Number.isFinite(this.terminalCols) ? this.terminalCols ?? 80 : 80,
        rows: Number.isFinite(this.terminalRows) ? this.terminalRows ?? 24 : 24,
        status: 'running'
      },
      scrollback: ''
    }
  }

  private emitTerminalInstallNotice() {
    if (this.terminalNoticeShown) return

    this.terminalNoticeShown = true
    const message = t('terminalInstallNotice', {
      downloadUrl: getPreviewConfig().downloadUrl
    })
    this.dispatchPreviewMessage({
      type: 'terminal_output',
      data: `${message.replace(/\n/g, '\r\n')}\r\n`
    })
    window.setTimeout(() => {
      this.dispatchPreviewMessage({ type: 'terminal_exit', exitCode: 0, signal: null })
    }, 360)
  }
}

const emitToSession = (sessionId: string, event: WSEvent) => {
  for (const socket of activeSockets) {
    if (socket.sessionId === sessionId) {
      socket.dispatchPreviewMessage(event)
    }
  }
}

const emitToSessionSubscribers = (event: WSEvent) => {
  for (const socket of activeSockets) {
    if (socket.subscribe === 'sessions') {
      socket.dispatchPreviewMessage(event)
    }
  }
}

export const createHomepagePreviewSocket = (url: string): WebSocket | undefined => {
  if (!isHomepagePreviewRuntimeEnabled()) {
    return undefined
  }

  const parsedUrl = new URL(url)
  if (!parsedUrl.pathname.endsWith('/ws')) {
    return undefined
  }

  return new HomepagePreviewSocket(url) as unknown as WebSocket
}

const applyPreviewDocumentConfig = (config: HomepagePreviewConfig) => {
  void i18n.changeLanguage(config.locale)
  document.documentElement.lang = config.locale === 'zh' ? 'zh-CN' : 'en'
  if (config.theme !== 'system') {
    document.documentElement.classList.toggle('dark', config.theme === 'dark')
  }
}

const isLocalPreviewOrigin = (origin: string) => {
  try {
    const originUrl = new URL(origin)
    const currentUrl = new URL(window.location.origin)
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    return localHosts.has(originUrl.hostname) && localHosts.has(currentUrl.hostname)
  } catch {
    return false
  }
}

const isAllowedPreviewOrigin = (origin: string) => {
  if (origin === window.location.origin) return true
  if (isLocalPreviewOrigin(origin)) return true
  try {
    const originUrl = new URL(origin)
    return originUrl.hostname === 'oneworks-ai.github.io'
  } catch {
    return false
  }
}

const readMessageConfig = (data: unknown): Partial<HomepagePreviewConfig> | undefined => {
  if (!isRecord(data) || data.type !== HOMEPAGE_PREVIEW_MESSAGE) {
    return undefined
  }
  if (data.source != null && data.source !== HOMEPAGE_PREVIEW_SOURCE) {
    return undefined
  }
  if (!isRecord(data.payload)) {
    return undefined
  }

  const config: Partial<HomepagePreviewConfig> = {
    locale: normalizeLocale(data.payload.locale),
    mockData: normalizeMockData(data.payload.mockData),
    theme: normalizeTheme(data.payload.theme)
  }

  if (data.payload.downloadUrl != null) {
    config.downloadUrl = normalizeDownloadUrl(data.payload.downloadUrl)
  }

  return config
}

const handlePreviewConfigMessage = (event: MessageEvent<unknown>) => {
  if (!isAllowedPreviewOrigin(event.origin)) {
    return
  }

  const config = readMessageConfig(event.data)
  if (config == null) {
    return
  }

  if (isRecord(event.data) && isRecord(event.data.payload) && event.data.payload.downloadUrl != null) {
    downloadUrlConfigured = true
  }

  mergePreviewConfig(config)
  settleInitialConfigWait()
}

export const installHomepagePreviewRuntime = () => {
  if (!isHomepagePreviewRuntimeEnabled()) {
    clearStaleHomepagePreviewRuntimeState()
    return
  }
  if (didInstall) {
    return
  }

  didInstall = true
  installHomepagePreviewTranslations()
  startInitialConfigWait()
  const config = getPreviewConfig()
  applyPreviewDocumentConfig(config)
  refineDefaultDownloadUrl()

  window.addEventListener('message', handlePreviewConfigMessage)
}
