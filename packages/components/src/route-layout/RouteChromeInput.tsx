import type { InputHTMLAttributes, ReactNode } from 'react'

export interface RouteChromeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  fieldClassName?: string
  prefix?: ReactNode
  suffix?: ReactNode
}

export function RouteChromeInput({
  className,
  fieldClassName,
  prefix,
  suffix,
  ...props
}: RouteChromeInputProps) {
  return (
    <label className={['route-chrome-input', className].filter(Boolean).join(' ')}>
      {prefix != null && (
        <span className='route-chrome-input__prefix'>
          {prefix}
        </span>
      )}
      <input
        {...props}
        className={['route-chrome-input__field', fieldClassName].filter(Boolean).join(' ')}
      />
      {suffix != null && (
        <span className='route-chrome-input__suffix'>
          {suffix}
        </span>
      )}
    </label>
  )
}
