import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSessionWorkspaceResourceUrl } from '#~/api/sessions'
import { MarkdownContent } from '#~/components/MarkdownContent'
import type { MarkdownMediaRenderProps } from '#~/components/MarkdownContent'
import { MessageMedia, MessageMediaFallback } from '#~/components/chat/messages/MessageMedia'

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path, 'http://api.example.com:8787').toString(),
  getServerBaseUrl: () => 'http://api.example.com:8787',
  resolveWorkspaceIdFromPathname: (pathname: string) => pathname.includes('/ui/w/') ? 'w_test' : undefined
}))

vi.mock('#~/components/CodeBlock', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>
}))

const renderMedia = ({ alt, kind, source, src, title }: MarkdownMediaRenderProps) => {
  if (kind === 'image') {
    return <img alt={alt} data-local-source={source} src={src} title={title} />
  }
  return (
    <MessageMedia
      errorLabel={`${kind} failed`}
      kind={kind}
      source={source}
      src={src}
      title={title ?? alt}
    />
  )
}

const renderMarkdown = (content: string) =>
  renderToStaticMarkup(
    <MarkdownContent
      content={content}
      renderMedia={renderMedia}
      resolveLocalMediaUrl={path => `/api/media?path=${encodeURIComponent(path)}`}
      workspaceRootPath='/workspace/app'
    />
  )

describe('markdown local media rendering', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders Markdown images and ordinary media links as image, video, and audio controls', () => {
    const html = renderMarkdown([
      '![final shot](/private/tmp/oneworks-cua/run/final%20shot.png)',
      '[recording](/private/tmp/oneworks-cua/run/recording.mp4)',
      '[voice](fixtures/voice.mp3)'
    ].join('\n\n'))

    expect(html).toContain('<img alt="final shot"')
    expect(html).toContain('data-local-source="/private/tmp/oneworks-cua/run/final shot.png"')
    expect(html).toContain('<video class="message-media message-media--video"')
    expect(html).toContain('controls=""')
    expect(html).toContain('playsinline=""')
    expect(html).toContain('crossorigin="use-credentials"')
    expect(html).toContain('<audio class="message-media message-media--audio"')
    expect(html).toContain('preload="metadata"')
  })

  it('leaves remote URLs, anchors, origin URLs, and non-media links as links', () => {
    const html = renderMarkdown([
      '[remote](https://example.com/movie.mp4)',
      '[anchor](#movie.mp4)',
      '[origin](/assets/movie.mp4)',
      '[document](docs/readme.md)'
    ].join('\n\n'))

    expect(html).not.toContain('<video')
    expect(html).not.toContain('<audio')
    expect(html).toContain('href="https://example.com/movie.mp4"')
    expect(html).toContain('href="#movie.mp4"')
    expect(html).toContain('href="/assets/movie.mp4"')
    expect(html).toContain('href="docs/readme.md"')
  })

  it('renders explicit internal, external, and workspace-file link intents', () => {
    const html = renderMarkdown([
      '[internal](https://example.com/app "oneworks:open=internal")',
      '[external](https://example.com/docs "oneworks:open=external")',
      '[source](apps/client/src/App.tsx "oneworks:open=workspace-file")',
      '[ordinary](https://example.com "Human title")'
    ].join('\n\n'))

    expect(html).toContain('data-oneworks-open="internal"')
    expect(html).toContain('markdown-link--intent-internal')
    expect(html).toContain('>web_asset</span>')
    expect(html).toContain('data-oneworks-open="external"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('>open_in_new</span>')
    expect(html).toContain('data-oneworks-open="workspace-file"')
    expect(html).toContain('>draft</span>')
    expect(html).not.toContain('title="oneworks:open=')
    expect(html).toContain('title="Human title"')
  })

  it('renders a stable fallback link without another media element', () => {
    const html = renderToStaticMarkup(
      <MessageMediaFallback
        errorLabel='Video failed to load'
        kind='video'
        source='/private/tmp/oneworks-cua/run/movie.mp4'
        src='/api/media?path=movie.mp4'
      />
    )

    expect(html).toContain('message-media-fallback')
    expect(html).toContain('Video failed to load')
    expect(html).toContain('href="/api/media?path=movie.mp4"')
    expect(html).not.toContain('<video')
  })

  it('encodes the session id and local path exactly once in proxy URLs', () => {
    const url = new URL(getSessionWorkspaceResourceUrl(
      'session/with space',
      '/private/tmp/oneworks-cua/run/final screenshot.png'
    ))

    expect(url.pathname).toBe('/api/sessions/session%2Fwith%20space/workspace/resource')
    expect(url.searchParams.get('path')).toBe('/private/tmp/oneworks-cua/run/final screenshot.png')
  })

  it('uses the launcher same-origin proxy for a shared workspace client', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:5208',
        pathname: '/ui/w/w_test/session/session-1',
        protocol: 'http:'
      }
    })

    const url = new URL(getSessionWorkspaceResourceUrl('session/one', '/tmp/oneworks-cua/run/clip.mp4'))
    expect(url.origin).toBe('http://127.0.0.1:5208')
    expect(url.pathname).toBe('/api/launcher/workspaces/w_test/resource')
    expect(url.searchParams.get('sessionId')).toBe('session/one')
    expect(url.searchParams.get('path')).toBe('/tmp/oneworks-cua/run/clip.mp4')
  })
})
