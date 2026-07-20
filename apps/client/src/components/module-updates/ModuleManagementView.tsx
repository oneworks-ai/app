/* eslint-disable max-lines -- module management view keeps status rendering and actions together. */
import './ModuleManagementView.scss'

import { Alert, App, Button, Collapse, Dropdown, Spin, Tag, Tooltip } from 'antd'
import type { MouseEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import type {
  ModuleUpdateChannel,
  ModuleUpdateGroup,
  ModuleUpdateInstallResponse,
  ModuleUpdateItem,
  ModuleUpdatesResponse
} from '@oneworks/types'

import { checkModuleUpdates, installModuleUpdate, updateModuleUpdateSettings } from '#~/api'
import { getApiErrorMessage } from '#~/api/base'
import { MarkdownContent } from '#~/components/MarkdownContent'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { RouteContainerHeader } from '#~/components/layout/RouteContainerHeader'
import { RouteContainerLayout } from '#~/components/layout/RouteContainerLayout'
import { useRouteContainerSidebarOpener } from '#~/components/layout/use-route-container-sidebar-opener'

const formatVersion = (value: string | undefined, fallback: string) => value ?? fallback

const pickChangelogPreviewLine = (body: string) => (
  body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .find(line => !line.startsWith('#'))
    ?.replace(/^[-*]\s+/, '')
    .replace(/^#+\s*/, '') ?? ''
)

type ModuleChannelSelectValue = ModuleUpdateChannel | 'default'
type ModuleUpdateInstallScope = ModuleUpdateGroup | 'all'
type ModuleUpdateReviewDetail = 'changelog' | 'modules' | 'summary'
type ModuleUpdateReviewScope =
  | { kind: 'all' | 'global' }
  | { group: ModuleUpdateGroup; kind: 'group' }
  | { id: string; kind: 'module' }
type ModuleUpdateSummaryCategory = 'feature' | 'fix' | 'other'
interface ModuleUpdateActionsOptions {
  available: number
  buttonClassName?: string
  channelControl?: ReactNode
  checkDisabled: boolean
  checkLoading: boolean
  className?: string
  iconClassName?: string
  headerMode?: boolean
  onCheck: () => void
  onUpdate: () => void
  pendingActivation: number
  showMetrics?: boolean
  updateDisabled: boolean
  updateLabel: string
  updateLoading: boolean
}
interface ModuleUpdateGroupSummary {
  available: number
  key: ModuleUpdateGroup
  modules: ModuleUpdateItem[]
  pendingActivation: number
  total: number
}
interface ModuleUpdateSummaryItem {
  category: ModuleUpdateSummaryCategory
  details: string[]
  text: string
}
interface ModuleUpdateSummaryContributor {
  avatarUrl: string
  login: string
  name: string
  profileUrl: string
}
interface ModuleUpdateSummaryChange {
  category: ModuleUpdateSummaryCategory
  contributors: ModuleUpdateSummaryContributor[]
  details: string[]
  key: string
  moduleLabel: string
  text: string
}

const moduleUpdateChannelOptions = ['stable', 'rc', 'beta', 'alpha'] as const satisfies readonly ModuleUpdateChannel[]
const moduleUpdateGroupOrder = ['core', 'adapter', 'plugin'] as const satisfies readonly ModuleUpdateGroup[]
const moduleUpdateGlobalGroups = new Set<ModuleUpdateGroup>(['adapter', 'core'])

const getModuleUpdateVersionRange = (item: ModuleUpdateItem, fallback: string) => ({
  from: item.changelog?.fromVersion ?? item.currentVersion ?? fallback,
  to: item.changelog?.toVersion ?? item.latestVersion ?? fallback
})

const escapeMarkdownInlineCode = (value: string) => value.replace(/`/g, '\\`')

const normalizeChangelogBody = (value: string) => value.trim()

const openReviewExternalLink = (url: string) => {
  if (typeof window === 'undefined' || url === '') return

  void window.oneworksDesktop?.openExternalUrl?.(url)
}

const stripMarkdownInlineDecorations = (value: string) => (
  value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim()
)

const moduleUpdateSummaryCategoryOrder = [
  'feature',
  'fix',
  'other'
] as const satisfies readonly ModuleUpdateSummaryCategory[]

const moduleUpdateSummaryCategoryKeywords = {
  feature: [
    'breaking',
    'feature',
    'highlight',
    'improve',
    'support',
    '主要变更',
    '优化',
    '功能',
    '新增',
    '支持',
    '改进',
    '破坏性',
    '重要',
    '重点'
  ],
  fix: [
    'bug',
    'fix',
    '修复',
    '修正',
    '问题',
    '错误'
  ],
  other: [
    'other',
    'test',
    'verification',
    '其他',
    '测试',
    '验证'
  ]
} as const satisfies Record<ModuleUpdateSummaryCategory, readonly string[]>

const summaryMarkerLabels = [
  'breaking changes',
  'feature changes',
  'important changes',
  'other changes',
  '主要变更',
  '功能更新',
  '其他调整',
  'breaking',
  'features',
  'important',
  'fixes',
  'other',
  'tests',
  'verification',
  'feature',
  'fix',
  'test',
  '重点',
  '重要',
  '破坏性',
  '新增',
  '修复',
  '验证',
  '测试'
] as const

const summaryMarkerLabelSet = new Set(summaryMarkerLabels.map(label => label.toLowerCase()))
const summaryMarkerLabelsByLength = [...summaryMarkerLabels].sort((left, right) => right.length - left.length)

const hasSummaryKeyword = (value: string, category: ModuleUpdateSummaryCategory) => (
  moduleUpdateSummaryCategoryKeywords[category].some(keyword => value.includes(keyword))
)

const isSummaryMarkerLabel = (value: string) => summaryMarkerLabelSet.has(value.trim().toLowerCase())

const getSummaryCategory = (heading: string, text: string): ModuleUpdateSummaryCategory => {
  const normalized = `${heading} ${text}`.toLowerCase()
  if (hasSummaryKeyword(normalized, 'fix')) return 'fix'
  if (hasSummaryKeyword(normalized, 'other')) return 'other'
  if (hasSummaryKeyword(normalized, 'feature')) return 'feature'
  return 'feature'
}

const shouldSkipSummaryLine = (text: string) => (
  text === '' ||
  /^发布日期[:：]/.test(text) ||
  /^发布\s+@/.test(text) ||
  /^release\s+@/i.test(text)
)

const stripSummaryMarkerPrefix = (value: string) => {
  let text = value.trim()
  if (text.startsWith('**')) {
    const markerEnd = text.indexOf('**', 2)
    const marker = markerEnd > 2 ? text.slice(2, markerEnd).trim().replace(/[：:]$/, '') : ''
    if (isSummaryMarkerLabel(marker)) {
      return text.slice(markerEnd + 2).replace(/^[：:]\s*/, '').trim()
    }
  }

  if (text.startsWith('[')) {
    const markerEnd = text.indexOf(']')
    const marker = markerEnd > 1 ? text.slice(1, markerEnd) : ''
    if (isSummaryMarkerLabel(marker)) {
      text = text.slice(markerEnd + 1).trim()
    }
  }

  const lowerText = text.toLowerCase()
  for (const marker of summaryMarkerLabelsByLength) {
    const lowerMarker = marker.toLowerCase()
    if (lowerText.startsWith(`${lowerMarker}:`) || lowerText.startsWith(`${lowerMarker}：`)) {
      return text.slice(marker.length + 1).trim()
    }
  }

  return text
}

const isSummaryMarkerOnlyText = (value: string) => {
  const normalized = stripMarkdownInlineDecorations(value).replace(/[：:]$/, '').trim()
  return isSummaryMarkerLabel(normalized)
}

const parseMarkdownBullet = (line: string) => {
  const trimmed = line.trimStart()
  const indent = line.length - trimmed.length
  const marker = trimmed[0]
  if ((marker !== '-' && marker !== '*' && marker !== '+') || trimmed[1] !== ' ') return null
  return {
    indent,
    text: trimmed.slice(2).trim()
  }
}

const githubLoginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i

const buildGitHubContributor = (login: string, name?: string): ModuleUpdateSummaryContributor | null => {
  const normalizedLogin = login.trim().replace(/^@/, '')
  if (!githubLoginPattern.test(normalizedLogin)) return null

  return {
    avatarUrl: `https://github.com/${normalizedLogin}.png?size=40`,
    login: normalizedLogin,
    name: name?.trim() === '' || name == null ? normalizedLogin : name.trim(),
    profileUrl: `https://github.com/${normalizedLogin}`
  }
}

const parseGitHubProfileContributor = (label: string, url: string) => {
  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.hostname !== 'github.com') return null
    const login = parsedUrl.pathname.split('/').filter(Boolean)[0]
    if (login == null || parsedUrl.pathname.split('/').filter(Boolean).length !== 1) return null
    return buildGitHubContributor(login, label.trim().replace(/^@/, ''))
  } catch {
    return null
  }
}

const extractSummaryContributors = (value: string) => {
  const contributors: ModuleUpdateSummaryContributor[] = []
  let text = value
  const linkPattern = /\[(@?[a-z\d][a-z\d-]{0,38})\]\((https:\/\/github\.com\/[a-z\d][a-z\d-]{0,38}\/?)\)/gi
  let match: RegExpExecArray | null

  match = linkPattern.exec(value)
  while (match != null) {
    const currentMatch = match
    match = linkPattern.exec(value)

    const contributor = parseGitHubProfileContributor(currentMatch[1] ?? '', currentMatch[2] ?? '')
    if (contributor == null) continue
    contributors.push(contributor)
    text = text.replace(currentMatch[0], '')
  }

  text = text
    .replace(/(?:作者|贡献者|by|author|contributors?)[：:]?[、,\s]*/gi, '')
    .replace(/\s+([。；;:：,，])/g, '$1')
    .replace(/[，,、]\s*([。；;:：])/g, '$1')
    .replace(/\s*[—–-]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const seenLogins = new Set<string>()
  return {
    contributors: contributors.filter((contributor) => {
      if (seenLogins.has(contributor.login)) return false
      seenLogins.add(contributor.login)
      return true
    }),
    text
  }
}

const appendSummaryDetail = (summaryItems: ModuleUpdateSummaryItem[], text: string) => {
  const previous = summaryItems.at(-1)
  if (previous == null || text.trim() === '') return
  previous.details.push(text)
}

const collectModuleSummaryItems = (item: ModuleUpdateItem): ModuleUpdateSummaryItem[] => {
  const summaryItems: ModuleUpdateSummaryItem[] = []
  let pendingCategory: { category: ModuleUpdateSummaryCategory; indent: number } | null = null
  let lastPrimaryIndent = 0

  for (const entry of item.changelog?.entries ?? []) {
    let heading = ''

    for (const line of entry.body.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue

      if (/^#{1,6}\s+/.test(trimmed)) {
        heading = stripMarkdownInlineDecorations(trimmed.replace(/^#{1,6}\s+/, ''))
        pendingCategory = null
        continue
      }

      if (/^!\[[^\]]*\]\([^)]+\)/.test(trimmed)) {
        appendSummaryDetail(summaryItems, trimmed)
        continue
      }

      const bullet = parseMarkdownBullet(line)
      if (bullet == null) continue

      const text = stripSummaryMarkerPrefix(bullet.text)
      if (shouldSkipSummaryLine(stripMarkdownInlineDecorations(text))) continue

      const indent = bullet.indent
      if (isSummaryMarkerOnlyText(text)) {
        pendingCategory = {
          category: getSummaryCategory(heading, text),
          indent
        }
        continue
      }

      if (
        indent > lastPrimaryIndent &&
        summaryItems.length > 0 &&
        (pendingCategory == null || lastPrimaryIndent > pendingCategory.indent)
      ) {
        appendSummaryDetail(summaryItems, text)
        continue
      }

      if (pendingCategory != null && indent <= pendingCategory.indent) {
        pendingCategory = null
      }

      summaryItems.push({
        category: pendingCategory != null && indent > pendingCategory.indent
          ? pendingCategory.category
          : getSummaryCategory(heading, text),
        details: [],
        text
      })
      lastPrimaryIndent = indent
    }
  }

  return summaryItems
}

const collectReviewSummaryChanges = (modules: ModuleUpdateItem[]): ModuleUpdateSummaryChange[] => (
  modules.flatMap(item =>
    collectModuleSummaryItems(item).map((summaryItem, index) => {
      const { contributors, text } = extractSummaryContributors(summaryItem.text)
      return {
        category: summaryItem.category,
        contributors,
        details: summaryItem.details,
        key: `${item.id}:${index}:${text}`,
        moduleLabel: item.label,
        text: text.replace(/\)\s*[:：]\s*/, ')：')
      }
    })
  )
)

const parseReviewScope = (search: string): ModuleUpdateReviewScope | null => {
  const params = new URLSearchParams(search)
  const review = params.get('review')
  const target = params.get('target')
  if (review === 'global' || review === 'all') return { kind: review }
  if (review === 'group' && target != null && moduleUpdateGroupOrder.includes(target as ModuleUpdateGroup)) {
    return { group: target as ModuleUpdateGroup, kind: 'group' }
  }
  if (review === 'module' && target != null && target.trim() !== '') {
    return { id: target, kind: 'module' }
  }
  return null
}

const parseReviewDetail = (search: string): ModuleUpdateReviewDetail => {
  const detail = new URLSearchParams(search).get('detail')
  return detail === 'modules' || detail === 'changelog' ? detail : 'summary'
}

const encodeReviewSearch = (scope: ModuleUpdateReviewScope, detail: ModuleUpdateReviewDetail = 'summary') => {
  const params = new URLSearchParams()
  params.set('review', scope.kind)
  if (scope.kind === 'group') params.set('target', scope.group)
  if (scope.kind === 'module') params.set('target', scope.id)
  if (detail !== 'summary') params.set('detail', detail)
  return `?${params.toString()}`
}

const applyInstallResponseToData = (
  prev: ModuleUpdatesResponse | null,
  response: ModuleUpdateInstallResponse
): ModuleUpdatesResponse => {
  if (prev == null) {
    return {
      checkedAt: response.checkedAt,
      channel: response.channel,
      moduleChannels: response.moduleChannels,
      modules: [response.module],
      npmTag: response.npmTag
    }
  }

  const hasModule = prev.modules.some(existing => existing.id === response.module.id)
  return {
    checkedAt: response.checkedAt,
    channel: response.channel,
    moduleChannels: response.moduleChannels,
    modules: hasModule
      ? prev.modules.map(existing => existing.id === response.module.id ? response.module : existing)
      : [...prev.modules, response.module],
    npmTag: response.npmTag
  }
}

const getStatusKey = (item: ModuleUpdateItem) => {
  if (item.errorMessage != null) return 'error'
  if (item.updateAvailable) return 'available'
  if (item.needsActivation) return 'pendingActivation'
  if (item.cachedVersion != null && item.kind === 'adapter') return 'cached'
  return 'upToDate'
}

const getStatusTone = (statusKey: string) => {
  switch (statusKey) {
    case 'available':
      return 'processing'
    case 'cached':
    case 'pendingActivation':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'success'
  }
}

export function ModuleManagementView() {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const {
    isCompactView,
    openRouteSidebar
  } = useRouteContainerSidebarOpener()
  const [data, setData] = useState<ModuleUpdatesResponse | null>(null)
  const [checking, setChecking] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [installingGroup, setInstallingGroup] = useState<ModuleUpdateInstallScope | null>(null)
  const [installingReview, setInstallingReview] = useState(false)
  const [savingChannelKey, setSavingChannelKey] = useState<string | null>(null)
  const [activeGroupKey, setActiveGroupKey] = useState<string | string[]>('core')
  const reviewScope = useMemo(() => parseReviewScope(location.search), [location.search])
  const reviewDetail = useMemo(() => parseReviewDetail(location.search), [location.search])

  const refresh = useCallback(() => {
    setChecking(true)
    setErrorMessage(null)
    void checkModuleUpdates()
      .then(setData)
      .catch((error) => {
        console.error('[module-updates] failed to check module updates', error)
        setErrorMessage(getApiErrorMessage(error, t('moduleUpdates.checkFailed')))
      })
      .finally(() => setChecking(false))
  }, [t])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openInstallReview = useCallback((scope: ModuleUpdateReviewScope) => {
    void navigate({
      pathname: '/modules',
      search: encodeReviewSearch(scope)
    })
  }, [navigate])

  const closeInstallReview = useCallback(() => {
    void navigate({
      pathname: '/modules',
      search: ''
    }, { replace: true })
  }, [navigate])

  const installModule = (item: ModuleUpdateItem) => {
    if (!item.updateAvailable || installingId != null || installingGroup != null || installingReview) return
    openInstallReview({ id: item.id, kind: 'module' })
  }

  const installGroup = (group: {
    available: number
    key: ModuleUpdateGroup
    modules: ModuleUpdateItem[]
  }) => {
    if (
      group.available === 0 ||
      installingId != null ||
      installingGroup != null ||
      installingReview ||
      savingChannelKey != null
    ) return
    openInstallReview({ group: group.key, kind: 'group' })
  }

  const installAll = () => {
    const installableModules = (data?.modules ?? []).filter(item => item.updateAvailable)
    if (
      installableModules.length === 0 ||
      installingId != null ||
      installingGroup != null ||
      installingReview ||
      savingChannelKey != null
    ) return

    openInstallReview({ kind: 'all' })
  }

  const updateDefaultChannel = useCallback((defaultChannel: ModuleUpdateChannel) => {
    if (data?.channel === defaultChannel || savingChannelKey != null || installingReview) return

    setSavingChannelKey('default')
    setErrorMessage(null)
    void updateModuleUpdateSettings({ defaultChannel })
      .then((response) => {
        setData(response)
        void message.success(t('moduleUpdates.channelSaved'))
      })
      .catch((error) => {
        console.error('[module-updates] failed to update default channel', error)
        void message.error(getApiErrorMessage(error, t('moduleUpdates.channelSaveFailed')))
      })
      .finally(() => setSavingChannelKey(null))
  }, [data?.channel, installingReview, message, savingChannelKey, t])

  const updateModuleChannel = useCallback((item: ModuleUpdateItem, value: ModuleChannelSelectValue) => {
    if (savingChannelKey != null || installingReview) return

    const nextChannel = value === 'default' ? null : value
    if ((item.configuredChannel ?? null) === nextChannel) return

    setSavingChannelKey(item.id)
    setErrorMessage(null)
    void updateModuleUpdateSettings({
      moduleChannels: {
        [item.id]: nextChannel
      }
    })
      .then((response) => {
        setData(response)
        void message.success(t('moduleUpdates.channelSaved'))
      })
      .catch((error) => {
        console.error('[module-updates] failed to update module channel', error)
        void message.error(getApiErrorMessage(error, t('moduleUpdates.channelSaveFailed')))
      })
      .finally(() => setSavingChannelKey(null))
  }, [installingReview, message, savingChannelKey, t])

  const updateGroupChannel = useCallback((group: ModuleUpdateGroupSummary, value: ModuleChannelSelectValue) => {
    if (savingChannelKey != null || installingReview) return

    const nextChannel = value === 'default' ? null : value
    const hasChanges = group.modules.some(item => (item.configuredChannel ?? null) !== nextChannel)
    if (!hasChanges) return

    const moduleChannels = group.modules.reduce<Record<string, ModuleUpdateChannel | null>>((acc, item) => {
      acc[item.id] = nextChannel
      return acc
    }, {})

    setSavingChannelKey(`group:${group.key}`)
    setErrorMessage(null)
    void updateModuleUpdateSettings({ moduleChannels })
      .then((response) => {
        setData(response)
        void message.success(t('moduleUpdates.channelSaved'))
      })
      .catch((error) => {
        console.error('[module-updates] failed to update module group channel', error)
        void message.error(getApiErrorMessage(error, t('moduleUpdates.channelSaveFailed')))
      })
      .finally(() => setSavingChannelKey(null))
  }, [installingReview, message, savingChannelKey, t])

  const moduleSummary = useMemo(() => {
    const modules = data?.modules ?? []
    return {
      available: modules.filter(item => item.updateAvailable).length,
      pendingActivation: modules.filter(item => item.needsActivation).length
    }
  }, [data])
  const isInstallingAll = installingGroup === 'all'

  const moduleGroups = useMemo<ModuleUpdateGroupSummary[]>(() => (
    moduleUpdateGroupOrder
      .map((groupKey) => {
        const modules = (data?.modules ?? []).filter(item => item.group === groupKey)
        return {
          available: modules.filter(item => item.updateAvailable).length,
          key: groupKey,
          modules,
          pendingActivation: modules.filter(item => item.needsActivation).length,
          total: modules.length
        }
      })
      .filter(group => group.total > 0)
  ), [data?.modules])

  const reviewModules = useMemo(() => {
    if (reviewScope == null) return []

    const modules = (data?.modules ?? []).filter(item => item.updateAvailable)
    switch (reviewScope.kind) {
      case 'all':
        return modules
      case 'global':
        return modules.filter(item => moduleUpdateGlobalGroups.has(item.group))
      case 'group':
        return modules.filter(item => item.group === reviewScope.group)
      case 'module':
        return modules.filter(item => item.id === reviewScope.id)
    }
  }, [data?.modules, reviewScope])

  const buildReviewSummaryMarkdown = useCallback((modules: ModuleUpdateItem[]) => {
    if (modules.length === 0) return t('moduleUpdates.reviewEmpty')

    const lines = [
      `# ${t('moduleUpdates.changelogSummaryTitle')}`,
      '',
      t('moduleUpdates.changelogSummaryIntro', { count: modules.length })
    ]

    const summaryChanges = collectReviewSummaryChanges(modules)
    if (summaryChanges.length === 0) {
      lines.push('', t('moduleUpdates.changelogSummaryMissingHint'))
      return lines.join('\n')
    }

    moduleUpdateSummaryCategoryOrder.forEach((category) => {
      const changes = summaryChanges.filter(change => change.category === category)
      if (changes.length === 0) return
      const titleKey = category === 'feature'
        ? 'changelogSummaryFeatures'
        : category === 'fix'
        ? 'changelogSummaryFixes'
        : 'changelogSummaryOther'
      lines.push('', `## ${t(`moduleUpdates.${titleKey}`)}`)
      changes.forEach(change => lines.push(`- ${change.text}`))
    })

    return lines.join('\n')
  }, [t])

  const buildReviewModulesMarkdown = useCallback((modules: ModuleUpdateItem[]) => {
    if (modules.length === 0) return t('moduleUpdates.reviewEmpty')

    const versionFallback = t('moduleUpdates.versionUnknown')
    const updatedGroups = moduleUpdateGroupOrder
      .map((groupKey) => ({
        count: modules.filter(item => item.group === groupKey).length,
        groupKey
      }))
      .filter(group => group.count > 0)
    const changelogBodies = modules.flatMap(item => (
      (item.changelog?.entries ?? [])
        .map(entry => normalizeChangelogBody(entry.body))
        .filter(body => body !== '')
    ))
    const lines = [
      `# ${t('moduleUpdates.reviewModulesTitle')}`,
      '',
      t('moduleUpdates.reviewModulesIntro', { count: modules.length }),
      '',
      `## ${t('moduleUpdates.changelogSummaryGroups')}`,
      ...updatedGroups.map(group => (
        `- **${t(`moduleUpdates.groups.${group.groupKey}`)}**: ${
          t('moduleUpdates.changelogSummaryGroupCount', {
            count: group.count
          })
        }`
      )),
      '',
      `## ${t('moduleUpdates.changelogSummaryVersions')}`,
      ...modules.map((item) => {
        const range = getModuleUpdateVersionRange(item, versionFallback)
        return `- \`${escapeMarkdownInlineCode(item.packageName)}\`: ${range.from} -> ${range.to}`
      })
    ]

    if (changelogBodies.length === 0) {
      lines.push('', t('moduleUpdates.changelogSummaryMissingHint'))
      return lines.join('\n')
    }

    lines.push(
      '',
      t('moduleUpdates.changelogSummaryDetailHint')
    )
    return lines.join('\n')
  }, [t])

  const buildReviewChangelogMarkdown = useCallback((modules: ModuleUpdateItem[]) => {
    if (modules.length === 0) return t('moduleUpdates.reviewEmpty')

    const changelogBodies = modules.flatMap(item => (
      (item.changelog?.entries ?? [])
        .map(entry => normalizeChangelogBody(entry.body))
        .filter(body => body !== '')
    ))

    if (changelogBodies.length === 0) {
      return [
        `# ${t('moduleUpdates.reviewChangelogTitle')}`,
        '',
        t('moduleUpdates.changelogSummaryMissingHint')
      ].join('\n')
    }

    return [
      `# ${t('moduleUpdates.reviewChangelogTitle')}`,
      '',
      t('moduleUpdates.reviewChangelogIntro', { count: modules.length }),
      '',
      changelogBodies.join('\n\n---\n\n')
    ].join('\n')
  }, [t])

  const buildReviewMarkdown = useCallback((modules: ModuleUpdateItem[], detail: ModuleUpdateReviewDetail) => {
    switch (detail) {
      case 'modules':
        return buildReviewModulesMarkdown(modules)
      case 'changelog':
        return buildReviewChangelogMarkdown(modules)
      default:
        return buildReviewSummaryMarkdown(modules)
    }
  }, [buildReviewChangelogMarkdown, buildReviewModulesMarkdown, buildReviewSummaryMarkdown])

  const reviewMarkdown = useMemo(
    () => buildReviewMarkdown(reviewModules, reviewDetail),
    [buildReviewMarkdown, reviewDetail, reviewModules]
  )
  const reviewSummaryChanges = useMemo(
    () => collectReviewSummaryChanges(reviewModules),
    [reviewModules]
  )

  const openReviewDetail = useCallback((detail: ModuleUpdateReviewDetail) => {
    if (reviewScope == null) return
    void navigate({
      pathname: '/modules',
      search: encodeReviewSearch(reviewScope, detail)
    })
  }, [navigate, reviewScope])

  const backFromReviewDetail = useCallback(() => {
    if (reviewScope == null) return
    void navigate({
      pathname: '/modules',
      search: encodeReviewSearch(reviewScope)
    })
  }, [navigate, reviewScope])

  const installReviewModules = useCallback(async () => {
    if (
      reviewModules.length === 0 ||
      installingReview ||
      installingId != null ||
      installingGroup != null ||
      savingChannelKey != null
    ) return

    setInstallingReview(true)
    setErrorMessage(null)
    let installedCount = 0
    try {
      for (const item of reviewModules) {
        setInstallingId(item.id)
        const response = await installModuleUpdate(item.id)
        installedCount += 1
        setData(prev => applyInstallResponseToData(prev, response))
      }
      void message.success(t('moduleUpdates.allInstallSuccess', { count: installedCount }))
      closeInstallReview()
    } catch (error) {
      console.error('[module-updates] failed to install reviewed module updates', error)
      void message.error(getApiErrorMessage(error, t('moduleUpdates.allInstallFailed')))
    } finally {
      setInstallingId(null)
      setInstallingReview(false)
    }
  }, [
    closeInstallReview,
    installingGroup,
    installingId,
    installingReview,
    message,
    reviewModules,
    savingChannelKey,
    t
  ])

  const defaultChannelOptions = useMemo(() => (
    moduleUpdateChannelOptions.map(channel => ({
      label: t(`moduleUpdates.channelOptions.${channel}`),
      value: channel
    }))
  ), [t])
  const currentDefaultChannel = data?.channel ?? 'stable'
  const currentDefaultChannelLabel = t(`moduleUpdates.channelOptions.${currentDefaultChannel}`)
  const headerChannelDisabled = checking || installingId != null || installingGroup != null || installingReview ||
    savingChannelKey != null
  const headerChannelMenuItems = useMemo(() => (
    defaultChannelOptions.map(option => ({
      disabled: headerChannelDisabled || option.value === currentDefaultChannel,
      key: option.value,
      label: option.label,
      onClick: () => updateDefaultChannel(option.value)
    }))
  ), [currentDefaultChannel, defaultChannelOptions, headerChannelDisabled, updateDefaultChannel])

  const moduleChannelOptions = useMemo(() => [
    {
      label: t('moduleUpdates.channelDefaultOption', { channel: currentDefaultChannel }),
      value: 'default'
    },
    ...defaultChannelOptions
  ], [currentDefaultChannel, defaultChannelOptions, t])

  const getGroupChannelValue = (modules: ModuleUpdateItem[]): ModuleChannelSelectValue | 'mixed' => {
    const values = new Set(modules.map(item => item.configuredChannel ?? 'default'))
    if (values.size === 1) {
      return [...values][0] ?? 'default'
    }
    return 'mixed'
  }

  const getChannelLabel = (value: ModuleChannelSelectValue | 'mixed') => {
    if (value === 'mixed') return t('moduleUpdates.channelMixedOption')
    return moduleChannelOptions.find(option => option.value === value)?.label ?? value
  }

  const renderActionMetrics = (
    available: number,
    pendingActivation: number,
    className?: string
  ) => {
    const hasAvailable = available > 0
    const hasPendingActivation = pendingActivation > 0

    if (!hasAvailable && !hasPendingActivation) return null

    return (
      <div className={['module-management-view__action-metrics', className].filter(Boolean).join(' ')}>
        {hasAvailable && (
          <Tooltip title={t('moduleUpdates.groupAvailableCount', { count: available })}>
            <span
              aria-label={t('moduleUpdates.groupAvailableCount', { count: available })}
              className='module-management-view__action-metric module-management-view__action-metric--available'
            >
              <span className='module-management-view__action-metric-count'>{available}</span>
            </span>
          </Tooltip>
        )}
        {hasPendingActivation && (
          <Tooltip title={t('moduleUpdates.groupPendingActivationCount', { count: pendingActivation })}>
            <span
              aria-label={t('moduleUpdates.groupPendingActivationCount', { count: pendingActivation })}
              className='module-management-view__action-metric module-management-view__action-metric--pending'
            >
              <span className='module-management-view__action-metric-count'>{pendingActivation}</span>
            </span>
          </Tooltip>
        )}
      </div>
    )
  }

  const renderUpdateActions = ({
    available,
    buttonClassName,
    channelControl,
    checkDisabled,
    checkLoading,
    className,
    iconClassName,
    headerMode = false,
    onCheck,
    onUpdate,
    pendingActivation,
    showMetrics = true,
    updateDisabled,
    updateLabel,
    updateLoading
  }: ModuleUpdateActionsOptions) => {
    const checkLabel = t('moduleUpdates.check')
    const actionButtonClassName = [
      'module-management-view__icon-button',
      'module-management-view__action-button',
      buttonClassName
    ].filter(Boolean).join(' ')

    return (
      <div
        className={[
          'module-management-view__actions',
          headerMode ? 'is-route-header-group' : '',
          className
        ].filter(Boolean).join(' ')}
      >
        {channelControl}
        {showMetrics && renderActionMetrics(available, pendingActivation)}
        <Tooltip title={updateLabel}>
          <span
            className={[
              'module-management-view__icon-button-tooltip',
              headerMode ? 'route-container-header__action-segment' : ''
            ].filter(Boolean).join(' ')}
          >
            <Button
              aria-label={updateLabel}
              className={actionButtonClassName}
              size='small'
              type='text'
              disabled={updateDisabled}
              loading={updateLoading}
              icon={<MaterialSymbol className={iconClassName} name='download_for_offline' />}
              onClick={onUpdate}
            />
          </span>
        </Tooltip>
        <Tooltip title={checkLabel}>
          <span
            className={[
              'module-management-view__icon-button-tooltip',
              headerMode ? 'route-container-header__action-segment' : ''
            ].filter(Boolean).join(' ')}
          >
            <Button
              aria-label={checkLabel}
              className={actionButtonClassName}
              size='small'
              type='text'
              disabled={checkDisabled}
              loading={checkLoading}
              icon={<MaterialSymbol className={iconClassName} name='sync' />}
              onClick={onCheck}
            />
          </span>
        </Tooltip>
      </div>
    )
  }

  const renderChangelogEntries = (item: ModuleUpdateItem) => {
    const entries = item.changelog?.entries ?? []
    if (entries.length === 0) {
      return (
        <div className='module-management-view__changelog-empty'>
          {t('moduleUpdates.changelogMissing')}
        </div>
      )
    }

    return (
      <div className='module-management-view__changelog-entries'>
        {entries.map((entry) => {
          const previewLine = pickChangelogPreviewLine(entry.body)
          return (
            <div key={`${item.id}:${entry.version}`} className='module-management-view__changelog-entry'>
              <div className='module-management-view__changelog-entry-title'>
                {t('moduleUpdates.changelogEntryTitle', { version: entry.version })}
              </div>
              <div className='module-management-view__changelog-entry-preview'>
                {previewLine || t('moduleUpdates.changelogMissing')}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const renderChangelogPreview = (item: ModuleUpdateItem) => {
    if (!item.updateAvailable || item.changelog == null) return null
    const fromVersion = item.changelog.fromVersion ?? t('moduleUpdates.versionUnknown')
    const toVersion = item.changelog.toVersion ?? item.latestVersion ?? t('moduleUpdates.versionUnknown')

    return (
      <div className='module-management-view__changelog-preview'>
        <div className='module-management-view__changelog-preview-title'>
          {t('moduleUpdates.changelogRange', { from: fromVersion, to: toVersion })}
        </div>
        {renderChangelogEntries(item)}
      </div>
    )
  }

  const renderModule = (item: ModuleUpdateItem) => {
    const statusKey = getStatusKey(item)
    const statusTone = getStatusTone(statusKey)
    const isInstalling = installingId === item.id
    const controlsDisabled = checking || installingId != null || installingGroup != null || installingReview ||
      savingChannelKey != null
    const moduleAvailable = item.updateAvailable ? 1 : 0
    const modulePendingActivation = item.needsActivation ? 1 : 0
    const versionFallback = t('moduleUpdates.versionUnknown')
    const currentVersion = formatVersion(item.currentVersion, versionFallback)
    const latestVersion = formatVersion(item.latestVersion, versionFallback)
    const latestVersionLabel = t('moduleUpdates.versions.latest', { version: latestVersion })
    const cachedVersion = formatVersion(item.cachedVersion, versionFallback)
    const cachedVersionLabel = t('moduleUpdates.versions.cached', { version: cachedVersion })
    const statusTooltipTitle = (
      <div className='module-management-view__status-tooltip'>
        <div>{latestVersionLabel}</div>
        <div>{cachedVersionLabel}</div>
      </div>
    )
    const statusTooltipText = `${latestVersionLabel} · ${cachedVersionLabel}`
    const moduleTitle = `${item.packageName}@${currentVersion}`
    const selectedModuleChannel = item.configuredChannel ?? 'default'
    const selectedModuleChannelLabel =
      moduleChannelOptions.find(option => option.value === selectedModuleChannel)?.label ??
        selectedModuleChannel
    const moduleChannelMenuItems = moduleChannelOptions.map(option => ({
      disabled: controlsDisabled || option.value === selectedModuleChannel,
      key: option.value,
      label: option.label,
      onClick: () => updateModuleChannel(item, option.value as ModuleChannelSelectValue)
    }))
    const moduleActionLabel = isInstalling
      ? t('moduleUpdates.installing')
      : item.updateAvailable
      ? t('moduleUpdates.update')
      : item.needsActivation
      ? t('moduleUpdates.cached')
      : t('moduleUpdates.upToDate')
    const moduleChannelControl = (
      <Tooltip title={t('moduleUpdates.moduleChannelLabel', { name: item.label })}>
        <Dropdown
          disabled={controlsDisabled}
          menu={{
            items: moduleChannelMenuItems,
            selectedKeys: [selectedModuleChannel]
          }}
          overlayClassName='module-management-view__channel-opener-dropdown'
          placement='bottomRight'
          trigger={['click']}
        >
          <button
            aria-label={t('moduleUpdates.moduleChannelLabel', { name: item.label })}
            className='module-management-view__channel-opener module-management-view__channel-opener--module'
            disabled={controlsDisabled}
            title={t('moduleUpdates.moduleChannelLabel', { name: item.label })}
            type='button'
          >
            <span className='module-management-view__channel-opener-primary'>
              {selectedModuleChannelLabel}
            </span>
            <span className='module-management-view__channel-opener-menu' aria-hidden='true'>
              <MaterialSymbol className='module-management-view__channel-opener-icon' name='expand_more' />
            </span>
          </button>
        </Dropdown>
      </Tooltip>
    )

    return (
      <div key={item.id} className='module-management-view__module'>
        <div className='module-management-view__module-main'>
          <div className='module-management-view__module-heading'>
            <span className='module-management-view__module-name'>{moduleTitle}</span>
            <Tooltip title={statusTooltipTitle}>
              <span
                aria-label={statusTooltipText}
                className='module-management-view__status-tag-trigger'
                title={statusTooltipText}
              >
                <Tag color={statusTone}>{t(`moduleUpdates.status.${statusKey}`)}</Tag>
              </span>
            </Tooltip>
          </div>
          {item.errorMessage != null && (
            <div className='module-management-view__error'>{item.errorMessage}</div>
          )}
          {renderChangelogPreview(item)}
        </div>
        <div className='module-management-view__module-side'>
          {renderUpdateActions({
            available: moduleAvailable,
            channelControl: moduleChannelControl,
            checkDisabled: installingId != null || installingGroup != null || installingReview ||
              savingChannelKey != null,
            checkLoading: checking,
            className: 'module-management-view__actions--module',
            onCheck: refresh,
            onUpdate: () => installModule(item),
            pendingActivation: modulePendingActivation,
            showMetrics: false,
            updateDisabled: !item.updateAvailable || controlsDisabled,
            updateLabel: moduleActionLabel,
            updateLoading: isInstalling
          })}
        </div>
      </div>
    )
  }

  const renderGroupLabel = (group: ModuleUpdateGroupSummary) => (
    <div className='module-management-view__group-heading'>
      <span className='module-management-view__group-title'>{t(`moduleUpdates.groups.${group.key}`)}</span>
      {renderActionMetrics(
        group.available,
        group.pendingActivation,
        'module-management-view__group-heading-metrics'
      )}
    </div>
  )

  const renderGroupExtra = (group: ModuleUpdateGroupSummary) => {
    const isInstallingGroup = installingGroup === group.key
    const groupActionLabel = isInstallingGroup ? t('moduleUpdates.groupInstalling') : t('moduleUpdates.updateGroup')
    const groupControlsDisabled = checking || installingId != null || installingGroup != null ||
      installingReview || savingChannelKey != null
    const groupChannelValue = getGroupChannelValue(group.modules)
    const groupChannelLabel = getChannelLabel(groupChannelValue)
    const groupChannelMenuItems = moduleChannelOptions.map(option => ({
      disabled: groupControlsDisabled || option.value === groupChannelValue,
      key: option.value,
      label: option.label,
      onClick: () => updateGroupChannel(group, option.value as ModuleChannelSelectValue)
    }))
    const groupName = t(`moduleUpdates.groups.${group.key}`)
    const groupChannelControl = (
      <Tooltip title={t('moduleUpdates.groupChannelLabel', { group: groupName })}>
        <Dropdown
          disabled={groupControlsDisabled}
          menu={{
            items: groupChannelMenuItems,
            selectedKeys: groupChannelValue === 'mixed' ? [] : [groupChannelValue]
          }}
          overlayClassName='module-management-view__channel-opener-dropdown'
          placement='bottomRight'
          trigger={['click']}
        >
          <button
            aria-label={t('moduleUpdates.groupChannelLabel', { group: groupName })}
            className='module-management-view__channel-opener module-management-view__channel-opener--group'
            disabled={groupControlsDisabled}
            title={t('moduleUpdates.groupChannelLabel', { group: groupName })}
            type='button'
          >
            <span className='module-management-view__channel-opener-primary'>
              {groupChannelLabel}
            </span>
            <span className='module-management-view__channel-opener-menu' aria-hidden='true'>
              <MaterialSymbol className='module-management-view__channel-opener-icon' name='expand_more' />
            </span>
          </button>
        </Dropdown>
      </Tooltip>
    )

    return (
      <div className='module-management-view__group-extra' onClick={event => event.stopPropagation()}>
        {renderUpdateActions({
          available: group.available,
          buttonClassName: 'module-management-view__group-action-button',
          channelControl: groupChannelControl,
          checkDisabled: installingId != null || installingGroup != null || installingReview ||
            savingChannelKey != null,
          checkLoading: checking,
          className: 'module-management-view__actions--group',
          onCheck: refresh,
          onUpdate: () => installGroup(group),
          pendingActivation: group.pendingActivation,
          showMetrics: false,
          updateDisabled: group.available === 0 ||
            checking ||
            installingId != null ||
            installingReview ||
            (installingGroup != null && !isInstallingGroup) ||
            savingChannelKey != null,
          updateLabel: groupActionLabel,
          updateLoading: isInstallingGroup
        })}
      </div>
    )
  }

  const headerChannelControl = (
    <span className='route-container-header__action-segment'>
      <Tooltip title={t('moduleUpdates.defaultChannel')}>
        <Dropdown
          disabled={headerChannelDisabled}
          menu={{
            items: headerChannelMenuItems,
            selectedKeys: [currentDefaultChannel]
          }}
          overlayClassName='module-management-view__channel-opener-dropdown'
          placement='bottomRight'
          trigger={['click']}
        >
          <button
            aria-label={t('moduleUpdates.defaultChannel')}
            className='module-management-view__channel-opener'
            disabled={headerChannelDisabled}
            title={t('moduleUpdates.defaultChannel')}
            type='button'
          >
            <span className='module-management-view__channel-opener-primary'>
              {currentDefaultChannelLabel}
            </span>
            <span className='module-management-view__channel-opener-menu' aria-hidden='true'>
              <MaterialSymbol className='module-management-view__channel-opener-icon' name='expand_more' />
            </span>
          </button>
        </Dropdown>
      </Tooltip>
    </span>
  )
  const headerActions = renderUpdateActions({
    available: moduleSummary.available,
    buttonClassName: 'route-container-header__action-button module-management-view__header-action-button',
    channelControl: headerChannelControl,
    checkDisabled: installingId != null || installingGroup != null || installingReview || savingChannelKey != null,
    checkLoading: checking,
    className: 'module-management-view__header-actions module-management-view__actions--header',
    iconClassName: 'route-container-header__action-icon',
    headerMode: true,
    onCheck: refresh,
    onUpdate: installAll,
    pendingActivation: moduleSummary.pendingActivation,
    showMetrics: false,
    updateDisabled: moduleSummary.available === 0 ||
      checking ||
      installingId != null ||
      installingReview ||
      (installingGroup != null && !isInstallingAll) ||
      savingChannelKey != null,
    updateLabel: isInstallingAll ? t('moduleUpdates.allInstalling') : t('moduleUpdates.updateAll'),
    updateLoading: isInstallingAll
  })
  const reviewInstallDisabled = reviewModules.length === 0 ||
    checking ||
    installingId != null ||
    installingGroup != null ||
    installingReview ||
    savingChannelKey != null
  const reviewInstallLabel = installingReview ? t('moduleUpdates.installing') : t('moduleUpdates.confirmOk')
  const handleReviewExternalLinkClick = useCallback((href: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (!/^https?:\/\//i.test(href) || window.oneworksDesktop?.openExternalUrl == null) return
    event.preventDefault()
    event.stopPropagation()
    openReviewExternalLink(href)
  }, [])

  const getReviewSummaryCategoryTitle = (category: ModuleUpdateSummaryCategory) => {
    switch (category) {
      case 'fix':
        return t('moduleUpdates.changelogSummaryFixes')
      case 'other':
        return t('moduleUpdates.changelogSummaryOther')
      default:
        return t('moduleUpdates.changelogSummaryFeatures')
    }
  }

  const renderSummaryContributor = (contributor: ModuleUpdateSummaryContributor) => (
    <Tooltip key={contributor.login} title={contributor.name}>
      <a
        className='module-management-view__summary-contributor'
        href={contributor.profileUrl}
        target='_blank'
        rel='noreferrer'
        onClick={(event) => handleReviewExternalLinkClick(contributor.profileUrl, event)}
      >
        <img
          className='module-management-view__summary-contributor-avatar'
          src={contributor.avatarUrl}
          alt=''
          aria-hidden='true'
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
        />
        <span className='module-management-view__summary-contributor-name'>
          @{contributor.login}
        </span>
      </a>
    </Tooltip>
  )

  const renderReviewDetailLinks = () => (
    <div className='module-management-view__review-detail-links'>
      <div className='module-management-view__review-detail-links-title'>
        {t('moduleUpdates.reviewDetailPagesTitle')}
      </div>
      <button
        type='button'
        className='module-management-view__review-detail-link'
        onClick={() => openReviewDetail('modules')}
      >
        <MaterialSymbol
          className='module-management-view__review-detail-link-icon'
          name='package_2'
          aria-hidden='true'
        />
        <span className='module-management-view__review-detail-link-main'>
          <span className='module-management-view__review-detail-link-title'>
            {t('moduleUpdates.reviewModulesTitle')}
          </span>
          <span className='module-management-view__review-detail-link-description'>
            {t('moduleUpdates.reviewModulesDescription')}
          </span>
        </span>
        <MaterialSymbol
          className='module-management-view__review-detail-link-arrow'
          name='chevron_right'
          aria-hidden='true'
        />
      </button>
      <button
        type='button'
        className='module-management-view__review-detail-link'
        onClick={() => openReviewDetail('changelog')}
      >
        <MaterialSymbol
          className='module-management-view__review-detail-link-icon'
          name='article'
          aria-hidden='true'
        />
        <span className='module-management-view__review-detail-link-main'>
          <span className='module-management-view__review-detail-link-title'>
            {t('moduleUpdates.reviewChangelogTitle')}
          </span>
          <span className='module-management-view__review-detail-link-description'>
            {t('moduleUpdates.reviewChangelogDescription')}
          </span>
        </span>
        <MaterialSymbol
          className='module-management-view__review-detail-link-arrow'
          name='chevron_right'
          aria-hidden='true'
        />
      </button>
    </div>
  )

  const renderReviewSummary = () => (
    <div className='module-management-view__review-summary'>
      <h1 className='module-management-view__review-summary-title'>
        {t('moduleUpdates.changelogSummaryTitle')}
      </h1>
      <div className='module-management-view__review-summary-intro'>
        <MarkdownContent content={t('moduleUpdates.changelogSummaryIntro', { count: reviewModules.length })} />
      </div>
      {reviewSummaryChanges.length === 0
        ? (
          <div className='module-management-view__review-empty'>
            {t('moduleUpdates.changelogSummaryMissingHint')}
          </div>
        )
        : moduleUpdateSummaryCategoryOrder.map((category) => {
          const categoryChanges = reviewSummaryChanges.filter(change => change.category === category)
          if (categoryChanges.length === 0) return null

          return (
            <section key={category} className='module-management-view__summary-section'>
              <h2 className='module-management-view__summary-section-title'>
                {getReviewSummaryCategoryTitle(category)}
              </h2>
              <ul className='module-management-view__summary-list'>
                {categoryChanges.map(change => (
                  <li key={change.key} className='module-management-view__summary-item'>
                    <span className='module-management-view__summary-bullet' aria-hidden='true'>•</span>
                    <div className='module-management-view__summary-item-content'>
                      <div className='module-management-view__summary-item-title'>
                        <MarkdownContent
                          content={change.text}
                          openLinksInNewTab
                          onLinkClick={handleReviewExternalLinkClick}
                        />
                      </div>
                      <div className='module-management-view__summary-item-meta'>
                        <span className='module-management-view__summary-item-module'>
                          {change.moduleLabel}
                        </span>
                        {change.contributors.length > 0 && (
                          <div className='module-management-view__summary-contributors'>
                            {change.contributors.map(renderSummaryContributor)}
                          </div>
                        )}
                      </div>
                      {change.details.length > 0 && (
                        <div className='module-management-view__summary-item-details'>
                          {change.details.map((detail, detailIndex) => (
                            <MarkdownContent
                              key={`${change.key}:detail:${detailIndex}`}
                              content={detail}
                              openLinksInNewTab
                              onLinkClick={handleReviewExternalLinkClick}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      {renderReviewDetailLinks()}
    </div>
  )

  const renderReviewContent = () => (
    <div className='module-management-view__review'>
      {reviewModules.length === 0
        ? (
          <div className='module-management-view__review-empty'>
            {t('moduleUpdates.reviewEmpty')}
          </div>
        )
        : (
          <>
            <div className='module-management-view__review-content'>
              {reviewDetail === 'summary'
                ? renderReviewSummary()
                : (
                  <div className='module-management-view__review-markdown'>
                    <MarkdownContent
                      content={reviewMarkdown}
                      openLinksInNewTab
                      onLinkClick={handleReviewExternalLinkClick}
                    />
                  </div>
                )}
            </div>
            <div className='module-management-view__review-footer'>
              <Button
                type='primary'
                className='module-management-view__review-install-button'
                disabled={reviewInstallDisabled}
                loading={installingReview}
                onClick={installReviewModules}
                icon={
                  <MaterialSymbol
                    className='module-management-view__review-install-button-icon'
                    name='download_for_offline'
                  />
                }
              >
                {reviewInstallLabel}
              </Button>
            </div>
          </>
        )}
    </div>
  )

  const isReviewMode = reviewScope != null
  const reviewTitle = reviewDetail === 'modules'
    ? t('moduleUpdates.reviewModulesTitle')
    : reviewDetail === 'changelog'
    ? t('moduleUpdates.reviewChangelogTitle')
    : t('moduleUpdates.reviewTitle')
  const routeHeader = isReviewMode
    ? (
      <RouteContainerHeader
        breadcrumb={{
          ancestors: reviewDetail === 'summary'
            ? undefined
            : [{
              title: t('moduleUpdates.reviewTitle'),
              onSelect: backFromReviewDetail
            }],
          currentTitle: reviewTitle,
          onBack: reviewDetail === 'summary' ? closeInstallReview : backFromReviewDetail,
          parentTitle: t('moduleUpdates.title')
        }}
        icon='deployed_code_update'
        onOpenSidebar={openRouteSidebar}
        title={reviewTitle}
      />
    )
    : (
      <RouteContainerHeader
        actions={headerActions}
        icon='deployed_code_update'
        onOpenSidebar={openRouteSidebar}
        title={t('moduleUpdates.title')}
      />
    )

  return (
    <RouteContainerLayout
      className={`module-management-view ${isCompactView ? 'module-management-view--compact' : ''}`}
      bodyClassName='module-management-view__body'
      contentInset
      header={routeHeader}
    >
      <div className='module-management-view__surface'>
        {errorMessage != null && (
          <Alert
            type='error'
            showIcon
            message={errorMessage}
          />
        )}

        {checking && data == null
          ? (
            <div className='module-management-view__loading'>
              <Spin />
            </div>
          )
          : isReviewMode
          ? renderReviewContent()
          : (
            <Collapse
              accordion
              activeKey={activeGroupKey}
              bordered={false}
              className='module-management-view__groups'
              expandIcon={({ isActive }) => (
                <MaterialSymbol
                  className={`module-management-view__group-expand-icon ${isActive ? 'is-expanded' : ''}`}
                  name='expand_more'
                />
              )}
              items={moduleGroups.map(group => ({
                children: (
                  <div className='module-management-view__group-list'>
                    {group.modules.map(renderModule)}
                  </div>
                ),
                extra: renderGroupExtra(group),
                key: group.key,
                label: renderGroupLabel(group)
              }))}
              onChange={setActiveGroupKey}
            />
          )}
      </div>
    </RouteContainerLayout>
  )
}
