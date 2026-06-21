import { useTranslation } from 'react-i18next'

import { PinnedPopoverPortal } from '#~/components/chat/PinnedPopoverPortal'
import { usePinnedPopover } from '#~/components/chat/usePinnedPopover'

import type { BrowserCommentMessage as BrowserCommentMessageModel } from './browser-comment-message'

export function BrowserCommentMessage({ message }: { message: BrowserCommentMessageModel }) {
  const { t } = useTranslation()
  const popover = usePinnedPopover<HTMLDivElement>()

  return (
    <div
      ref={popover.rootRef}
      className={`browser-comment-message ${popover.isPinned ? 'is-pinned' : ''}`}
      onPointerEnter={popover.onRootPointerEnter}
      onPointerLeave={popover.onRootPointerLeave}
    >
      <button
        type='button'
        className='browser-comment-message__chip'
        aria-label={t('chat.browserComments.ariaLabel', { count: message.comments.length })}
        aria-expanded={popover.isPinned}
        onClick={popover.togglePinned}
      >
        <span className='material-symbols-rounded' aria-hidden='true'>chat_bubble</span>
        <span>{t('chat.browserComments.count', { count: message.comments.length })}</span>
      </button>
      <PinnedPopoverPortal
        className='browser-comment-message__popover'
        controller={popover}
      >
        {message.comments.map((comment, index) => (
          <div key={`${index}-${comment.comment}`} className='browser-comment-message__row'>
            <div className='browser-comment-message__preview' aria-hidden='true'>
              {comment.screenshotUrl != null
                ? (
                  <img
                    src={comment.screenshotUrl}
                    alt=''
                    loading='lazy'
                  />
                )
                : (
                  <span className='material-symbols-rounded'>web_asset</span>
                )}
            </div>
            <div className='browser-comment-message__body'>
              <div className='browser-comment-message__target'>
                {comment.targetLabel || comment.pageTitle || t('chat.browserComments.targetFallback')}
              </div>
              <div className='browser-comment-message__comment'>{comment.comment}</div>
            </div>
          </div>
        ))}
      </PinnedPopoverPortal>
    </div>
  )
}
