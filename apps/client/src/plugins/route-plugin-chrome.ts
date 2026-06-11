import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import type { RouteContainerHeaderActionItem } from '@oneworks/components/route-layout'

import type { NavRailWindowBarAction } from '#~/components/NavRail'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import type {
  RouteSidebarListContextMenuFactory,
  RouteSidebarListContextMenuStatic,
  RouteSidebarListContextMenuTarget
} from '#~/components/layout/route-sidebar-context'
import { buildNavRailMoreMenuItems, getNavRailMoreMenuSelectedKeys } from '#~/components/nav-rail-more-menu'
import type { NavRailMoreMenuItem, NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'
import { getClientBase } from '#~/runtime-config'

import { resolvePluginContributionText } from './plugin-i18n'
import type { PluginContributionRouteHeaderAction, PluginContributionRouteMenuItem } from './plugin-manifest'
import { usePluginCommandExecutor, usePluginSlot } from './plugin-slots'

interface RouteContributionTarget {
  id?: string
  pluginScope?: string
  route?: string
  targetRoute?: string
  targetRoutes?: string[]
}

const normalizeRouteTargets = (contribution: RouteContributionTarget) =>
  [
    contribution.targetRoute,
    ...(contribution.targetRoutes ?? [])
  ].filter((target): target is string => typeof target === 'string' && target.trim() !== '')

const ROUTE_KEY_ALIASES: Record<string, string[]> = {
  config: ['settings'],
  settings: ['config']
}
const DEFAULT_CLIENT_BASE = '/ui'
const warnedRouteTargetContributionKeys = new Set<string>()

const normalizeRoutePath = (value: string) => {
  let next = value.trim()
  if (next === '') return '/'
  if (!next.startsWith('/')) next = `/${next}`
  while (next.length > 1 && next.endsWith('/')) {
    next = next.slice(0, -1)
  }
  return next
}

const getRouteKeyCandidates = (routeKey: string) =>
  new Set([
    routeKey,
    ...(ROUTE_KEY_ALIASES[routeKey] ?? [])
  ])

const getRoutePathCandidates = (pathname: string) => {
  const normalizedPathname = normalizeRoutePath(pathname)
  const normalizedBase = normalizeRoutePath(getClientBase())
  const knownBases = Array.from(
    new Set([
      normalizedBase,
      normalizeRoutePath(DEFAULT_CLIENT_BASE)
    ])
  ).filter(base => base !== '/')
  const candidates = new Set([normalizedPathname])

  for (const base of knownBases) {
    if (normalizedPathname === base) {
      candidates.add('/')
    } else if (normalizedPathname.startsWith(`${base}/`)) {
      candidates.add(normalizeRoutePath(normalizedPathname.slice(base.length)))
    } else {
      candidates.add(normalizeRoutePath(`${base}${normalizedPathname === '/' ? '' : normalizedPathname}`))
    }
  }

  return candidates
}

const routePathMatches = (target: string, pathCandidates: Set<string>) => {
  if (!target.startsWith('/')) return false

  if (target.endsWith('/*')) {
    const prefixCandidates = getRoutePathCandidates(target.slice(0, -2))
    return [...pathCandidates].some(pathname =>
      [...prefixCandidates].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
    )
  }

  const targetCandidates = getRoutePathCandidates(target)
  return [...targetCandidates].some(targetPath => pathCandidates.has(targetPath))
}

export const resolveRouteContributionText = resolvePluginContributionText

export const routeTargetMatches = ({
  contribution,
  pathname,
  routeKey
}: {
  contribution: RouteContributionTarget
  pathname: string
  routeKey: string
}) => {
  const targets = normalizeRouteTargets(contribution)
  if (targets.length === 0) {
    if (
      import.meta.env.DEV &&
      typeof contribution.route === 'string' &&
      contribution.route.trim() !== ''
    ) {
      const warningKey = `${contribution.pluginScope ?? 'unknown'}:${contribution.id ?? contribution.route}`
      if (!warnedRouteTargetContributionKeys.has(warningKey)) {
        warnedRouteTargetContributionKeys.add(warningKey)
        console.warn(
          `[plugin route chrome] "${warningKey}" defines route navigation without targetRoute/targetRoutes. ` +
            'It will be shown on every route; set targetRoute/targetRoutes to limit the host route.'
        )
      }
    }
    return true
  }

  const routeKeyCandidates = getRouteKeyCandidates(routeKey)
  const pathCandidates = getRoutePathCandidates(pathname)

  return targets.some((target) => {
    if (routeKeyCandidates.has(target)) return true
    return routePathMatches(target, pathCandidates)
  })
}

const hasExecutableCommand = <T extends { command?: string | null }>(
  contribution: T
): contribution is T & { command: string } => (
  typeof contribution.command === 'string' && contribution.command.trim() !== ''
)

export function useRoutePluginHeaderActions(routeKey: string): RouteContainerHeaderActionItem[] {
  const { i18n } = useTranslation()
  const location = useLocation()
  const executePluginCommand = usePluginCommandExecutor()
  const contributions = usePluginSlot<PluginContributionRouteHeaderAction>('route.header.actions')
  const language = i18n.resolvedLanguage ?? i18n.language

  return useMemo(() =>
    contributions
      .filter(contribution =>
        routeTargetMatches({
          contribution,
          pathname: location.pathname,
          routeKey
        }) && hasExecutableCommand(contribution)
      )
      .map((contribution): RouteContainerHeaderActionItem => {
        const label = resolvePluginContributionText(contribution, 'title', language) ?? contribution.title
        const title = resolvePluginContributionText(contribution, 'description', language) ?? label
        return {
          active: contribution.active,
          activeIcon: contribution.activeIcon,
          activeLabel: contribution.activeLabel,
          activeTitle: contribution.activeTitle,
          danger: contribution.danger,
          disabled: contribution.disabled,
          icon: contribution.icon ?? 'extension',
          key: `plugin:${contribution.pluginScope}:${contribution.id}`,
          label,
          shortcut: contribution.shortcut,
          title,
          onSelect: () => {
            void executePluginCommand?.(contribution.pluginScope, contribution.command)
          }
        }
      }), [contributions, executePluginCommand, language, location.pathname, routeKey])
}

export function useRoutePluginWindowBarActions(routeKey: string): NavRailWindowBarAction[] {
  const { i18n } = useTranslation()
  const location = useLocation()
  const executePluginCommand = usePluginCommandExecutor()
  const contributions = usePluginSlot<PluginContributionRouteHeaderAction>('route.windowBar.actions')
  const language = i18n.resolvedLanguage ?? i18n.language

  return useMemo(() =>
    contributions
      .filter(contribution =>
        routeTargetMatches({
          contribution,
          pathname: location.pathname,
          routeKey
        }) && hasExecutableCommand(contribution)
      )
      .map((contribution): NavRailWindowBarAction => {
        const label = resolvePluginContributionText(contribution, 'title', language) ?? contribution.title
        const title = resolvePluginContributionText(contribution, 'description', language) ?? label
        return {
          active: contribution.active,
          activeIcon: contribution.activeIcon,
          activeLabel: contribution.activeLabel,
          activeTitle: contribution.activeTitle,
          danger: contribution.danger,
          disabled: contribution.disabled,
          icon: contribution.icon ?? 'extension',
          key: `plugin:${contribution.pluginScope}:${contribution.id}`,
          label,
          shortcut: contribution.shortcut,
          title,
          onSelect: () => {
            void executePluginCommand?.(contribution.pluginScope, contribution.command)
          }
        }
      }), [contributions, executePluginCommand, language, location.pathname, routeKey])
}

function useRouteContributionRunner() {
  const navigate = useNavigate()
  const executePluginCommand = usePluginCommandExecutor()

  return useCallback((contribution: PluginContributionRouteMenuItem & { pluginScope: string }, payload?: unknown) => {
    if (contribution.command != null && contribution.command.trim() !== '') {
      void executePluginCommand?.(contribution.pluginScope, contribution.command, payload)
      return
    }

    if (contribution.route != null && contribution.route.trim() !== '') {
      void navigate(contribution.route)
      return
    }

    if (contribution.href != null && contribution.href.trim() !== '') {
      window.open(contribution.href, '_blank', 'noopener,noreferrer')
    }
  }, [executePluginCommand, navigate])
}

type ScopedRouteMenuContribution = PluginContributionRouteMenuItem & { pluginScope: string }

export const buildRoutePluginSidebarContextMenu = ({
  contributions,
  isMac,
  language,
  pathname,
  routeKey,
  target,
  onRun
}: {
  contributions: ScopedRouteMenuContribution[]
  isMac: boolean
  language: string
  pathname: string
  routeKey: string
  target?: RouteSidebarListContextMenuTarget
  onRun: (contribution: ScopedRouteMenuContribution, payload?: unknown) => void
}): RouteSidebarListContextMenuStatic => {
  const commandPayload = target == null
    ? undefined
    : {
      kind: 'routeSidebarContextMenu',
      pathname,
      routeKey,
      target
    }
  const items: NavRailMoreMenuItem[] = contributions
    .filter(contribution =>
      routeTargetMatches({
        contribution,
        pathname,
        routeKey
      })
    )
    .map(contribution => ({
      active: contribution.active,
      activeIcon: contribution.activeIcon,
      danger: contribution.danger,
      disabled: contribution.disabled,
      icon: contribution.icon ?? 'extension',
      key: `plugin:${contribution.pluginScope}:${contribution.id}`,
      label: resolvePluginContributionText(contribution, 'title', language) ?? contribution.title,
      selected: contribution.selected,
      shortcut: contribution.shortcut,
      title: resolvePluginContributionText(contribution, 'description', language) ??
        resolvePluginContributionText(contribution, 'title', language) ??
        contribution.title,
      onSelect: () => onRun(contribution, commandPayload)
    }))

  if (items.length === 0) return []

  const sections = [{ items, key: `route-plugin-sidebar-context:${routeKey}` }]
  return {
    items: buildNavRailMoreMenuItems({
      closeMenu: () => {},
      isMac,
      sections
    }) ?? [],
    selectedKeys: getNavRailMoreMenuSelectedKeys(sections)
  }
}

export function useRoutePluginMoreMenuSections(routeKey: string): NavRailMoreMenuSection[] {
  const { i18n } = useTranslation()
  const location = useLocation()
  const runContribution = useRouteContributionRunner()
  const contributions = usePluginSlot<PluginContributionRouteMenuItem>('route.moreMenu.items')
  const language = i18n.resolvedLanguage ?? i18n.language

  return useMemo(() => {
    const items = contributions
      .filter(contribution =>
        routeTargetMatches({
          contribution,
          pathname: location.pathname,
          routeKey
        })
      )
      .map(contribution => {
        const label = resolvePluginContributionText(contribution, 'title', language) ?? contribution.title
        const title = resolvePluginContributionText(contribution, 'description', language) ?? label
        return {
          active: contribution.active,
          activeIcon: contribution.activeIcon,
          danger: contribution.danger,
          disabled: contribution.disabled,
          icon: contribution.icon ?? 'extension',
          key: `plugin:${contribution.pluginScope}:${contribution.id}`,
          label,
          selected: contribution.selected,
          shortcut: contribution.shortcut,
          title,
          onSelect: () => runContribution(contribution)
        }
      })

    return items.length === 0
      ? []
      : [{ items, key: `route-plugin-more:${routeKey}` }]
  }, [contributions, language, location.pathname, routeKey, runContribution])
}

export function useRoutePluginSidebarContextMenu(routeKey: string): RouteSidebarListContextMenuFactory {
  const { i18n } = useTranslation()
  const location = useLocation()
  const runContribution = useRouteContributionRunner()
  const contributions = usePluginSlot<PluginContributionRouteMenuItem>('route.sidebar.contextMenu')
  const language = i18n.resolvedLanguage ?? i18n.language
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  return useMemo<RouteSidebarListContextMenuFactory>(() => (target) =>
    buildRoutePluginSidebarContextMenu({
      contributions,
      isMac,
      language,
      pathname: location.pathname,
      routeKey,
      target,
      onRun: runContribution
    }), [contributions, isMac, language, location.pathname, routeKey, runContribution])
}

export function useInstallRoutePluginMoreMenu(routeKey: string) {
  const { clearRouteMoreMenu, hasRouteSidebarProvider, setRouteMoreMenu } = useRouteSidebar()
  const sections = useRoutePluginMoreMenuSections(routeKey)

  useEffect(() => {
    const key = `route-plugin-more:${routeKey}`
    if (!hasRouteSidebarProvider || sections.length === 0) {
      clearRouteMoreMenu(key)
      return
    }

    setRouteMoreMenu({
      key,
      sections
    })

    return () => clearRouteMoreMenu(key)
  }, [
    clearRouteMoreMenu,
    hasRouteSidebarProvider,
    routeKey,
    sections,
    setRouteMoreMenu
  ])
}

export function useInstallRoutePluginWindowBarActions(routeKey: string) {
  const { clearRouteWindowBar, hasRouteSidebarProvider, setRouteWindowBar } = useRouteSidebar()
  const actions = useRoutePluginWindowBarActions(routeKey)

  useEffect(() => {
    const key = `route-plugin-window-bar:${routeKey}`
    if (!hasRouteSidebarProvider || actions.length === 0) {
      clearRouteWindowBar(key)
      return
    }

    setRouteWindowBar({
      actions,
      key
    })

    return () => clearRouteWindowBar(key)
  }, [
    actions,
    clearRouteWindowBar,
    hasRouteSidebarProvider,
    routeKey,
    setRouteWindowBar
  ])
}

export function useRoutePluginChrome(routeKey: string) {
  const headerActions = useRoutePluginHeaderActions(routeKey)
  const sidebarContextMenuItems = useRoutePluginSidebarContextMenu(routeKey)

  useInstallRoutePluginMoreMenu(routeKey)
  useInstallRoutePluginWindowBarActions(routeKey)

  return useMemo(() => ({
    headerActions,
    sidebarContextMenuItems
  }), [headerActions, sidebarContextMenuItems])
}
