import type { ComposerStarterListLabels } from './ComposerStarterList'

export function ComposerStarterListFooter({
  defaultVisibleItemCount,
  disabled,
  hiddenRemainingCount,
  isExpanded,
  totalRemainingCount,
  labels,
  onCollapse,
  onExpand
}: {
  defaultVisibleItemCount: number
  disabled: boolean
  hiddenRemainingCount: number
  isExpanded: boolean
  totalRemainingCount: number
  labels: ComposerStarterListLabels
  onCollapse: () => void
  onExpand: () => void
}) {
  const shouldShowExpand = !isExpanded && hiddenRemainingCount > 0
  const shouldShowCollapse = isExpanded &&
    totalRemainingCount > defaultVisibleItemCount
  if (!shouldShowExpand && !shouldShowCollapse) return null

  return (
    <div className='composer-starter-list__footer'>
      {shouldShowExpand && (
        <button
          type='button'
          className='composer-starter-list__more-button'
          disabled={disabled}
          onClick={onExpand}
        >
          <span className='material-symbols-rounded'>expand_more</span>
          <span>{labels.showMore(hiddenRemainingCount)}</span>
        </button>
      )}
      {shouldShowCollapse && (
        <button
          type='button'
          className='composer-starter-list__more-button'
          disabled={disabled}
          onClick={onCollapse}
        >
          <span className='material-symbols-rounded'>expand_less</span>
          <span>{labels.showLess}</span>
        </button>
      )}
    </div>
  )
}
