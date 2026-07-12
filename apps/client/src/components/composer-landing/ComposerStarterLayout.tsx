import './ComposerStarterLayout.scss'

import type { ReactNode } from 'react'

import { ComposerStack } from './ComposerLanding'

interface ComposerStarterLayoutProps {
  className?: string
  composer: ReactNode
  composerClassName?: string
  contentClassName?: string
  introduction?: ReactNode
  introductionClassName?: string
  main?: ReactNode
  mainClassName?: string
}

export function ComposerStarterLayout({
  className,
  composer,
  composerClassName,
  contentClassName,
  introduction,
  introductionClassName,
  main,
  mainClassName
}: ComposerStarterLayoutProps) {
  return (
    <div
      className={[
        'composer-content-frame',
        'composer-starter-layout',
        introduction != null ? 'has-introduction' : '',
        main != null ? 'has-starter-list' : '',
        className
      ].filter(Boolean).join(' ')}
    >
      <div className={['composer-starter-layout__content', contentClassName].filter(Boolean).join(' ')}>
        {introduction != null && (
          <div
            className={[
              'composer-starter-layout__introduction',
              introductionClassName
            ].filter(Boolean).join(' ')}
          >
            {introduction}
          </div>
        )}
        <div className={['composer-starter-layout__composer', composerClassName].filter(Boolean).join(' ')}>
          <ComposerStack>
            {composer}
          </ComposerStack>
        </div>
        {main != null && (
          <div className={['composer-starter-layout__main', mainClassName].filter(Boolean).join(' ')}>
            {main}
          </div>
        )}
      </div>
    </div>
  )
}
