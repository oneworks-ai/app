export const readIframeDocumentMetadata = (iframe: HTMLIFrameElement | null) => {
  let title: string | undefined
  let faviconUrl: string | undefined

  try {
    const document = iframe?.contentDocument
    const documentTitle = document?.title.trim()
    const iconHref = document?.querySelector<HTMLLinkElement>(
      'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
    )?.href
    if (documentTitle != null && documentTitle !== '') {
      title = documentTitle
    }
    if (iconHref != null && iconHref !== '') {
      faviconUrl = iconHref
    }
  } catch {
    // Cross-origin frames cannot expose title metadata; the server metadata reader handles those.
  }

  return { faviconUrl, title }
}
