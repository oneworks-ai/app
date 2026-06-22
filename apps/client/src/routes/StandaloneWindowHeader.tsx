import { Button, Popover, Slider, Tooltip } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { renderIconAsset } from '#~/components/icons/IconAsset'
import type { IconAsset } from '#~/components/icons/IconAsset'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { useRoutePluginWindowBarActions } from '#~/plugins/route-plugin-chrome'

const WINDOW_OPACITY_MIN_PERCENT = 55
const WINDOW_OPACITY_MAX_PERCENT = 100

interface WindowPresentationState {
  alwaysOnTop: boolean
  opacity: number
}

const normalizeWindowPresentationState = (value: unknown): WindowPresentationState => {
  const state = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<WindowPresentationState>
    : {}
  const opacity = typeof state.opacity === 'number' && Number.isFinite(state.opacity)
    ? state.opacity
    : 1

  return {
    alwaysOnTop: state.alwaysOnTop === true,
    opacity: Math.min(1, Math.max(WINDOW_OPACITY_MIN_PERCENT / 100, opacity))
  }
}

function useStandaloneWindowPresentation() {
  const desktopApi = window.oneworksDesktop
  const [state, setState] = useState<WindowPresentationState>(() => ({
    alwaysOnTop: false,
    opacity: 1
  }))

  useEffect(() => {
    let disposed = false
    void desktopApi?.getCurrentWindowPresentationState?.()
      .then((value) => {
        if (!disposed) {
          setState(normalizeWindowPresentationState(value))
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
    }
  }, [desktopApi])

  const setAlwaysOnTop = useCallback((nextAlwaysOnTop: boolean) => {
    setState(current => ({ ...current, alwaysOnTop: nextAlwaysOnTop }))
    void desktopApi?.setCurrentWindowAlwaysOnTop?.(nextAlwaysOnTop)
      .then(value => setState(normalizeWindowPresentationState(value)))
      .catch(() => {
        setState(current => ({ ...current, alwaysOnTop: !nextAlwaysOnTop }))
      })
  }, [desktopApi])

  const setOpacity = useCallback((nextOpacity: number) => {
    const normalizedOpacity = normalizeWindowPresentationState({ opacity: nextOpacity }).opacity
    setState(current => ({ ...current, opacity: normalizedOpacity }))
    void desktopApi?.setCurrentWindowOpacity?.(normalizedOpacity)
      .then(value => setState(normalizeWindowPresentationState(value)))
      .catch(() => undefined)
  }, [desktopApi])

  return {
    canControlWindow: desktopApi?.getCurrentWindowPresentationState != null,
    setAlwaysOnTop,
    setOpacity,
    state
  }
}

function StandaloneHeaderActionButton({
  active,
  activeIcon,
  activeLabel,
  activeTitle,
  danger,
  disabled,
  icon,
  label,
  title,
  onSelect
}: {
  active?: boolean
  activeIcon?: IconAsset
  activeLabel?: string
  activeTitle?: string
  danger?: boolean
  disabled?: boolean
  icon: IconAsset
  label: string
  title?: string
  onSelect?: () => void
}) {
  const isActive = active === true
  const resolvedIcon = isActive && activeIcon != null ? activeIcon : icon
  const resolvedLabel = isActive ? activeLabel ?? label : label
  const resolvedTitle = isActive ? activeTitle ?? title ?? resolvedLabel : title ?? resolvedLabel

  return (
    <Tooltip title={resolvedTitle} placement='bottom'>
      <Button
        type='text'
        className={[
          'standalone-mobile-debug-route__header-action',
          isActive ? 'is-active' : '',
          danger === true ? 'is-danger' : ''
        ].filter(Boolean).join(' ')}
        disabled={disabled}
        aria-label={resolvedLabel}
        aria-pressed={active == null ? undefined : isActive}
        icon={renderIconAsset({
          active: isActive,
          className: 'standalone-mobile-debug-route__header-action-icon',
          icon: resolvedIcon,
          materialFilled: isActive
        })}
        onClick={onSelect}
      />
    </Tooltip>
  )
}

export function StandaloneWindowHeader({ routeKey, title }: { routeKey: string; title: string }) {
  const { t } = useTranslation()
  const pluginActions = useRoutePluginWindowBarActions(routeKey)
  const presentation = useStandaloneWindowPresentation()
  const opacityPercent = Math.round(presentation.state.opacity * 100)

  return (
    <header className='standalone-mobile-debug-route__header'>
      <div className='standalone-mobile-debug-route__traffic-space' aria-hidden='true' />
      <div className='standalone-mobile-debug-route__title' title={title}>
        <MaterialSymbol className='standalone-mobile-debug-route__title-icon' name='mobile' aria-hidden='true' />
        <span className='standalone-mobile-debug-route__title-text'>{title}</span>
      </div>
      <div className='standalone-mobile-debug-route__header-drag-fill' aria-hidden='true' />
      <div className='standalone-mobile-debug-route__header-actions' aria-label={t('common.actions', 'Actions')}>
        {presentation.canControlWindow && (
          <>
            <StandaloneHeaderActionButton
              active={presentation.state.alwaysOnTop}
              icon='keep'
              label={t('common.pin', 'Pin')}
              onSelect={() => presentation.setAlwaysOnTop(!presentation.state.alwaysOnTop)}
            />
            <Popover
              trigger='click'
              placement='bottomRight'
              overlayClassName='standalone-mobile-debug-route__opacity-popover'
              content={
                <div className='standalone-mobile-debug-route__opacity-control'>
                  <Slider
                    min={WINDOW_OPACITY_MIN_PERCENT}
                    max={WINDOW_OPACITY_MAX_PERCENT}
                    value={opacityPercent}
                    tooltip={{ formatter: value => `${value ?? opacityPercent}%` }}
                    onChange={value => presentation.setOpacity(Number(value) / 100)}
                  />
                </div>
              }
            >
              <span className='standalone-mobile-debug-route__popover-trigger'>
                <StandaloneHeaderActionButton
                  active={opacityPercent < WINDOW_OPACITY_MAX_PERCENT}
                  icon='opacity'
                  label={t('common.opacity', 'Opacity')}
                  title={`${t('common.opacity', 'Opacity')} ${opacityPercent}%`}
                />
              </span>
            </Popover>
          </>
        )}
        {pluginActions.map(action => (
          <StandaloneHeaderActionButton
            key={action.key}
            {...action}
          />
        ))}
      </div>
    </header>
  )
}
