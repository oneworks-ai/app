import { App, Modal, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type { MessagePreviewImage } from './MessageImage'

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.25

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

const openExternalUrl = (url: string) => {
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened == null) {
    window.location.assign(url)
    return
  }

  try {
    opened.opener = null
  } catch {
    // Ignore browsers that do not allow changing opener.
  }
  opened.focus()
}

export function MessageImagePreviewModal({
  image,
  onClose
}: {
  image: MessagePreviewImage | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [scale, setScale] = useState(1)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setScale(1)
    setLoadFailed(false)
  }, [image?.src])

  if (image == null) {
    return null
  }

  const title = image.title ?? image.alt ?? t('chat.imagePreviewTitle')

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(image.src)
      void message.success(t('chat.imageLinkCopied'))
    } catch {
      void message.error(t('common.copyFailed'))
    }
  }

  return (
    <Modal
      open
      footer={null}
      width='100vw'
      rootClassName='message-image-preview-modal-root'
      className='message-image-preview-modal'
      closeIcon={null}
      onCancel={onClose}
    >
      <div className='message-image-preview'>
        <div className='message-image-preview__toolbar'>
          <div className='message-image-preview__title' title={title}>
            {title}
          </div>
          <div className='message-image-preview__actions'>
            <Tooltip title={t('chat.imageZoomOut')}>
              <button
                type='button'
                className='message-image-preview__icon-btn'
                aria-label={t('chat.imageZoomOut')}
                disabled={scale <= MIN_SCALE}
                onClick={() => setScale(current => clampScale(current - SCALE_STEP))}
              >
                <span className='material-symbols-rounded'>zoom_out</span>
              </button>
            </Tooltip>
            <Tooltip title={t('chat.imageZoomReset')}>
              <button
                type='button'
                className='message-image-preview__scale-btn'
                aria-label={t('chat.imageZoomReset')}
                onClick={() => setScale(1)}
              >
                {Math.round(scale * 100)}%
              </button>
            </Tooltip>
            <Tooltip title={t('chat.imageZoomIn')}>
              <button
                type='button'
                className='message-image-preview__icon-btn'
                aria-label={t('chat.imageZoomIn')}
                disabled={scale >= MAX_SCALE}
                onClick={() => setScale(current => clampScale(current + SCALE_STEP))}
              >
                <span className='material-symbols-rounded'>zoom_in</span>
              </button>
            </Tooltip>
            <Tooltip title={t('chat.copyImageLink')}>
              <button
                type='button'
                className='message-image-preview__icon-btn'
                aria-label={t('chat.copyImageLink')}
                onClick={() => {
                  void handleCopyLink()
                }}
              >
                <span className='material-symbols-rounded'>content_copy</span>
              </button>
            </Tooltip>
            <Tooltip title={t('chat.openImageInBrowser')}>
              <button
                type='button'
                className='message-image-preview__icon-btn'
                aria-label={t('chat.openImageInBrowser')}
                onClick={() => openExternalUrl(image.src)}
              >
                <span className='material-symbols-rounded'>open_in_new</span>
              </button>
            </Tooltip>
            <Tooltip title={t('common.close')}>
              <button
                type='button'
                className='message-image-preview__icon-btn'
                aria-label={t('common.close')}
                onClick={onClose}
              >
                <span className='material-symbols-rounded'>close</span>
              </button>
            </Tooltip>
          </div>
        </div>
        <div className='message-image-preview__stage'>
          {loadFailed
            ? (
              <a className='message-image-preview__fallback' href={image.src} target='_blank' rel='noreferrer'>
                <span className='material-symbols-rounded'>broken_image</span>
                <span>{t('chat.imageLoadFailed')}</span>
                <span className='message-image-preview__fallback-url'>{image.src}</span>
              </a>
            )
            : (
              <img
                className='message-image-preview__image'
                src={image.src}
                alt={image.alt ?? title}
                title={title}
                decoding='async'
                referrerPolicy='no-referrer'
                onError={() => setLoadFailed(true)}
                style={{ '--message-image-preview-scale': scale } as CSSProperties}
              />
            )}
        </div>
      </div>
    </Modal>
  )
}
