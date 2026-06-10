import './ShortcutTooltip.scss'

import { Tooltip } from 'antd'
import type { TooltipPlacement } from 'antd/es/tooltip'
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { formatShortcutLabel } from '#~/utils/shortcutUtils'
import { ShortcutDisplay } from './ShortcutDisplay'

type ShortcutTooltipTitle = React.ReactNode | ((shortcutLabel: string) => React.ReactNode)

type ShortcutTooltipProps = {
  shortcut?: string
  isMac: boolean
  title: ShortcutTooltipTitle
  children: React.ReactNode
  placement?: TooltipPlacement
  align?: React.ComponentProps<typeof Tooltip>['align']
  arrow?: React.ComponentProps<typeof Tooltip>['arrow']
  enabled?: boolean
  targetClassName?: string
} & React.ComponentPropsWithoutRef<'div'>

const resolveShortcutTooltipTitle = (title: ShortcutTooltipTitle, shortcutLabel: string) => {
  if (typeof title === 'function') {
    return title(shortcutLabel)
  }

  return title
}

export const ShortcutTooltip = forwardRef<HTMLDivElement, ShortcutTooltipProps>(({
  shortcut,
  isMac,
  title,
  children,
  placement = 'top',
  align,
  arrow,
  enabled = true,
  targetClassName,
  className,
  ...divProps
}, ref) => {
  const { isTouchInteraction } = useResponsiveLayout()
  const [open, setOpen] = useState(false)
  const suppressHoverRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)
  const {
    onClickCapture,
    onPointerDownCapture,
    onPointerEnter,
    onPointerLeave,
    ...restDivProps
  } = divProps
  const shortcutLabel = useMemo(() => formatShortcutLabel(shortcut, isMac), [isMac, shortcut])
  const resolvedTitle = useMemo(() => {
    if (!enabled || isTouchInteraction) {
      return null
    }

    return resolveShortcutTooltipTitle(title, shortcutLabel)
  }, [enabled, isTouchInteraction, shortcutLabel, title])
  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])
  const closeWithDelay = useCallback(() => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, 140)
  }, [clearCloseTimer])
  useEffect(() => {
    if (resolvedTitle == null) {
      clearCloseTimer()
      setOpen(false)
    }
  }, [clearCloseTimer, resolvedTitle])
  useEffect(() => clearCloseTimer, [clearCloseTimer])
  const closeForAction = useCallback(() => {
    clearCloseTimer()
    suppressHoverRef.current = true
    setOpen(false)
  }, [clearCloseTimer])
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen && suppressHoverRef.current) {
      return
    }

    if (nextOpen) {
      clearCloseTimer()
      setOpen(true)
      return
    }

    closeWithDelay()
  }, [clearCloseTimer, closeWithDelay])
  const handlePointerDownCapture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    closeForAction()
    onPointerDownCapture?.(event)
  }, [closeForAction, onPointerDownCapture])
  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    closeForAction()
    onClickCapture?.(event)
  }, [closeForAction, onClickCapture])
  const handlePointerEnter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    clearCloseTimer()
    onPointerEnter?.(event)
  }, [clearCloseTimer, onPointerEnter])
  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    suppressHoverRef.current = false
    closeWithDelay()
    onPointerLeave?.(event)
  }, [closeWithDelay, onPointerLeave])
  const handleTooltipPointerEnter = useCallback(() => {
    suppressHoverRef.current = false
    clearCloseTimer()
    setOpen(true)
  }, [clearCloseTimer])
  const handleTooltipPointerLeave = useCallback(() => {
    closeWithDelay()
  }, [closeWithDelay])

  const trigger = (
    <div
      {...restDivProps}
      ref={ref}
      className={['shortcut-tooltip-target', targetClassName, className].filter(Boolean).join(' ')}
      onClickCapture={handleClickCapture}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </div>
  )

  if (resolvedTitle == null) {
    return trigger
  }

  return (
    <Tooltip
      title={
        <span
          className='shortcut-tooltip-content'
          onPointerEnter={handleTooltipPointerEnter}
          onPointerLeave={handleTooltipPointerLeave}
        >
          <span className='shortcut-tooltip-content__label'>{resolvedTitle}</span>
          <ShortcutDisplay shortcut={shortcut} isMac={isMac} />
        </span>
      }
      placement={placement}
      align={align}
      arrow={arrow}
      classNames={{ root: 'shortcut-tooltip-popover' }}
      trigger={['hover']}
      open={open}
      onOpenChange={handleOpenChange}
      mouseEnterDelay={.3}
      mouseLeaveDelay={.08}
    >
      {trigger}
    </Tooltip>
  )
})

ShortcutTooltip.displayName = 'ShortcutTooltip'
