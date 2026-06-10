const EXTERNAL_LINK_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

const escapeMarkdownLinkLabel = (value: string) => value.replace(/([\\[\]])/g, '\\$1')

const escapeMarkdownLinkHref = (value: string) => {
  if (/[\s()<>]/.test(value)) {
    return `<${value.replace(/[<>]/g, '')}>`
  }
  return value.replace(/\\/g, '\\\\')
}

export const buildMarkdownLinkText = ({ href, label }: { href: string; label: string }) =>
  `[${escapeMarkdownLinkLabel(label || href)}](${escapeMarkdownLinkHref(href)})`

export const getExternalLinkUrl = (href: string) => {
  const trimmed = href.trim()
  if (trimmed === '' || !EXTERNAL_LINK_SCHEME_PATTERN.test(trimmed)) {
    return ''
  }

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ||
        url.protocol === 'tel:'
      ? url.href
      : ''
  } catch {
    return ''
  }
}

export const getAppBrowserLinkUrl = (href: string) => {
  const trimmed = href.trim()
  if (trimmed === '' || !EXTERNAL_LINK_SCHEME_PATTERN.test(trimmed)) {
    return ''
  }

  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

export const openExternalLink = (url: string) => {
  if (typeof window === 'undefined' || url === '') return

  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (opened == null) {
    if (window.oneworksDesktop != null) return

    window.location.assign(url)
    return
  }

  try {
    opened.opener = null
  } catch {
    // Some browsers do not allow changing opener after window.open.
  }
  opened.focus()
}
