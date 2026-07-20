import { Button } from 'antd'
import type { ButtonProps } from 'antd'
import { forwardRef } from 'react'
import type { ReactNode } from 'react'

import { ShortcutTooltip } from './ShortcutTooltip.js'
import type { ShortcutTooltipTitle } from './ShortcutTooltip.js'

export interface RouteHeaderActionButtonProps
  extends Omit<ButtonProps, 'aria-label' | 'children' | 'className' | 'icon' | 'title' | 'type'>
{
  active?: boolean
  buttonClassName?: string
  danger?: boolean
  icon: ReactNode
  isMac: boolean
  label: string
  pressed?: boolean
  shortcut?: string
  tooltipEnabled?: boolean
  tooltipTitle?: ShortcutTooltipTitle | null
}

export const RouteHeaderActionButton = forwardRef<HTMLDivElement, RouteHeaderActionButtonProps>(({
  active,
  buttonClassName,
  danger,
  disabled,
  icon,
  isMac,
  label,
  pressed,
  shortcut,
  tooltipEnabled = true,
  tooltipTitle,
  ...buttonProps
}, ref) => {
  const resolvedTitle = tooltipTitle ?? label
  const resolvedPressed = pressed ?? (active == null ? undefined : active)

  return (
    <ShortcutTooltip
      ref={ref}
      isMac={isMac}
      shortcut={shortcut}
      title={resolvedTitle}
      placement='bottom'
      targetClassName='route-container-header__action-segment'
      enabled={tooltipEnabled && tooltipTitle !== null}
    >
      <Button
        {...buttonProps}
        type='text'
        className={[
          'route-container-header__action-button',
          active === true ? 'is-active' : '',
          danger === true ? 'is-danger' : '',
          buttonClassName
        ].filter(Boolean).join(' ')}
        disabled={disabled}
        aria-label={label}
        aria-pressed={resolvedPressed}
        icon={icon}
      />
    </ShortcutTooltip>
  )
})

RouteHeaderActionButton.displayName = 'RouteHeaderActionButton'
