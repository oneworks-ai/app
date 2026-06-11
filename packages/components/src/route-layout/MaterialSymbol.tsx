import type { HTMLAttributes } from 'react'

export interface MaterialSymbolProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'dangerouslySetInnerHTML'>
{
  filled?: boolean
  name: string
}

export function MaterialSymbol({
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
  className,
  filled = false,
  name,
  role,
  title,
  ...props
}: MaterialSymbolProps) {
  const classes = [
    'material-symbols-rounded',
    filled ? 'is-filled filled' : '',
    className
  ].filter(Boolean).join(' ')
  const resolvedAriaHidden = ariaHidden ?? (
    ariaLabel == null && role == null && title == null ? true : undefined
  )

  return (
    <span
      className={classes}
      role={role}
      aria-hidden={resolvedAriaHidden}
      aria-label={ariaLabel}
      title={title}
      {...props}
    >
      {name}
    </span>
  )
}
