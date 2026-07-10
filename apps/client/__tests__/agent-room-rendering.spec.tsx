/* eslint-disable max-lines -- SSR rendering coverage intentionally includes transcript and sender-shell regressions. */

import { readFileSync } from 'node:fs'

import { App as AntApp } from 'antd'
import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ChatMessage, Session } from '@oneworks/core'

import { AgentRoomTranscript } from '#~/components/agent-room'
import type {
  AgentRoomMemberView,
  AgentRoomMessageSource,
  AgentRoomRunStatus,
  AgentRoomRunView,
  AgentRoomViewModel
} from '#~/components/agent-room'
import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '#~/components/chat/sender/@types/sender-toolbar-types'
import en from '#~/resources/locales/en.json'
import zh from '#~/resources/locales/zh.json'

vi.mock('#~/components/CodeBlock', () => ({
  CodeBlock: ({ code, lang }: { code: string; lang?: string }) => (
    <pre className='code-block__mock' data-lang={lang}>{code}</pre>
  )
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ options }: { options?: { ariaLabel?: string; editContext?: boolean } }) => (
    <div
      className='chat-input-monaco__mock'
      aria-label={options?.ariaLabel}
      data-edit-context={String(options?.editContext)}
    />
  ),
  loader: {
    config: () => undefined
  }
}))

vi.mock('monaco-editor', () => ({
  editor: {
    defineTheme: vi.fn()
  }
}))

const createI18n = async (lng = 'en') => {
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({
      lng,
      resources: { en: { translation: en }, zh: { translation: zh } },
      interpolation: {
        escapeValue: false
      }
    })

  return i18n
}

const createRun = (
  runKey: string,
  memberKey: string,
  sessionId: string,
  title: string,
  status: AgentRoomRunStatus,
  extra: Partial<AgentRoomRunView> = {}
): AgentRoomRunView => ({ runKey, memberKey, sessionId, title, status, ...extra })

const createMessage = (
  id: string,
  role: AgentRoomMessageSource['role'],
  kind: AgentRoomMessageSource['kind'],
  content: string,
  extra: Partial<AgentRoomMessageSource> = {}
): AgentRoomMessageSource => ({ id, role, kind, content, ...extra })

const fixtureRoom: AgentRoomViewModel = {
  id: 'room-rfc-0003',
  title: 'RFC 0003 Agent Room',
  status: 'waiting',
  members: [
    {
      memberKey: 'member:host',
      label: 'host',
      subtitle: 'Coordinator',
      avatarLabel: 'H',
      status: 'active',
      pendingCount: 0,
      activeRunCount: 1,
      latestSummary: 'Delegating room page workstreams.',
      runs: [createRun('run:host-room-plan', 'member:host', 'sess-host-room-plan', 'room-plan', 'running')]
    },
    {
      memberKey: 'member:architect',
      label: '@architect',
      subtitle: 'Schema and UI planner',
      avatarLabel: 'AR',
      status: 'waiting',
      pendingCount: 1,
      activeRunCount: 1,
      latestSummary: 'Waiting on schema permission.',
      runs: [
        createRun('run:schema-plan', 'member:architect', 'sess-schema-plan', 'schema-plan', 'waiting', {
          latestSummary: 'PRIVATE_CHILD_TRANSCRIPT: Needs confirmation before editing schema.',
          pendingCount: 1
        }),
        createRun('run:billing-review', 'member:architect', 'sess-billing-review', 'billing-review', 'completed', {
          latestSummary: 'PRIVATE_CHILD_TRANSCRIPT: Flaky billing test fixed with regression coverage.'
        })
      ]
    },
    {
      memberKey: 'member:reviewer',
      label: 'reviewer',
      subtitle: 'Release reviewer',
      avatarLabel: 'RV',
      status: 'idle',
      pendingCount: 0,
      activeRunCount: 0,
      latestSummary: 'Blocked by missing release notes.',
      runs: [
        createRun(
          'run:release-check',
          'member:reviewer',
          'sess-release-check',
          'release-check-with-long-name-that-should-not-dominate-the-bubble',
          'failed',
          {
            latestSummary: 'PRIVATE_CHILD_TRANSCRIPT: Missing release notes for verification.'
          }
        )
      ]
    }
  ],
  messages: [
    createMessage('msg-system-host-joined', 'system', 'system', 'Host joined the room', {
      createdAtLabel: '10:29',
      systemMessage: {
        kind: 'memberJoined',
        memberLabel: 'Host'
      }
    }),
    createMessage('msg-user-start', 'user', 'message', 'Please coordinate the room page implementation.', {
      createdAtLabel: '10:30'
    }),
    createMessage(
      'msg-host-assignment',
      'agent',
      'assignment',
      'I assigned schema planning to @architect and release validation to @reviewer.',
      {
        memberKey: 'member:host',
        runKey: 'run:schema-plan',
        createdAtLabel: '10:31',
        targetLabel: 'architect'
      }
    ),
    createMessage('msg-architect-attention', 'agent', 'attention', 'I need confirmation before editing schema files.', {
      memberKey: 'member:architect',
      runKey: 'run:schema-plan',
      createdAtLabel: '10:41',
      options: [
        {
          label: 'Allow schema change',
          value: 'allow_schema',
          description: 'Let the architect update schema files.'
        },
        {
          label: 'Keep plan read-only',
          value: 'read_only',
          description: 'Ask for a plan without edits.'
        }
      ]
    }),
    createMessage(
      'msg-architect-complete',
      'agent',
      'completion',
      'Completed billing review: flaky test fixed with regression coverage.',
      {
        memberKey: 'member:architect',
        runKey: 'run:billing-review',
        createdAtLabel: '10:36'
      }
    ),
    createMessage('msg-reviewer-failed', 'agent', 'failure', 'I am blocked because release notes are missing.', {
      memberKey: 'member:reviewer',
      runKey: 'run:release-check',
      createdAtLabel: '10:33'
    })
  ]
}

const renderRoom = async ({
  enableAvatarNavigation = true,
  enableInteractionResponse = true,
  language = 'en',
  room = fixtureRoom
}: {
  enableAvatarNavigation?: boolean
  enableInteractionResponse?: boolean
  language?: string
  room?: AgentRoomViewModel
} = {}) => {
  const i18n = await createI18n(language)

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AgentRoomTranscript
        room={room}
        onOpenHostSession={enableAvatarNavigation ? () => undefined : undefined}
        onOpenRun={enableAvatarNavigation ? () => undefined : undefined}
        onRespondInteraction={enableInteractionResponse ? () => undefined : undefined}
        onSelectHostTarget={enableAvatarNavigation ? () => undefined : undefined}
        onSelectMemberTarget={enableAvatarNavigation ? () => undefined : undefined}
      />
    </I18nextProvider>
  )
}

const getMessageMarkup = (html: string, messageId: string) => {
  const marker = `id="message-${messageId}"`
  const markerIndex = html.indexOf(marker)
  expect(markerIndex).toBeGreaterThanOrEqual(0)

  const start = html.lastIndexOf('<', markerIndex)
  const nextArticleIndex = html.indexOf('<article id="message-', markerIndex + marker.length)
  const nextSystemIndex = html.indexOf('<div id="message-', markerIndex + marker.length)
  const endCandidates = [nextArticleIndex, nextSystemIndex].filter(index => index >= 0)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : html.length

  return html.slice(start, end)
}

const expectContains = (html: string, values: string[]) => {
  for (const value of values) expect(html).toContain(value)
}

const expectNotContains = (html: string, values: string[]) => {
  for (const value of values) expect(html).not.toContain(value)
}

const noop = () => undefined
const htmlEntityText: Record<string, string> = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
  '&semi;': ';'
}
const createMockHtmlElement = () => {
  let textContent = ''

  return {
    get innerHTML() {
      return textContent
    },
    set innerHTML(value: string) {
      textContent = htmlEntityText[value] ?? value
    },
    get textContent() {
      return textContent
    },
    set textContent(value: string) {
      textContent = value
    }
  }
}
const modelOption = {
  value: 'gpt-5',
  title: 'GPT-5',
  aliases: [],
  modelName: 'gpt-5',
  tooltipLines: [],
  searchText: 'gpt-5',
  displayLabel: 'GPT-5',
  canToggleRecommendation: false,
  isRecommended: false,
  isUserRecommended: false,
  label: 'GPT-5'
}
const adapterOption = (value: string, label: string) => ({
  value,
  label,
  displayLabel: label,
  kind: 'builtin' as const,
  searchText: `${value} ${label}`
})
const sessionFixture: Session = {
  id: 'sess-existing',
  title: 'Existing session',
  createdAt: 1,
  status: 'completed',
  model: 'gpt-5',
  adapter: 'codex',
  permissionMode: 'default'
}

