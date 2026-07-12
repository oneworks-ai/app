import './ComposerStarterGuide.scss'

import type { ReactNode } from 'react'

import { ComposerStarterLayout } from './ComposerStarterLayout'
import type { ComposerStarterListLabels, ComposerStarterListStorageKeys } from './ComposerStarterList'
import { ComposerStarterList } from './ComposerStarterList'
import type { ComposerStarterListItem } from './composer-starter-list-items'

export function ComposerStarterGuide<TValue>({
  className,
  composer,
  description,
  icon,
  items,
  labels,
  storageKeys,
  onSelect
}: {
  className?: string
  composer: ReactNode
  description: string
  icon: string
  items: Array<ComposerStarterListItem<TValue>>
  labels: ComposerStarterListLabels
  storageKeys?: ComposerStarterListStorageKeys
  onSelect: (item: ComposerStarterListItem<TValue>) => void
}) {
  return (
    <ComposerStarterLayout
      className={['composer-starter-guide', className].filter(Boolean).join(' ')}
      composer={composer}
      introduction={
        <div className='composer-starter-guide__introduction'>
          <span
            className='material-symbols-rounded composer-starter-guide__introduction-icon'
            aria-hidden='true'
          >
            {icon}
          </span>
          <p>{description}</p>
        </div>
      }
      main={
        <ComposerStarterList
          items={items}
          labels={labels}
          storageKeys={storageKeys}
          onSelect={onSelect}
        />
      }
    />
  )
}
