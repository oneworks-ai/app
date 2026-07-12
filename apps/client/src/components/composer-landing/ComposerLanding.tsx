import './ComposerLanding.scss'

import type { ReactNode } from 'react'

interface ComposerStackProps {
  children: ReactNode
  className?: string
}

interface ComposerLandingProps {
  children: ReactNode
  className?: string
  compact?: boolean
}

export function ComposerStack({ children, className }: ComposerStackProps) {
  return (
    <div className={['composer-stack', className].filter(Boolean).join(' ')}>
      <div className='composer-stack__inner'>
        {children}
      </div>
    </div>
  )
}

export function ComposerLanding({
  children,
  className,
  compact = false
}: ComposerLandingProps) {
  return (
    <div
      className={['composer-landing', compact ? 'composer-landing--compact' : '', className].filter(Boolean).join(' ')}
    >
      <div className='composer-landing__content'>
        {children}
      </div>
    </div>
  )
}
