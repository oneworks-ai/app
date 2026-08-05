import type { MouseEvent } from 'react'

import { MarkdownContent } from '#~/components/MarkdownContent'
import { sanitizePluginAssetReference } from '#~/plugins/plugin-presentation'

const renderSafeImage = ({ alt, src, title }: { alt?: string; src: string; title?: string }) => {
  const safeSource = sanitizePluginAssetReference(src)
  return safeSource == null
    ? null
    : <img alt={alt ?? ''} loading='lazy' referrerPolicy='no-referrer' src={safeSource} title={title} />
}

const preventUnsafeLink = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
  if (sanitizePluginAssetReference(href) == null) event.preventDefault()
}

export function SafePluginMarkdownContent({ content }: { content: string }) {
  return (
    <MarkdownContent
      content={content}
      openLinksInNewTab
      renderImage={renderSafeImage}
      onLinkClick={preventUnsafeLink}
    />
  )
}
