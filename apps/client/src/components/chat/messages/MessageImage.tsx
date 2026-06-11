import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface MessagePreviewImage {
  alt?: string
  src: string
  title?: string
}

interface MessageImageProps extends MessagePreviewImage {
  onPreview: (image: MessagePreviewImage) => void
}

export function MessageImage({
  alt,
  src,
  title,
  onPreview
}: MessageImageProps) {
  const { t } = useTranslation()
  const [loadFailed, setLoadFailed] = useState(false)
  const label = title ?? alt ?? src

  useEffect(() => {
    setLoadFailed(false)
  }, [src])

  if (loadFailed) {
    return (
      <a className='message-image-fallback' href={src} target='_blank' rel='noreferrer'>
        <span className='material-symbols-rounded message-image-fallback__icon'>broken_image</span>
        <span className='message-image-fallback__meta'>
          <span className='message-image-fallback__title'>{t('chat.imageLoadFailed')}</span>
          <span className='message-image-fallback__url'>{src}</span>
        </span>
        <span className='material-symbols-rounded message-image-fallback__open'>open_in_new</span>
      </a>
    )
  }

  return (
    <button
      type='button'
      className='message-image'
      title={t('chat.previewImage')}
      aria-label={t('chat.previewImage')}
      onClick={() => {
        onPreview({ alt, src, title })
      }}
    >
      <img
        src={src}
        alt={alt ?? label}
        title={label}
        loading='lazy'
        decoding='async'
        referrerPolicy='no-referrer'
        onError={() => setLoadFailed(true)}
      />
    </button>
  )
}