const renderChatHistoryShell = async ({
  agentRoomSourceMembers,
  embeddedSessionChrome = false,
  language = 'en',
  isAgentRoomSession = false,
  messages = [],
  roomMode,
  session = sessionFixture
}: {
  agentRoomSourceMembers?: AgentRoomMemberView[]
  embeddedSessionChrome?: boolean
  language?: string
  isAgentRoomSession?: boolean
  messages?: ChatMessage[]
  roomMode: boolean
  session?: Session
}) => {
  const documentElement = {
    classList: {
      contains: () => false
    }
  }
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
    clear: noop
  })
  vi.stubGlobal('document', {
    documentElement,
    addEventListener: noop,
    removeEventListener: noop,
    createElement: createMockHtmlElement
  })
  vi.stubGlobal('window', {
    addEventListener: noop,
    removeEventListener: noop,
    getComputedStyle: () => ({
      getPropertyValue: () => ''
    })
  })
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  const { ChatHistoryView } = await import('#~/components/chat/ChatHistoryView')
  const i18n = await createI18n(language)

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AntApp>
        <MemoryRouter>
          <ChatHistoryView
            embeddedSessionChrome={embeddedSessionChrome}
            isReady
            isAgentRoomSession={isAgentRoomSession}
            agentRoomSourceMembers={agentRoomSourceMembers}
            messages={messages}
            session={roomMode ? undefined : session}
            sessionInfo={null}
            historyStatusNotices={[]}
            queuedMessages={{ steer: [], next: [] }}
            onRetryConnection={noop}
            interactionRequest={null}
            onInteractionResponse={noop}
            setMessages={noop}
            onClearMessages={noop}
            builtinPreviewModelOptions={[modelOption]}
            modelMenuGroups={[]}
            modelSearchOptions={[modelOption]}
            recommendedModelOptions={[modelOption]}
            servicePreviewModelOptions={[modelOption]}
            onToggleRecommendedModel={noop}
            selectedModel='gpt-5'
            onModelChange={noop}
            effort='default'
            effortOptions={[
              { value: 'default', label: 'Default' },
              { value: 'high', label: 'High' }
            ]}
            onEffortChange={noop}
            permissionMode='default'
            permissionModeOptions={[
              { value: 'default', label: 'Default' },
              { value: 'plan', label: 'Plan' }
            ]}
            onPermissionModeChange={noop}
            selectedAdapter='codex'
            adapterOptions={[
              adapterOption('codex', 'Codex'),
              adapterOption('claude-code', 'Claude Code')
            ]}
            hiddenBuiltinAdapterOptions={[]}
            onAdapterChange={noop}
            selectedAccount='primary'
            accountOptions={[{ value: 'primary', label: 'Primary account' }]}
            showAccountSelector
            onAccountChange={noop}
            modelUnavailable={false}
            hasAvailableModels
            agentRoomTranscript={roomMode
              ? {
                room: fixtureRoom,
                members: fixtureRoom.members,
                workspaceSessionId: 'sess-host-room-plan',
                onSubmitMessage: noop
              }
              : undefined}
          />
        </MemoryRouter>
      </AntApp>
    </I18nextProvider>
  )
}

const noopNavigation = {
  activeKey: null,
  setActiveKey: noop,
  registerItem: () => noop,
  focusKey: noop,
  moveFocus: () => null,
  focusFirst: () => null,
  focusLast: () => null
}

const toolbarState: SenderToolbarState = {
  isInlineEdit: false,
  isThinking: false,
  modelUnavailable: false,
  sendBlocked: false,
  showConfirmInteractionAction: false,
  adapterLocked: false,
  submitLoading: false,
  stopLoading: false,
  supportsEffort: true,
  canOpenReferenceActions: true,
  showModelSelect: true,
  showEffortSelect: true,
  showReferenceActions: true,
  showPermissionActions: false,
  hideReferenceActions: false,
  hideSelectionControls: false,
  hideSubmitAction: false,
  modelSearchValue: '',
  selectedModel: 'gpt-5',
  effort: 'default',
  fastMode: false,
  supportsFastMode: false,
  permissionMode: 'default',
  selectedAdapter: 'codex',
  selectedAccount: 'primary',
  showAccountSelector: true,
  isMac: false,
  resolvedSendShortcut: 'Enter',
  hasComposerContent: false,
  hasSendText: false,
  queueMode: 'steer',
  showQueueModeControl: false
}

const toolbarData: SenderToolbarData = {
  builtinPreviewModelOptions: [modelOption],
  modelMenuGroups: [],
  modelSearchOptions: [modelOption],
  recommendedModelOptions: [modelOption],
  servicePreviewModelOptions: [modelOption],
  effortOptions: [{ value: 'default', label: 'Default' }],
  permissionModeOptions: [],
  adapterOptions: [adapterOption('codex', 'Codex')],
  hiddenBuiltinAdapterOptions: [],
  accountOptions: [{ value: 'primary', label: 'Primary account' }],
  composerControlShortcuts: {
    switchModel: '',
    switchEffort: '',
    switchPermissionMode: '',
    queueSteer: '',
    queueNext: ''
  }
}

const toolbarRefs: SenderToolbarRefs = {
  fileInputRef: { current: null },
  modelSelectRef: { current: null },
  effortSelectRef: { current: null },
  referenceMenuNavigation: noopNavigation,
  permissionMenuNavigation: noopNavigation
}

const toolbarHandlers: SenderToolbarHandlers = {
  onImageFileChange: noop,
  onReferenceOpenChange: noop,
  onShowModelSelectChange: noop,
  onShowEffortSelectChange: noop,
  onPermissionOpenChange: noop,
  onModelSearchValueChange: noop,
  onOpenContextPicker: noop,
  onReferenceImageSelect: noop,
  onSelectPermissionMode: noop,
  onReferenceMenuKeyDown: noop,
  onPermissionMenuKeyDown: noop,
  onOpenModelSelector: noop,
  onOpenEffortSelector: noop,
  onQueueTextareaFocusRestore: noop,
  onCloseReferenceActions: noop,
  onSend: noop,
  onInterrupt: noop
}

const renderAgentRoomSenderHeader = async ({
  input,
  room = fixtureRoom,
  showPermissionControl = false
}: {
  input: string
  room?: AgentRoomViewModel
  showPermissionControl?: boolean
}) => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: noop,
    removeItem: noop,
    clear: noop
  })
  const { SenderHeaderControls } = await import(
    '#~/components/chat/sender/@components/sender-header-controls/SenderHeaderControls'
  )
  const i18n = await createI18n()

  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <SenderHeaderControls
          isInlineEdit={false}
          toolbarState={{
            ...toolbarState,
            showPermissionActions: false
          }}
          toolbarData={{
            ...toolbarData,
            permissionModeOptions: showPermissionControl
              ? [
                { value: 'default', label: 'Default' },
                { value: 'plan', label: 'Plan' }
              ]
              : []
          }}
          toolbarRefs={toolbarRefs}
          toolbarHandlers={toolbarHandlers}
          input={input}
          agentRoomTargetMembers={room.members}
        />
      </MemoryRouter>
    </I18nextProvider>
  )
}

