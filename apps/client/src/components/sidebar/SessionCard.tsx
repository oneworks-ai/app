import './SessionItem.scss'

import { List } from 'antd'
import { forwardRef } from 'react'
import type { CSSProperties, HTMLAttributes, MouseEventHandler, ReactNode, Ref } from 'react'

export interface SessionCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  as?: 'list-item' | 'article'
  className?: string
  contentRef?: Ref<HTMLDivElement>
  dataSessionCardSource?: string
  dataSessionId?: string
  headerSide?: ReactNode
  infoClassName?: string
  lastMessage?: ReactNode
  leading?: ReactNode
  onClick?: MouseEventHandler<HTMLElement>
  onDoubleClick?: MouseEventHandler<HTMLElement>
  onMouseLeave?: MouseEventHandler<HTMLElement>
  style?: CSSProperties
  tags?: ReactNode
  title: ReactNode
}

export const SessionCard = forwardRef<HTMLElement, SessionCardProps>(({
  as = 'list-item',
  className,
  contentRef,
  dataSessionCardSource,
  dataSessionId,
  headerSide,
  infoClassName,
  lastMessage,
  leading,
  onClick,
  onDoubleClick,
  onMouseLeave,
  style,
  tags,
  title,
  ...restProps
}, ref) => {
  const content = (
    <div ref={contentRef} className='session-item-content'>
      {leading}
      <div className={`session-info ${infoClassName ?? ''}`.trim()}>
        <div className='session-header'>
          <div className='session-title'>
            {title}
          </div>
          {headerSide != null && (
            <div className='session-header-side'>
              {headerSide}
            </div>
          )}
        </div>
        {lastMessage}
        {tags}
      </div>
    </div>
  )

  if (as === 'article') {
    return (
      <article
        {...restProps}
        ref={ref as Ref<HTMLElement>}
        className={className}
        data-session-card-source={dataSessionCardSource}
        data-session-id={dataSessionId}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onMouseLeave={onMouseLeave}
        style={style}
      >
        {content}
      </article>
    )
  }

  return (
    <List.Item
      {...restProps}
      ref={ref as Ref<HTMLDivElement>}
      className={className}
      data-session-card-source={dataSessionCardSource}
      data-session-id={dataSessionId}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseLeave={onMouseLeave}
      style={style}
    >
      {content}
    </List.Item>
  )
})

SessionCard.displayName = 'SessionCard'
