import { useEffect, useState } from 'react'

export type MessagePlayableMediaKind = 'audio' | 'video'

export interface MessageMediaFallbackProps {
  errorLabel: string
  kind: MessagePlayableMediaKind
  source: string
  src: string
}

export function MessageMediaFallback({
  errorLabel,
  kind,
  source,
  src
}: MessageMediaFallbackProps) {
  return (
    <a className='message-media-fallback' href={src} target='_blank' rel='noreferrer'>
      <span className='material-symbols-rounded message-media-fallback__icon'>
        {kind === 'video' ? 'videocam_off' : 'music_off'}
      </span>
      <span className='message-media-fallback__meta'>
        <span className='message-media-fallback__title'>{errorLabel}</span>
        <span className='message-media-fallback__source'>{source}</span>
      </span>
      <span className='material-symbols-rounded message-media-fallback__open'>open_in_new</span>
    </a>
  )
}

export function MessageMedia({
  errorLabel,
  kind,
  source,
  src,
  title
}: MessageMediaFallbackProps & { title?: string }) {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    setLoadFailed(false)
  }, [src])

  if (loadFailed) {
    return <MessageMediaFallback errorLabel={errorLabel} kind={kind} source={source} src={src} />
  }

  if (kind === 'video') {
    return (
      <video
        className='message-media message-media--video'
        crossOrigin='use-credentials'
        src={src}
        title={title ?? source}
        controls
        playsInline
        preload='metadata'
        onError={() => setLoadFailed(true)}
      />
    )
  }

  return (
    <audio
      className='message-media message-media--audio'
      crossOrigin='use-credentials'
      src={src}
      title={title ?? source}
      controls
      preload='metadata'
      onError={() => setLoadFailed(true)}
    />
  )
}