describe('agent room transcript rendering', () => {
  it('renders the room transcript as chat bubbles without standalone room chrome', async () => {
    const html = await renderRoom()

    expectContains(
      html,
      'agent-room-transcript agent-room-message-list--transcript agent-room-bubble--user agent-room-bubble--agent agent-room-bubble--system'
        .split(' ')
    )
    expectContains(html, [
      'Please coordinate the room page implementation.',
      'class="agent-room-bubble__author agent-room-bubble__author-button"',
      '>leader</button>',
      'agent-room-bubble--leader',
      'agent-room-bubble__content-shell',
      'agent-room-bubble__content--targeted',
      'agent-room-bubble__content-text',
      'agent-room-bubble__content-text--markdown',
      'markdown-body',
      'class="agent-room-bubble__mention agent-room-bubble__mention-button"',
      '>@architect</button>',
      '>architect</button>'
    ])
    expectNotContains(html, [
      'agent-room-transcript__approval-summary',
      'agent-room-transcript__approval-action'
    ])
    expectNotContains(html, [
      '<span class="agent-room-bubble__author">@host</span>',
      '<span class="agent-room-bubble__author">@architect</span>'
    ])
    expectNotContains(html, 'agent-room-view__header agent-room-roster agent-room-composer'.split(' '))
  })

  it('keeps leader avatar opening the host session while the leader name resets the composer target', async () => {
    const html = await renderRoom()
    const assignmentMessage = getMessageMarkup(html, 'msg-host-assignment')

    expectContains(assignmentMessage, [
      'class="agent-room-bubble__avatar agent-room-bubble__avatar-button"',
      'aria-label="Open host session"',
      'title="Open host session"',
      'class="agent-room-bubble__author agent-room-bubble__author-button"',
      'aria-label="leader"',
      '>leader</button>',
      'class="agent-room-bubble__mention agent-room-bubble__mention-button"',
      'aria-label="Open run: schema-plan"',
      'title="Open run: schema-plan"',
      '>@architect</button>'
    ])
  })

  it('uses pixel avatars for room participants without configured avatar labels', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        members: fixtureRoom.members.map(({ avatarLabel: _avatarLabel, ...member }) => member)
      }
    })
    const assignmentMessage = getMessageMarkup(html, 'msg-host-assignment')
    const reviewerMessage = getMessageMarkup(html, 'msg-reviewer-failed')

    expectContains(assignmentMessage, [
      'agent-room-bubble__avatar--pixel',
      'class="room-pixel-avatar agent-room-bubble__avatar-pixel"',
      'style="--room-pixel-avatar-accent:'
    ])
    expectContains(reviewerMessage, [
      'agent-room-bubble__avatar--pixel',
      'class="room-pixel-avatar agent-room-bubble__avatar-pixel"',
      'style="--room-pixel-avatar-accent:'
    ])
  })

  it('renders target mentions on leader replies to child runs', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          ...fixtureRoom.messages,
          createMessage('msg-host-child-reply', 'agent', 'message', 'I approved the child request.', {
            memberKey: 'host:sess-host-room-plan',
            runKey: 'run:schema-plan',
            targetLabel: '@architect/schema-plan',
            reactions: [{
              kind: 'working',
              agentLabel: 'architect',
              run: createRun('run:schema-plan', 'member:architect', 'sess-schema-plan', 'schema-plan', 'running')
            }],
            createdAtLabel: '10:42'
          })
        ]
      }
    })
    const leaderReply = getMessageMarkup(html, 'msg-host-child-reply')

    expectContains(leaderReply, [
      'agent-room-bubble--leader',
      '>leader</button>',
      'class="agent-room-bubble__mention agent-room-bubble__mention-button"',
      'aria-label="Open run: schema-plan"',
      '>@architect/schema-plan</button>',
      'agent-room-bubble__reaction agent-room-bubble__reaction--working',
      'class="agent-room-bubble__reaction-emoji"',
      '👀',
      'class="agent-room-bubble__reaction-agent agent-room-bubble__reaction-agent-button"',
      'aria-label="Open @architect session"',
      '>@architect</button>',
      'I approved the child request.'
    ])
  })

  it('renders quoted source messages inside agent replies', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          ...fixtureRoom.messages,
          createMessage('msg-host-status-reply', 'agent', 'message', 'Both child runs are completed.', {
            memberKey: 'host:sess-host-room-plan',
            replyTo: {
              id: 'msg-user-start',
              role: 'user',
              content: 'Please coordinate the room page implementation.'
            },
            createdAtLabel: '10:50'
          })
        ]
      }
    })
    const leaderReply = getMessageMarkup(html, 'msg-host-status-reply')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const quoteStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__quote {'),
      styles.indexOf('.agent-room-bubble__content {')
    )

    expectContains(leaderReply, [
      'agent-room-bubble--leader',
      'class="agent-room-bubble__quote"',
      'href="#message-msg-user-start"',
      'aria-label="Replying to You: Please coordinate the room page implementation."',
      'class="agent-room-bubble__quote-author">You</span>',
      'class="agent-room-bubble__quote-text">Please coordinate the room page implementation.</span>',
      'Both child runs are completed.'
    ])
    expectContains(quoteStyles, [
      '.agent-room-bubble__quote {',
      '&::before {',
      'inset-inline-start: 7px;',
      'width: 3px;',
      'text-decoration: none;',
      '.agent-room-bubble__quote-author {',
      '.agent-room-bubble__quote-text {',
      '-webkit-line-clamp: 2;'
    ])
  })

  it('renders projected child replies as visible member messages', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          ...fixtureRoom.messages,
          createMessage('msg-reviewer-direct-question', 'user', 'message', 'hi?', {
            memberKey: 'member:reviewer',
            runKey: 'run:release-check',
            targetLabel: '@reviewer/release-check-with-long-name-that-should-not-dominate-the-bubble',
            createdAtLabel: '10:51'
          }),
          createMessage(
            'child-message:sess-release-check:msg-reviewer-direct-reply',
            'agent',
            'reply',
            'I am here.',
            {
              memberKey: 'member:reviewer',
              runKey: 'run:release-check',
              replyTo: {
                id: 'msg-reviewer-direct-question',
                role: 'user',
                content: 'hi?'
              },
              createdAtLabel: '10:52'
            }
          )
        ]
      }
    })
    const reviewerReply = getMessageMarkup(html, 'child-message:sess-release-check:msg-reviewer-direct-reply')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const childReplyQuoteStyles = styles.slice(
      styles.indexOf(
        '.agent-room-bubble__surface > .agent-room-bubble__quote {'
      ),
      styles.indexOf('.agent-room-bubble__quote-author {')
    )
    const compactMessageSurfaceStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__surface,'),
      styles.indexOf('.agent-room-bubble--status-waiting .agent-room-bubble__surface {')
    )
    const targetedContentStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__content--targeted {'),
      styles.indexOf('.agent-room-bubble__content-text {')
    )
    const reviewerQuestion = getMessageMarkup(html, 'msg-reviewer-direct-question')

    expectContains(reviewerReply, [
      'agent-room-bubble--agent',
      'agent-room-bubble--reply',
      'agent-room-bubble--has-quote',
      'class="agent-room-bubble__surface"',
      '>reviewer</button>',
      'aria-label="Replying to You: hi?"',
      'class="agent-room-bubble__quote"',
      'href="#message-msg-reviewer-direct-question"',
      'class="agent-room-bubble__quote-author">You</span>',
      'class="agent-room-bubble__quote-text">hi?</span>',
      'I am here.'
    ])
    expectContains(reviewerQuestion, [
      'agent-room-bubble--user',
      'agent-room-bubble__content--targeted',
      '>@reviewer/release-check-with-long-name-that-should-not-dominate-the-bubble</button>',
      'hi?'
    ])
    expectContains(childReplyQuoteStyles, [
      '.agent-room-bubble__surface > .agent-room-bubble__quote {',
      'box-sizing: border-box;',
      'display: block;',
      'inline-size: calc(',
      '100% + var(--agent-room-bubble-surface-padding-inline) +',
      'min-inline-size: 280px;',
      'max-inline-size: calc(',
      'margin: calc(-1 * var(--agent-room-bubble-surface-padding-block))',
      'calc(-1 * var(--agent-room-bubble-surface-padding-inline)) 0;',
      'border-top-left-radius: 9px;',
      'border-top-right-radius: 9px;',
      '@media (max-width: 520px) {',
      'min-inline-size: min(240px, calc(100vw - 96px));',
      'max-inline-size: min(',
      'calc(100vw - 96px)'
    ])
    expectContains(compactMessageSurfaceStyles, [
      '.agent-room-bubble--user .agent-room-bubble__surface,',
      '.agent-room-bubble--agent:not(.agent-room-bubble--leader):not(.agent-room-bubble--interaction-request):not(.agent-room-bubble--approval-batch)',
      '--agent-room-bubble-surface-gap: 6px;',
      '--agent-room-bubble-surface-padding-block: 6px;',
      '--agent-room-bubble-surface-padding-inline: 8px;',
      '--agent-room-bubble-content-gap: 6px;'
    ])
    expectNotContains(compactMessageSurfaceStyles, [
      '.agent-room-bubble--has-quote',
      'padding: 6px 8px;'
    ])
    expectContains(targetedContentStyles, [
      '.agent-room-bubble__content--targeted {',
      'gap: var(--agent-room-bubble-content-gap);'
    ])
    expectNotContains(reviewerReply, [
      '@reviewer/release-check-with-long-name-that-should-not-dominate-the-bubble',
      'agent-room-bubble__mention'
    ])
  })

  it('renders projected leader interaction requests as actionable cards', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          createMessage(
            'host-interaction:sess-host:codex-approval-2',
            'agent',
            'attention',
            'Allow Bash to poll child runs?',
            {
              memberKey: 'host:sess-host',
              createdAtLabel: '10:53',
              interactionRequest: {
                sessionId: 'sess-host',
                interactionId: 'codex-approval:2',
                requestKind: 'confirmation',
                status: 'pending',
                subjectLabel: 'Bash',
                options: [
                  { label: 'Allow once', value: 'allow_once', description: 'Only this command.' },
                  { label: 'Allow session', value: 'allow_session' },
                  { label: 'Allow project', value: 'allow_project' },
                  { label: 'Deny once', value: 'deny_once' },
                  { label: 'Deny session', value: 'deny_session' },
                  { label: 'Deny project', value: 'deny_project' }
                ]
              }
            }
          )
        ]
      }
    })
    const interactionRequest = getMessageMarkup(html, 'host-interaction:sess-host:codex-approval-2')

    expectContains(interactionRequest, [
      'agent-room-bubble--interaction-request',
      'agent-room-interaction-request agent-room-interaction-request--pending',
      'Requesting permission to use 【Bash】. Choose how to proceed.',
      'Pending',
      'Confirmation',
      'Allow Bash to poll child runs?',
      'aria-label="Available responses"',
      'agent-room-interaction-request__option--allow',
      '>task_alt</span>',
      '>Allow once</span>',
      'Only this command.',
      '>history_toggle_off</span>',
      '>Allow session</span>',
      'agent-room-interaction-request__option--deny',
      '>cancel</span>',
      '>Deny once</span>',
      'agent-room-interaction-request__option-toggle',
      'Show more options'
    ])
    expectNotContains(interactionRequest, [
      '>Allow project</span>',
      '>Deny session</span>',
      '>Deny project</span>',
      '>folder_managed</span>',
      '>block</span>',
      '>folder_off</span>'
    ])
  })

  it('renders bash interaction requests with structured command details', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          createMessage(
            'host-interaction:sess-host:codex-approval-bash',
            'agent',
            'attention',
            '允许执行命令 `/bin/zsh -lc "sleep 2 && pnpm test -- --runInBand"`?',
            {
              memberKey: 'host:sess-host',
              interactionRequest: {
                sessionId: 'sess-host',
                interactionId: 'codex-approval:bash',
                requestKind: 'confirmation',
                status: 'pending',
                subjectLabel: 'Bash',
                options: [
                  { label: 'Allow once', value: 'allow_once' },
                  { label: 'Deny once', value: 'deny_once' }
                ]
              }
            }
          )
        ]
      }
    })
    const interactionRequest = getMessageMarkup(html, 'host-interaction:sess-host:codex-approval-bash')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const commandPanelStyles = styles.slice(
      styles.indexOf('.agent-room-interaction-request__structured-question {'),
      styles.indexOf('.agent-room-interaction-request__options {')
    )

    expectContains(interactionRequest, [
      'agent-room-interaction-request agent-room-interaction-request--pending',
      'Requesting permission to use 【Bash】. Choose how to proceed.',
      'Pending',
      'Confirmation',
      'Review this command before allowing execution.',
      'agent-room-interaction-request__command-panel',
      'agent-room-interaction-request__command-header',
      'Command',
      'Shell: /bin/zsh',
      'Arguments: -lc',
      'Script content',
      'sleep 2 &amp;&amp; pnpm test -- --runInBand',
      'Full command',
      '/bin/zsh -lc',
      'aria-label="Available responses"',
      '>Allow once</span>',
      '>Deny once</span>'
    ])
    expectNotContains(interactionRequest, [
      '允许执行命令 `',
      '`?'
    ])
    expectContains(commandPanelStyles, [
      '.agent-room-interaction-request__command-panel {',
      'overflow: hidden;',
      '.agent-room-interaction-request__command-code {',
      'overflow: auto;',
      'max-height: 168px;',
      'font-family: var(--font-mono);',
      'white-space: pre;',
      '.agent-room-interaction-request__command-details {'
    ])
  })

  it('renders handled leader interaction requests without response buttons', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          createMessage('host-interaction:sess-host:codex-approval-3', 'agent', 'attention', 'Allow edit?', {
            memberKey: 'host:sess-host',
            interactionRequest: {
              sessionId: 'sess-host',
              interactionId: 'codex-approval:3',
              requestKind: 'confirmation',
              status: 'handled',
              response: 'allow_once',
              options: [{ label: 'Allow once', value: 'allow_once' }]
            }
          })
        ]
      }
    })
    const interactionRequest = getMessageMarkup(html, 'host-interaction:sess-host:codex-approval-3')

    expectContains(interactionRequest, [
      'agent-room-interaction-request agent-room-interaction-request--handled',
      'Handled',
      'Responded: allow_once'
    ])
    expectNotContains(interactionRequest, [
      'agent-room-interaction-request__option',
      '>Allow once</span>'
    ])
  })

  it('stretches long agent summaries to the message row edge', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          ...fixtureRoom.messages,
          createMessage(
            'msg-host-long-summary',
            'agent',
            'message',
            'Both child tasks are completed. The relevant roomId is room_59990213-3770-4369-9a15-4c4d50bb3992, the dev session is sess_a2846388-8166-4976-965f-a003ad5f74db, and the qa session is sess_ab7c15ba-d27b-4a76-b604-a57c0164ba6b.',
            {
              memberKey: 'host:sess-host-room-plan',
              runKey: 'run:host-room-plan',
              createdAtLabel: '10:50'
            }
          )
        ]
      }
    })
    const longLeaderMessage = getMessageMarkup(html, 'msg-host-long-summary')
    const shortAssignmentMessage = getMessageMarkup(html, 'msg-host-assignment')
    const bubbleSource = readFileSync(
      new URL('../src/components/agent-room/@components/AgentRoomBubble.tsx', import.meta.url),
      'utf8'
    )
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )

    expectContains(longLeaderMessage, [
      'agent-room-bubble--leader',
      'agent-room-bubble--wide-content',
      'Both child tasks are completed.'
    ])
    expectNotContains(shortAssignmentMessage, [
      'agent-room-bubble--wide-content'
    ])
    expectContains(bubbleSource, [
      'const shouldUseWideSurface = (',
      "if (message.kind === 'completion') return false",
      'content.length >= 120 || content.includes',
      "isWideSurface ? 'agent-room-bubble--wide-content' : ''"
    ])
    expectContains(styles, [
      'box-sizing: border-box;',
      '.agent-room-bubble--wide-content .agent-room-bubble__surface {',
      'width: 100%;',
      '.agent-room-bubble--completion .agent-room-bubble__surface {',
      'max-width: min(100%, 520px);'
    ])
  })

  it('renders repeated approval requests as a collapsible approval queue', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          createMessage('approval-batch:msg-approval-3', 'agent', 'attention', 'Approval queue', {
            memberKey: 'member:architect',
            runKey: 'run:schema-plan',
            createdAtLabel: '10:45',
            approvalBatch: {
              totalCount: 3,
              pendingCount: 1,
              handledCount: 2,
              actionCount: 2,
              memberLabel: '@architect',
              runTitle: 'schema-plan',
              latest: {
                id: 'msg-approval-3',
                content: 'Allow current read-only command?',
                createdAtLabel: '10:45',
                interactionId: 'approval-3',
                status: 'pending',
                optionLabels: ['Allow once (allow_once)', 'Deny once (deny_once)']
              },
              items: [
                {
                  id: 'msg-approval-1',
                  content: 'Allow first read-only command?',
                  createdAtLabel: '10:41',
                  interactionId: 'approval-1',
                  status: 'handled',
                  optionLabels: ['Allow once (allow_once)']
                },
                {
                  id: 'msg-approval-2',
                  content: 'Allow second read-only command?',
                  createdAtLabel: '10:43',
                  interactionId: 'approval-2',
                  status: 'handled',
                  optionLabels: ['Allow session (allow_session)']
                },
                {
                  id: 'msg-approval-3',
                  content: 'Allow current read-only command?',
                  createdAtLabel: '10:45',
                  interactionId: 'approval-3',
                  status: 'pending',
                  optionLabels: ['Allow once (allow_once)', 'Deny once (deny_once)']
                }
              ],
              actions: [
                {
                  id: 'msg-host-approval-1',
                  content: 'Approved approval-1 for architect.',
                  createdAtLabel: '10:42',
                  interactionIds: []
                },
                {
                  id: 'msg-host-approval-2',
                  content: '已代为批准 `codex-approval:2`。',
                  createdAtLabel: '10:44',
                  interactionIds: ['codex-approval:2']
                }
              ]
            }
          })
        ]
      }
    })
    const approvalBatch = getMessageMarkup(html, 'approval-batch:msg-approval-3')
    const bubbleSource = readFileSync(
      new URL('../src/components/agent-room/@components/AgentRoomBubble.tsx', import.meta.url),
      'utf8'
    )
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )

    expectContains(approvalBatch, [
      'agent-room-bubble--approval-batch',
      'agent-room-approval-batch',
      '>Approval queue</div>',
      '@architect / schema-plan',
      'class="agent-room-approval-batch__metric" aria-label="3 requests" title="3 requests"',
      '>rule</span>',
      'class="agent-room-approval-batch__metric" aria-label="1 pending" title="1 pending"',
      '>pending_actions</span>',
      'class="agent-room-approval-batch__metric" aria-label="2 handled" title="2 handled"',
      '>check_circle</span>',
      'class="agent-room-approval-batch__metric" aria-label="2 leader actions" title="2 leader actions"',
      '>done_all</span>',
      'class="agent-room-approval-batch__history-toggle" aria-label="5 history items" title="5 history items" aria-expanded="false"',
      '>Current request</span>',
      '>Pending</span>',
      'Allow current read-only command?'
    ])
    expectNotContains(approvalBatch, [
      'Allow once (allow_once)',
      'Deny once (deny_once)',
      'agent-room-approval-batch__options',
      '<details class="agent-room-approval-batch__history">',
      '>5 history items</span>',
      '>Handled by leader</span>',
      'Approved approval-1 for architect.',
      'codex-approval:2',
      'approval-1',
      'Allow first read-only command?',
      'agent-room-bubble__expand'
    ])
    expectContains(bubbleSource, [
      'const isApprovalBatch = message.approvalBatch != null',
      'const canCollapseContent = !isApprovalBatch',
      'const shouldRenderContentToggle = canCollapseContent && isContentOverflowing',
      "isApprovalBatch ? 'agent-room-bubble--approval-batch' : ''",
      "shouldRenderContentToggle ? 'agent-room-bubble--content-overflowing' : ''",
      '{shouldRenderContentToggle && ('
    ])
    expectContains(styles, [
      '.agent-room-bubble--approval-batch .agent-room-bubble__surface {',
      'width: 100%;',
      '.agent-room-approval-batch {',
      'width: 100%;',
      'min-width: 0;'
    ])
  })

  it('collapses handled approval queue details by default', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: [
          createMessage('approval-batch:msg-approval-2', 'agent', 'message', 'Approval queue', {
            memberKey: 'member:architect',
            runKey: 'run:schema-plan',
            createdAtLabel: '10:45',
            approvalBatch: {
              totalCount: 2,
              pendingCount: 0,
              handledCount: 2,
              actionCount: 1,
              memberLabel: '@architect',
              runTitle: 'schema-plan',
              latest: {
                id: 'msg-approval-2',
                content: 'Allow completed read-only command?',
                createdAtLabel: '10:45',
                interactionId: 'approval-2',
                status: 'handled',
                optionLabels: []
              },
              items: [
                {
                  id: 'msg-approval-1',
                  content: 'Allow first read-only command?',
                  createdAtLabel: '10:41',
                  interactionId: 'approval-1',
                  status: 'handled',
                  optionLabels: []
                },
                {
                  id: 'msg-approval-2',
                  content: 'Allow completed read-only command?',
                  createdAtLabel: '10:45',
                  interactionId: 'approval-2',
                  status: 'handled',
                  optionLabels: []
                }
              ],
              actions: [
                {
                  id: 'msg-host-approval-1',
                  content: 'Approved approval-1 for architect.',
                  createdAtLabel: '10:42',
                  interactionIds: ['codex-approval:1']
                }
              ]
            }
          })
        ]
      }
    })
    const approvalBatch = getMessageMarkup(html, 'approval-batch:msg-approval-2')

    expectContains(approvalBatch, [
      'agent-room-approval-batch',
      'class="agent-room-approval-batch__history-toggle" aria-label="3 history items" title="3 history items" aria-expanded="false"',
      'class="agent-room-approval-batch__metric" aria-label="0 pending" title="0 pending"',
      'class="agent-room-approval-batch__metric" aria-label="2 handled" title="2 handled"'
    ])
    expectNotContains(approvalBatch, [
      'agent-room-approval-batch__current',
      '>Latest request</span>',
      '>Handled</span>',
      'Allow completed read-only command?',
      'Approved approval-1 for architect.',
      'codex-approval:1'
    ])
  })

  it('keeps participant click routing split between subagent composer targets, leader default target, and @tag run links', async () => {
    const html = await renderRoom()
    const assignmentMessage = getMessageMarkup(html, 'msg-host-assignment')
    const architectMessage = getMessageMarkup(html, 'msg-architect-attention')
    const bubbleSource = readFileSync(
      new URL('../src/components/agent-room/@components/AgentRoomBubble.tsx', import.meta.url),
      'utf8'
    )
    const historySource = readFileSync(
      new URL('../src/components/chat/ChatHistoryView.tsx', import.meta.url),
      'utf8'
    )

    expectContains(assignmentMessage, [
      'class="agent-room-bubble__avatar agent-room-bubble__avatar-button"',
      'aria-label="Open host session"',
      'title="Open host session"',
      'class="agent-room-bubble__author agent-room-bubble__author-button"',
      'aria-label="leader"',
      '>leader</button>',
      'aria-label="Open run: schema-plan"',
      '>@architect</button>'
    ])
    expectContains(architectMessage, [
      'class="agent-room-bubble__author agent-room-bubble__author-button"',
      'aria-label="architect"',
      '>architect</button>'
    ])
    expectContains(bubbleSource, [
      'const canOpenHostSession = isLeaderMessage && onOpenHostSession != null',
      'const canSelectHostTarget = isLeaderMessage && onSelectHostTarget != null',
      'const canSelectMemberTarget = !isLeaderMessage && message.member != null && onSelectMemberTarget != null',
      'const canSelectReplyTarget = !isLeaderMessage && !canSelectMemberTarget && run != null && onReplyToRun != null',
      'onClick={handleSelectHostTarget}',
      'onClick={handleSelectMemberTarget}',
      'onClick={handleOpenSenderSession}',
      'onClick={handleOpenRun}'
    ])
    expectContains(historySource, [
      'getAgentRoomMemberMention',
      'setAgentRoomComposerTarget({',
      'handleSelectAgentRoomHostTarget',
      'content: []',
      'onSelectHostTarget={handleSelectAgentRoomHostTarget}',
      "content: [{ type: 'text', text:",
      'onSelectMemberTarget={handleSelectAgentRoomMemberTarget}'
    ])
  })

  it('does not render an author row for self messages', async () => {
    const html = await renderRoom()
    const userMessage = getMessageMarkup(html, 'msg-user-start')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const userBubbleStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--user {'),
      styles.indexOf('.agent-room-bubble--agent,')
    )
    const userExpandStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__expand {'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__content {')
    )
    const userMentionStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__mention {'),
      styles.indexOf('.agent-room-bubble__expand {')
    )

    expect(userMessage).toContain('agent-room-bubble--user')
    expect(userMessage).toContain('Please coordinate the room page implementation.')
    expect(userMessage).not.toContain('agent-room-bubble__meta')
    expect(userMessage).not.toContain('agent-room-bubble__author')
    expect(userMessage).not.toContain('>You<')
    expectContains(userBubbleStyles, [
      'align-self: flex-end;',
      'justify-content: flex-end;',
      'max-width: calc(100% - var(--agent-room-bubble-avatar-gutter));'
    ])
    expectContains(styles, [
      '--agent-room-bubble-avatar-size: 34px;',
      '--agent-room-bubble-gap: 10px;',
      'gap: var(--agent-room-bubble-gap);'
    ])
    expectContains(userExpandStyles, [
      '.agent-room-bubble--user .agent-room-bubble__expand {',
      'border-color: color-mix(in srgb, #ffffff 46%, transparent);',
      'background: color-mix(in srgb, #ffffff 16%, transparent);',
      'color: #ffffff;',
      '.agent-room-bubble--user .agent-room-bubble__expand:hover,',
      '#ffffff 72%',
      '#ffffff 28%'
    ])
    expectContains(userMentionStyles, [
      '.agent-room-bubble--user .agent-room-bubble__mention {',
      'background: color-mix(in srgb, #ffffff 90%, transparent);',
      'color: color-mix(in srgb, var(--primary-color) 82%, #000000);',
      '.agent-room-bubble--user .agent-room-bubble__mention-button:hover,',
      'background: #ffffff;'
    ])
  })

  it('renders delivered room user messages with a working reaction', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: fixtureRoom.messages.map(message =>
          message.id === 'msg-user-start'
            ? {
              ...message,
              reactions: [{
                kind: 'working',
                agentLabel: 'room-smoke-qa',
                run: createRun('run:qa', 'member:reviewer', 'sess-qa', 'qa', 'running')
              }]
            }
            : message
        )
      }
    })
    const userMessage = getMessageMarkup(html, 'msg-user-start')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const reactionStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__reaction {'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__reaction {')
    )
    const userReactionStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__reaction {'),
      styles.indexOf('.agent-room-bubble__reaction-emoji {')
    )
    const reactionAgentStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__reaction-agent {'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__reaction-agent {')
    )

    expectContains(userMessage, [
      'agent-room-bubble--has-reactions',
      'agent-room-bubble__reactions',
      'agent-room-bubble__reaction agent-room-bubble__reaction--working',
      'class="agent-room-bubble__reaction-emoji"',
      '👀',
      'class="agent-room-bubble__reaction-agent agent-room-bubble__reaction-agent-button"',
      'aria-label="Open @room-smoke-qa session"',
      '>@room-smoke-qa</button>'
    ])
    expectContains(styles, [
      '.agent-room-bubble__reactions {',
      'align-self: flex-start;',
      '.agent-room-bubble__reaction-agent-button {'
    ])
    expectContains(reactionStyles, [
      'padding: 3px 8px;',
      'border-radius: 8px;',
      'var(--primary-color) 18%',
      'var(--bg-color) 88%'
    ])
    expectContains(userReactionStyles, [
      '#ffffff 58%',
      '#ffffff 86%',
      'var(--primary-color) 88%'
    ])
    expectContains(reactionAgentStyles, [
      'padding-inline-start: 7px;',
      'border-inline-start: 1px solid',
      'currentColor 20%'
    ])
    expectNotContains(reactionStyles, [
      'border-radius: 999px;'
    ])
    expectNotContains(styles, [
      'inset-block-end: -13px;'
    ])
  })

  it('renders completed room message reactions with a check mark', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: fixtureRoom.messages.map(message =>
          message.id === 'msg-user-start'
            ? {
              ...message,
              reactions: [{
                kind: 'completed',
                agentLabel: 'room-smoke-qa',
                run: createRun('run:qa', 'member:reviewer', 'sess-qa', 'qa', 'completed')
              }]
            }
            : message
        )
      }
    })
    const userMessage = getMessageMarkup(html, 'msg-user-start')

    expectContains(userMessage, [
      'agent-room-bubble__reaction agent-room-bubble__reaction--completed',
      'aria-label="@room-smoke-qa completed"',
      'class="agent-room-bubble__reaction-emoji"',
      '✅',
      'class="agent-room-bubble__reaction-agent agent-room-bubble__reaction-agent-button"',
      'aria-label="Open @room-smoke-qa session"',
      '>@room-smoke-qa</button>'
    ])
  })

  it('omits bubble timestamps while keeping message row layout semantic', async () => {
    const html = await renderRoom()
    const userMessage = getMessageMarkup(html, 'msg-user-start')
    const agentMessage = getMessageMarkup(html, 'msg-host-assignment')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const userRowIndex = userMessage.indexOf('agent-room-bubble__message-row')
    const userSurfaceIndex = userMessage.indexOf('agent-room-bubble__surface')
    const agentMetaIndex = agentMessage.indexOf('agent-room-bubble__meta')
    const agentRowIndex = agentMessage.indexOf('agent-room-bubble__message-row')
    const agentSurfaceIndex = agentMessage.indexOf('agent-room-bubble__surface')
    const agentAlignmentStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--agent,'),
      styles.indexOf('.agent-room-bubble--system {')
    )
    const stackStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__stack {'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__stack {')
    )
    const agentStackStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--agent .agent-room-bubble__stack,'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__stack {')
    )
    const surfaceStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__surface {'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__surface {')
    )

    expect(userSurfaceIndex).toBeGreaterThan(userRowIndex)
    expect(agentRowIndex).toBeGreaterThan(agentMetaIndex)
    expect(agentSurfaceIndex).toBeGreaterThan(agentRowIndex)
    expectContains(styles, [
      '.agent-room-bubble__message-row {',
      'position: relative;',
      'display: flex;',
      'width: 100%;'
    ])
    expectContains(agentAlignmentStyles, ['align-self: stretch;'])
    expectContains(stackStyles, ['max-width: 100%;', 'min-width: 0;'])
    expectContains(agentStackStyles, ['flex: 1;'])
    expectContains(surfaceStyles, ['width: max-content;', 'max-width: 100%;'])
    expectContains(styles, [
      '.agent-room-bubble--content-overflowing .agent-room-bubble__surface {',
      'width: 100%;'
    ])
    expect(userMessage).not.toContain('<time')
    expect(agentMessage).not.toContain('<time')
    expect(userMessage).not.toContain('agent-room-bubble__time')
    expect(agentMessage).not.toContain('agent-room-bubble__time')
    expect(userMessage).not.toContain('tabindex="0"')
    expect(userMessage).not.toContain('aria-describedby="message-msg-user-start-time"')
    expect(agentMessage).not.toContain('aria-describedby="message-msg-host-assignment-time"')
    expect(styles).not.toContain('agent-room-bubble__time')
    expect(styles).not.toContain('max-width: 16ch')
    expect(styles).not.toContain('margin-inline-start .18s ease')
    expect(styles).not.toContain('margin-inline-start: 8px')
    expect(styles).not.toContain('margin-inline-end: 8px')
    expect(styles).not.toContain('margin-top .18s ease')
  })

  it('renders system messages as lightweight fixed-width notices without time', async () => {
    const html = await renderRoom()
    const systemMessage = getMessageMarkup(html, 'msg-system-host-joined')
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )

    expectContains(systemMessage, [
      'agent-room-bubble--system',
      'agent-room-bubble__system-surface',
      'Host joined the room'
    ])
    expectNotContains(systemMessage, ['agent-room-bubble__time', '<time', 'title="10:29"', 'tabindex'])
    expectContains(styles, ['width: min(360px, 72%);', 'border: 0;', 'background: transparent;'])
  })

  it.each([
    ['en', 'std/dev-planner joined the room', 'std/dev-planner 加入了房间'],
    ['zh', 'std/dev-planner 加入了房间', 'std/dev-planner joined the room']
  ])('renders member joined system messages for %s locale', async (language, expected, unexpected) => {
    const html = await renderRoom({
      language,
      room: {
        ...fixtureRoom,
        messages: [
          createMessage(
            'msg-system-planner-joined',
            'system',
            'system',
            'std/dev-planner joined the room',
            {
              systemMessage: {
                kind: 'memberJoined',
                memberLabel: 'std/dev-planner'
              }
            }
          )
        ]
      }
    })
    const systemMessage = getMessageMarkup(html, 'msg-system-planner-joined')

    expectContains(systemMessage, [expected])
    expectNotContains(systemMessage, [unexpected])
  })

  it('renders child attention as a neutral key message without direct approval actions', async () => {
    const html = await renderRoom()
    const attentionMessage = getMessageMarkup(html, 'msg-architect-attention')
    const attentionIndex = html.indexOf('agent-room-bubble--attention')
    const actionRowIndex = html.indexOf('agent-room-bubble__action-row', attentionIndex)

    expectContains(html, ['agent-room-bubble--attention', 'I need confirmation before editing schema files.'])
    expect(actionRowIndex).toBe(-1)
    expectContains(
      html,
      'agent-room-bubble--status-waiting data-status="waiting" agent-room-bubble__status-text agent-room-bubble__avatar-button agent-room-bubble__author-button'
        .split(' ')
    )
    expectContains(html, [
      'aria-label="Open run: schema-plan"',
      'title="Open run: schema-plan"'
    ])
    expectNotContains(
      attentionMessage,
      'agent-room-bubble__run-label agent-room-bubble__status-pill open_in_new agent-room-bubble__action--open-run agent-room-bubble__kind-icon agent-room-bubble__actions agent-room-bubble__action--ghost'
        .split(' ')
    )
    expectNotContains(attentionMessage, [
      '@architect/schema-plan',
      'Reply to run',
      '>Open run<',
      'Allow schema change',
      'Keep plan read-only'
    ])
  })

  it('does not render option actions on user bubbles even when user messages carry run options', async () => {
    const html = await renderRoom({
      room: {
        ...fixtureRoom,
        messages: fixtureRoom.messages.map(message =>
          message.id === 'msg-user-start'
            ? {
              ...message,
              options: [
                {
                  label: 'Approve',
                  value: 'approve',
                  description: 'Should not be shown on user messages.'
                }
              ]
            }
            : message
        )
      }
    })
    const userMessage = getMessageMarkup(html, 'msg-user-start')

    expect(userMessage).not.toContain('agent-room-bubble__action-row')
    expect(userMessage).not.toContain('Approve')
  })

  it('renders the author on the first message and avatar on the last message in a consecutive same-agent group', async () => {
    const html = await renderRoom()
    const firstArchitectMessage = getMessageMarkup(html, 'msg-architect-attention')
    const lastArchitectMessage = getMessageMarkup(html, 'msg-architect-complete')
    const reviewerMessage = getMessageMarkup(html, 'msg-reviewer-failed')

    expectContains(firstArchitectMessage, [
      'agent-room-bubble--avatar-hidden',
      'agent-room-bubble__avatar-spacer',
      'agent-room-bubble__author-button',
      'aria-label="architect"'
    ])
    expect(firstArchitectMessage).not.toContain('agent-room-bubble__avatar-button')
    expectContains(lastArchitectMessage, [
      'agent-room-bubble__avatar-button',
      'aria-label="Open run: billing-review"'
    ])
    expect(lastArchitectMessage).not.toContain('agent-room-bubble__author')
    expect(lastArchitectMessage).not.toContain('agent-room-bubble__meta')
    expect(lastArchitectMessage).not.toContain('agent-room-bubble--avatar-hidden')
    expect(lastArchitectMessage).not.toContain('agent-room-bubble__avatar-spacer')
    expect(reviewerMessage).toContain('agent-room-bubble__avatar-button')
    expect(reviewerMessage).not.toContain('agent-room-bubble--avatar-hidden')
  })

  it('keeps avatars non-clickable when no session navigation handler is available', async () => {
    const html = await renderRoom({ enableAvatarNavigation: false })

    expect(html).toContain('agent-room-bubble__avatar')
    expect(html).not.toContain('agent-room-bubble__avatar-button')
    expect(html).not.toContain('agent-room-bubble__author-button')
    expect(html).toContain('<span class="agent-room-bubble__author">leader</span>')
    expect(html).toContain('<span class="agent-room-bubble__mention">@architect</span>')
  })

  it('renders completion and failure bubbles without private child transcripts', async () => {
    const html = await renderRoom()
    const bubbleSource = readFileSync(
      new URL('../src/components/agent-room/@components/AgentRoomBubble.tsx', import.meta.url),
      'utf8'
    )
    const styles = readFileSync(
      new URL('../src/components/agent-room/AgentRoomView.scss', import.meta.url),
      'utf8'
    )
    const leaderSurfaceStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--leader .agent-room-bubble__surface,'),
      styles.indexOf('.agent-room-bubble--leader .agent-room-bubble__avatar {')
    )
    const leaderAvatarStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--leader .agent-room-bubble__avatar {'),
      styles.indexOf('.agent-room-bubble__status-text {')
    )
    const compactAgentSurfaceStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__surface,'),
      styles.indexOf('.agent-room-bubble--status-waiting .agent-room-bubble__surface {')
    )
    const roomEventSurfaceStyles = styles.slice(
      styles.indexOf('.agent-room-bubble--assignment .agent-room-bubble__surface,'),
      styles.indexOf('.agent-room-bubble--assignment.agent-room-bubble--status-waiting')
    )
    const expandStyles = styles.slice(
      styles.indexOf('.agent-room-bubble__expand {'),
      styles.indexOf('.agent-room-bubble--user .agent-room-bubble__content {')
    )

    expectContains(
      html,
      'agent-room-bubble--completion agent-room-bubble--failure agent-room-bubble--status-completed agent-room-bubble--status-failed data-status="completed" data-status="failed"'
        .split(' ')
    )
    expectContains(html, [
      'Completed billing review: flaky test fixed with regression coverage.',
      'I am blocked because release notes are missing.'
    ])
    expectNotContains(getMessageMarkup(html, 'msg-architect-complete'), [
      'agent-room-bubble--wide-content'
    ])
    expectNotContains(html, [
      'agent-room-bubble__status-pill',
      '@reviewer/release-check-with-long-name-that-should-not-dominate-the-bubble',
      'PRIVATE_CHILD_TRANSCRIPT'
    ])
    expectContains(styles, [
      '.agent-room-bubble__surface {',
      '.agent-room-bubble__avatar,',
      'border-radius: 6px;',
      '--agent-room-bubble-surface-gap: 10px;',
      '--agent-room-bubble-surface-padding-block: 12px;',
      '--agent-room-bubble-surface-padding-inline: 14px;',
      '--agent-room-bubble-content-gap: var(--agent-room-bubble-surface-gap);',
      'gap: var(--agent-room-bubble-surface-gap);',
      'padding: var(--agent-room-bubble-surface-padding-block)',
      'var(--agent-room-bubble-surface-padding-inline);',
      'color: var(--text-color);',
      '.agent-room-bubble__content {',
      'color: inherit;',
      '.agent-room-bubble--leader .agent-room-bubble__surface,',
      '.agent-room-bubble--leader .agent-room-bubble__avatar {',
      '.agent-room-bubble__content--collapsed {',
      'max-height: 240px;',
      'overflow: hidden;',
      '.agent-room-bubble__content--targeted {',
      'flex-direction: column;',
      '.agent-room-bubble__content-text--markdown {',
      '--room-pixel-avatar-radius: 6px;',
      '.agent-room-bubble__expand {',
      'align-self: flex-start;',
      'justify-content: center;',
      'width: 24px;',
      'height: 24px;',
      '.material-symbols-rounded {',
      '.agent-room-bubble--assignment.agent-room-bubble--status-completed'
    ])
    expectContains(leaderSurfaceStyles, [
      'box-shadow:',
      '--agent-room-bubble-surface-gap: 8px;',
      '--agent-room-bubble-surface-padding-block: 10px;',
      '--agent-room-bubble-surface-padding-inline: 12px;',
      '--agent-room-bubble-content-gap: 8px;',
      'padding: 10px 12px;',
      'var(--primary-color) 30%',
      'var(--primary-color) 7%',
      'var(--sub-bg-color)'
    ])
    expectContains(compactAgentSurfaceStyles, [
      '.agent-room-bubble--user .agent-room-bubble__surface,',
      '.agent-room-bubble--agent:not(.agent-room-bubble--leader):not(',
      '.agent-room-bubble--interaction-request',
      '.agent-room-bubble--approval-batch',
      '.agent-room-bubble__surface {',
      '--agent-room-bubble-surface-gap: 6px;',
      '--agent-room-bubble-surface-padding-block: 6px;',
      '--agent-room-bubble-surface-padding-inline: 8px;',
      '--agent-room-bubble-content-gap: 6px;'
    ])
    expectContains(roomEventSurfaceStyles, [
      '.agent-room-bubble--assignment .agent-room-bubble__surface,',
      '.agent-room-bubble--interaction-request .agent-room-bubble__surface,',
      '.agent-room-bubble--completion .agent-room-bubble__surface {',
      '--agent-room-bubble-surface-gap: 6px;',
      '--agent-room-bubble-surface-padding-block: 6px;',
      '--agent-room-bubble-surface-padding-inline: 8px;',
      '--agent-room-bubble-content-gap: 6px;',
      'padding: var(--agent-room-bubble-surface-padding-block)'
    ])
    expectNotContains(compactAgentSurfaceStyles, [
      '.agent-room-bubble--has-quote',
      'padding: 6px 8px;'
    ])
    expectContains(leaderAvatarStyles, ['var(--primary-color) 36%', 'var(--primary-color) 10%', 'var(--tag-bg)'])
    expectNotContains(leaderSurfaceStyles, ['linear-gradient', 'radial-gradient'])
    expectNotContains(leaderAvatarStyles, ['linear-gradient', 'radial-gradient'])
    expectContains(expandStyles, ['border-radius: 7px;', 'line-height: 1;'])
    expectNotContains(expandStyles, ['text-decoration', 'text-underline-offset'])
    expectNotContains(styles, [
      '.agent-room-bubble--status-completed .agent-room-bubble__surface {',
      'var(--success-color) 42%'
    ])
    expectContains(bubbleSource, ['keyboard_arrow_down', 'keyboard_arrow_up'])
  })

  it('does not render timeline separator rows in the message list', async () => {
    const html = await renderRoom()

    expect(html).not.toContain('agent-room-message-list__time-separator')
    expect(html).not.toContain('role="separator"')
  })

  it('renders the shared session sender in the room sender slot', async () => {
    const html = await renderChatHistoryShell({ roomMode: true })

    expectContains(
      html,
      'chat-input-wrapper chat-input-container chat-input-monaco sender-session-target sender-room-target sender-room-target__label sender-room-target__icon sender-permission-trigger toolbar-btn--reference model-select effort-stage-slider chat-status-bar chat-status-bar__actions account-select adapter-select adapter-select--locked'
        .split(' ')
    )
    expect(html).toContain('Message the host agent...')
    expect(html).not.toContain('Talking to:')
    expect(html).not.toContain('Chatting with')
    expect(html).not.toContain('对话：')
    expectNotContains(html, ['sender-session-target--actions-only', 'sender-session-target__trigger'])
    expectNotContains(html, ['chat-input-top-actions', 'agent-room-composer'])
  })

  it('renders the room sender target from the current input mention', async () => {
    const hostHtml = await renderAgentRoomSenderHeader({ input: '' })
    const memberHtml = await renderAgentRoomSenderHeader({ input: '@architect Please review' })
    const runHtml = await renderAgentRoomSenderHeader({ input: '@architect/schema-plan ' })

    expectContains(hostHtml, ['sender-room-target--host', 'sender-room-target__label--host'])
    expectContains(memberHtml, [
      'sender-room-target--member',
      'sender-room-target__label--member',
      'sender-room-target__icon'
    ])
    expectContains(runHtml, [
      'sender-room-target--run',
      'sender-room-target__label--run',
      'architect/schema-plan'
    ])
    expectContains(hostHtml, ['>host</span>'])
    expectContains(memberHtml, ['>architect</span>'])
    expectNotContains(memberHtml, ['Talking to:', 'Chatting with', '对话：', '@@architect'])
    expectNotContains(runHtml, ['Talking to:', 'Chatting with', '对话：', '@@architect'])
  })

  it('marks missing and ambiguous room sender targets without changing normal sender mode', async () => {
    const missingHtml = await renderAgentRoomSenderHeader({ input: '@planner Draft' })
    const ambiguousHtml = await renderAgentRoomSenderHeader({
      input: '@architect Draft',
      room: {
        ...fixtureRoom,
        members: [
          ...fixtureRoom.members,
          {
            memberKey: 'member:architect-copy',
            label: '@architect',
            subtitle: 'Duplicate planner',
            avatarLabel: 'AC',
            status: 'idle',
            pendingCount: 0,
            activeRunCount: 0,
            runs: []
          }
        ]
      }
    })
    const sessionHtml = await renderChatHistoryShell({ roomMode: false })

    expectContains(missingHtml, [
      'sender-room-target--missing',
      'sender-room-target__label--missing',
      'Can&#x27;t find @planner'
    ])
    expectContains(ambiguousHtml, [
      'sender-room-target--ambiguous',
      'sender-room-target__label--ambiguous',
      'Multiple matches for @architect'
    ])
    expect(sessionHtml).not.toContain('sender-room-target')
    expect(sessionHtml).not.toContain('Chatting with')
  })

  it('keeps the permission dropdown in the normal sender header position beside the room target', async () => {
    const html = await renderAgentRoomSenderHeader({ input: '@architect Please review', showPermissionControl: true })
    const targetLabelIndex = html.indexOf('sender-room-target__label')
    const headerActionsIndex = html.indexOf('chat-input-header-actions')
    const permissionTriggerIndex = html.indexOf('sender-permission-trigger')
    const headerToggleIndex = html.indexOf('chat-input-header-toggle-tab')

    expectContains(html, [
      'sender-room-target',
      'sender-room-target__label',
      'sender-session-target__actions',
      'chat-input-header-actions',
      'sender-permission-trigger',
      'aria-haspopup="menu"',
      'aria-expanded="false"'
    ])
    expect(targetLabelIndex).toBeGreaterThanOrEqual(0)
    expect(headerActionsIndex).toBeGreaterThan(targetLabelIndex)
    expect(permissionTriggerIndex).toBeGreaterThan(headerActionsIndex)
    expect(headerToggleIndex).toBeGreaterThan(permissionTriggerIndex)
  })

  it('keeps the sender editor on Monaco textarea input instead of EditContext', async () => {
    const html = await renderChatHistoryShell({ roomMode: false })

    expect(html).toContain('data-edit-context="false"')
  })

  it('uses the Chinese room placeholder only for Agent Room sender', async () => {
    const roomHtml = await renderChatHistoryShell({ language: 'zh', roomMode: true })
    const sessionHtml = await renderChatHistoryShell({ language: 'zh', roomMode: false })

    expect(roomHtml).toContain('发送消息给群聊')
    expect(roomHtml).not.toContain('输入消息...')
    expect(sessionHtml).toContain('输入消息...')
    expect(sessionHtml).not.toContain('发送消息给群聊')
  })

  it('keeps the normal session sender controls rendered in the shared stack', async () => {
    const html = await renderChatHistoryShell({ roomMode: false })

    expectContains(
      html,
      'chat-input-wrapper sender-session-target sender-session-target__trigger sender-session-target__actions sender-permission-trigger toolbar-btn--reference model-select effort-stage-slider chat-status-bar chat-status-bar__actions account-select adapter-select adapter-select--locked'
        .split(' ')
    )
    expect(html).not.toContain('sender-room-target')
    expect(html).not.toContain('Chatting with')
  })

  it('keeps embedded child sessions on the primary session composer surface', async () => {
    const html = await renderChatHistoryShell({ embeddedSessionChrome: true, roomMode: false })

    expectContains(
      html,
      [
        'sender-container--chat-surface',
        'sender-session-target__trigger',
        'chat-status-bar-frame',
        'chat-status-bar--collapsible',
        'is-collapsed',
        'chat-status-bar__collapsed-line',
        'chat-status-bar__actions'
      ]
    )
    expect(html).toContain('Type a message in this child session...')
    expect(html).not.toContain('Type a message...')
    expect(html).not.toContain('new-session-guide')
    expect(html).not.toContain('sender-room-target')
  })

  it('labels agent-origin messages without adding source badges to direct user messages in child sessions', async () => {
    const childSession: Session = {
      ...sessionFixture,
      id: 'sess_child_planner',
      parentSessionId: 'host-session'
    }
    const messages: ChatMessage[] = [
      {
        id: 'evt-leader-1',
        role: 'user',
        content: 'leader-to-planner-session-source',
        agentRoom: {
          roomId: 'room-host-session',
          hostSessionId: 'host-session',
          memberKey: 'std/dev-planner',
          runKey: 'sess_child_planner',
          commandId: 'message-planner'
        },
        createdAt: 10
      },
      {
        id: 'direct-user-1',
        role: 'user',
        content: 'direct-user-to-planner-session-source',
        createdAt: 20
      },
      {
        id: 'evt-reviewer-1',
        role: 'user',
        content: 'reviewer-to-planner-session-source',
        agentRoom: {
          source: 'std/dev-reviewer',
          sourceLabel: 'std/dev-reviewer',
          roomId: 'room-host-session',
          hostSessionId: 'host-session',
          memberKey: 'std/dev-planner',
          runKey: 'sess_child_planner',
          commandId: 'message-planner-from-reviewer'
        },
        createdAt: 30
      }
    ]
    const agentRoomSourceMembers: AgentRoomMemberView[] = [
      {
        memberKey: 'leader',
        kind: 'host',
        label: 'leader',
        avatarLabel: 'LD',
        status: 'active',
        pendingCount: 0,
        activeRunCount: 0,
        runs: []
      },
      {
        memberKey: 'std/dev-reviewer',
        kind: 'entity',
        label: 'std/dev-reviewer',
        avatarLabel: 'RV',
        status: 'idle',
        pendingCount: 0,
        activeRunCount: 0,
        runs: []
      }
    ]

    const html = await renderChatHistoryShell({
      agentRoomSourceMembers,
      isAgentRoomSession: true,
      language: 'zh',
      messages,
      roomMode: false,
      session: childSession
    })
    const leaderMessage = getMessageMarkup(html, 'evt-leader-1')
    const directMessage = getMessageMarkup(html, 'direct-user-1')
    const reviewerMessage = getMessageMarkup(html, 'evt-reviewer-1')
    const normalHtml = await renderChatHistoryShell({ messages, roomMode: false })
    const styles = readFileSync(
      new URL('../src/components/chat/messages/MessageItem.scss', import.meta.url),
      'utf8'
    )

    expectContains(leaderMessage, [
      'chat-message-user--agent-room-source',
      'chat-message-user--agent-room-agent-source',
      'chat-message-user--agent-room-leader-source',
      'class="message-source-line message-source-line--agent message-source-line--leader"',
      'data-agent-room-source="leader"',
      'aria-label="leader："',
      'title="leader："',
      'class="message-source-line__avatar message-source-line__avatar--configured"',
      '>LD</span>',
      'class="message-source-line__text">leader：</span>',
      'leader-to-planner-session-source'
    ])
    expectContains(directMessage, ['chat-message-user', 'direct-user-to-planner-session-source'])
    expectContains(reviewerMessage, [
      'chat-message-user--agent-room-source',
      'chat-message-user--agent-room-agent-source',
      'class="message-source-line message-source-line--agent"',
      'data-agent-room-source="std/dev-reviewer"',
      'aria-label="std/dev-reviewer："',
      'class="message-source-line__avatar message-source-line__avatar--configured"',
      '>RV</span>',
      'class="message-source-line__text">std/dev-reviewer：</span>',
      'reviewer-to-planner-session-source'
    ])
    expectNotContains(directMessage, [
      'chat-message-user--agent-room-source',
      'message-source-line',
      'data-agent-room-source',
      'aria-label="你："',
      'class="message-source-line__text">你：</span>',
      'chat-message-user--agent-room-agent-source',
      'chat-message-user--agent-room-leader-source',
      'leader 指令'
    ])
    expectNotContains(reviewerMessage, [
      'chat-message-user--agent-room-leader-source',
      'leader 指令',
      '@std/dev-reviewer'
    ])
    expectNotContains(normalHtml, [
      'message-source-line',
      'chat-message-user--agent-room-source'
    ])
    expectContains(styles, [
      '.message-source-line {',
      'width: fit-content;',
      'border: 0;',
      'white-space: normal;',
      '.message-source-line__avatar {',
      'rgba(17, 24, 39, .38)',
      '.message-source-line__avatar--configured {',
      '.message-source-line__text {',
      'overflow: visible;',
      'text-overflow: clip;',
      '.message-source-line--leader,',
      'chat-message-user--agent-room-agent-source',
      'chat-message-user--agent-room-leader-source'
    ])
  })

  it('renders agent room envelope messages as structured cards', async () => {
    const childSession: Session = {
      ...sessionFixture,
      id: 'sess_child_reviewer',
      parentSessionId: 'host-session'
    }
    const envelopeContent = [
      '<agent-room-message>',
      'Current Agent Room context:',
      '- roomId: room_123',
      '- roomTitle: Team Room',
      '- currentMemberKey: std/dev-reviewer',
      '- existing member sessions:',
      '  - memberKey=std/dev-reviewer | sessionId=sess_child_reviewer | runKey=run-reviewer | status=completed | title=Reviewer | current=true',
      '  - memberKey=std/dev-planner | sessionId=sess_child_planner | runKey=run-planner | status=completed | title=Planner',
      '',
      'Routing rules:',
      '- This message is for the current member session.',
      '- Do not start a new session for any existing member listed above.',
      '',
      'User message:',
      'Please review this change.',
      '</agent-room-message>'
    ].join('\n')
    const html = await renderChatHistoryShell({
      isAgentRoomSession: true,
      language: 'zh',
      messages: [{
        id: 'evt-envelope',
        role: 'user',
        content: envelopeContent,
        agentRoom: {
          roomId: 'room_123',
          hostSessionId: 'host-session',
          memberKey: 'std/dev-reviewer',
          runKey: 'run-reviewer'
        },
        createdAt: 10
      }],
      roomMode: false,
      session: childSession
    })
    const messageHtml = getMessageMarkup(html, 'evt-envelope')

    expectContains(messageHtml, [
      'chat-message-user--agent-room-envelope',
      'agent-room-envelope-card',
      'Please review this change.'
    ])
    expectNotContains(messageHtml, [
      '&lt;agent-room-message&gt;',
      '&lt;/agent-room-message&gt;',
      'Current Agent Room context:',
      'User message:',
      '消息正文',
      'Agent Room 消息',
      '路由规则',
      'This message is for the current member session.',
      'Do not start a new session',
      '上下文',
      'Team Room',
      'room_123',
      'std/dev-reviewer',
      'sess_child_reviewer'
    ])
  })
})
