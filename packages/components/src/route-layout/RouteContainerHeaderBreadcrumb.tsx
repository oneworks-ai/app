import type { ReactNode } from 'react'

import { MaterialSymbol } from './MaterialSymbol.js'

export interface RouteContainerHeaderBreadcrumb {
  currentTitle?: ReactNode
  /** Ordered from the outermost ancestor to the nearest ancestor. */
  ancestors?: Array<{
    title: ReactNode
    onSelect?: () => void
  }>
  onBack: () => void
  parentTitle: ReactNode
  ariaLabel?: string
  backLabel?: string
  backIcon?: ReactNode
  separatorIcon?: ReactNode
}

export function RouteContainerHeaderBreadcrumbContent({
  backLabel,
  breadcrumb,
  currentTitle,
  titleText
}: {
  backLabel: string
  breadcrumb: RouteContainerHeaderBreadcrumb
  currentTitle: ReactNode
  titleText?: string
}) {
  const renderSeparator = (key: string) => (
    <span key={key} className='route-container-header__breadcrumb-separator' aria-hidden='true'>
      {breadcrumb.separatorIcon ?? <MaterialSymbol name='chevron_right' />}
    </span>
  )
  const renderAncestor = (
    ancestor: NonNullable<RouteContainerHeaderBreadcrumb['ancestors']>[number],
    index: number
  ) => {
    const ancestorTitle = typeof ancestor.title === 'string' ? ancestor.title : undefined
    if (ancestor.onSelect == null) {
      return (
        <span
          key={`ancestor:${index}`}
          className='route-container-header__breadcrumb-ancestor'
          title={ancestorTitle}
        >
          {ancestor.title}
        </span>
      )
    }

    return (
      <button
        key={`ancestor:${index}`}
        type='button'
        className='route-container-header__breadcrumb-ancestor route-container-header__breadcrumb-ancestor-button'
        title={ancestorTitle}
        onClick={(event) => {
          event.stopPropagation()
          ancestor.onSelect?.()
        }}
      >
        {ancestor.title}
      </button>
    )
  }

  return (
    <div className='route-container-header__breadcrumb' aria-label={breadcrumb.ariaLabel}>
      <button
        type='button'
        className='route-container-header__breadcrumb-back'
        aria-label={breadcrumb.backLabel ?? backLabel}
        onClick={(event) => {
          event.stopPropagation()
          breadcrumb.onBack()
        }}
      >
        {breadcrumb.backIcon ?? <MaterialSymbol name='chevron_left' aria-hidden='true' />}
      </button>
      {breadcrumb.ancestors?.flatMap((ancestor, index) => [
        ...(index === 0 ? [] : [renderSeparator(`separator:ancestor:${index}`)]),
        renderAncestor(ancestor, index)
      ])}
      {breadcrumb.ancestors != null && breadcrumb.ancestors.length > 0
        ? renderSeparator('separator:parent')
        : null}
      <span
        className='route-container-header__breadcrumb-parent'
        title={typeof breadcrumb.parentTitle === 'string' ? breadcrumb.parentTitle : undefined}
      >
        {breadcrumb.parentTitle}
      </span>
      {renderSeparator('separator:current')}
      <span
        className='route-container-header__breadcrumb-current'
        title={titleText}
      >
        {currentTitle}
      </span>
    </div>
  )
}
