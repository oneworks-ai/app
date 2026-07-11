import { describe, expect, it } from 'vitest'

import { getFileLinkIconMeta, getMarkdownLinkIconMeta } from '#~/utils/link-icons'
import {
  getPathExtension,
  isExternalUrl,
  isLikelyImageUrl,
  normalizeWorkspaceFileLink,
  parseWorkspaceFileLink,
  splitPlainWorkspaceFileLinks
} from '#~/utils/link-targets'
import { parseLocalMediaSource, parseLocalMediaSourceForWorkspaceRoot } from '#~/utils/local-media'
import {
  buildMarkdownLinkIntentTitle,
  parseMarkdownLinkIntent,
  resolveMarkdownLinkIntentTarget
} from '#~/utils/markdown-link-intent'
import { DEFAULT_MESSAGE_LINKS_CONFIG, resolveMessageLinksConfig } from '#~/utils/message-links-config'
import { resolveWorkspaceFileOpenerSelectModels } from '#~/utils/workspace-file-openers'

describe('message link targets', () => {
  it('parses only the namespaced OneWorks Markdown link intent titles', () => {
    expect(parseMarkdownLinkIntent('oneworks:open=internal')).toBe('internal')
    expect(parseMarkdownLinkIntent(' oneworks:open=external ')).toBe('external')
    expect(parseMarkdownLinkIntent(buildMarkdownLinkIntentTitle('workspace-file'))).toBe('workspace-file')
    expect(parseMarkdownLinkIntent('open=external')).toBeUndefined()
    expect(parseMarkdownLinkIntent('oneworks:open=unknown')).toBeUndefined()
  })

  it('resolves explicit link intents without widening URL or workspace access', () => {
    expect(resolveMarkdownLinkIntentTarget(
      'https://example.com/docs?q=one works',
      'internal',
      '/workspace/app'
    )).toEqual({
      intent: 'internal',
      url: 'https://example.com/docs?q=one%20works'
    })
    expect(resolveMarkdownLinkIntentTarget('http://localhost:8787/ui', 'external')).toEqual({
      intent: 'external',
      url: 'http://localhost:8787/ui'
    })
    expect(resolveMarkdownLinkIntentTarget('mailto:team@example.com', 'external')).toBeUndefined()
    expect(resolveMarkdownLinkIntentTarget('javascript:alert(1)', 'internal')).toBeUndefined()
    expect(resolveMarkdownLinkIntentTarget('apps/client/src/App.tsx:12:4', 'workspace-file', '/workspace/app'))
      .toEqual({
        intent: 'workspace-file',
        target: { path: 'apps/client/src/App.tsx', line: 12, column: 4 }
      })
    expect(resolveMarkdownLinkIntentTarget('../outside.txt', 'workspace-file', '/workspace/app')).toBeUndefined()
    expect(resolveMarkdownLinkIntentTarget('/etc/passwd', 'workspace-file', '/workspace/app')).toBeUndefined()
  })

  it('detects image URLs with query strings and hashes', () => {
    expect(isLikelyImageUrl('https://example.com/cat.png?size=large#preview')).toBe(true)
    expect(isLikelyImageUrl('https://cdn.example.com/path/photo.WEBP')).toBe(true)
    expect(isLikelyImageUrl('https://example.com/docs/readme')).toBe(false)
  })

  it('detects local-looking image paths without fetching them', () => {
    expect(isLikelyImageUrl('/assets/screenshot.avif')).toBe(true)
    expect(isLikelyImageUrl('./docs/diagram.svg')).toBe(true)
    expect(isLikelyImageUrl('src/App.tsx')).toBe(false)
  })

  it('supports browser image sources that do not have file extensions', () => {
    expect(isLikelyImageUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isLikelyImageUrl('blob:https://example.com/image-id')).toBe(true)
  })

  it('extracts extensions from URL-like strings', () => {
    expect(getPathExtension('https://example.com/archive.tar.gz?download=1')).toBe('gz')
    expect(getPathExtension('no-extension')).toBe('')
  })

  it('classifies explicit protocol links as external URLs', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('file:///tmp/image.png')).toBe(true)
    expect(isExternalUrl('/workspace/file.png')).toBe(false)
  })

  it('classifies supported local image, video, and audio sources', () => {
    expect(parseLocalMediaSource('./artifacts/final%20shot.png')).toEqual({
      kind: 'image',
      path: './artifacts/final shot.png'
    })
    expect(parseLocalMediaSource('/private/tmp/oneworks-cua/run/recording.mp4')).toEqual({
      kind: 'video',
      path: '/private/tmp/oneworks-cua/run/recording.mp4'
    })
    expect(parseLocalMediaSource('fixtures/voice.m4a?raw=1')).toEqual({
      kind: 'audio',
      path: 'fixtures/voice.m4a'
    })
  })

  it('keeps remote, anchor, origin-relative, and non-media links unchanged', () => {
    expect(parseLocalMediaSourceForWorkspaceRoot('https://example.com/movie.mp4', '/workspace/app')).toBeNull()
    expect(parseLocalMediaSourceForWorkspaceRoot('//cdn.example.com/movie.mp4', '/workspace/app')).toBeNull()
    expect(parseLocalMediaSourceForWorkspaceRoot('#recording.mp4', '/workspace/app')).toBeNull()
    expect(parseLocalMediaSourceForWorkspaceRoot('/assets/movie.mp4', '/workspace/app')).toBeNull()
    expect(parseLocalMediaSourceForWorkspaceRoot('/workspace/app/assets/movie.mp4', '/workspace/app')).toEqual({
      kind: 'video',
      path: '/workspace/app/assets/movie.mp4'
    })
    expect(parseLocalMediaSourceForWorkspaceRoot('/tmp/oneworks-cua/run/movie.mp4', '/workspace/app')).toEqual({
      kind: 'video',
      path: '/tmp/oneworks-cua/run/movie.mp4'
    })
    expect(parseLocalMediaSourceForWorkspaceRoot('docs/readme.md', '/workspace/app')).toBeNull()
  })

  it('normalizes workspace file links for the bottom file tab', () => {
    expect(normalizeWorkspaceFileLink('./apps/client/src/App.tsx:12:3')).toBe('apps/client/src/App.tsx')
    expect(normalizeWorkspaceFileLink('docs/guide.md?plain=1#intro')).toBe('docs/guide.md')
    expect(normalizeWorkspaceFileLink('https://example.com/app.tsx')).toBe(null)
    expect(normalizeWorkspaceFileLink('../outside.ts')).toBe(null)
    expect(normalizeWorkspaceFileLink('/absolute/path.ts')).toBe(null)
  })

  it('parses workspace file links with editor locations', () => {
    expect(parseWorkspaceFileLink('./apps/client/src/App.tsx:12:3')).toEqual({
      path: 'apps/client/src/App.tsx',
      line: 12,
      column: 3
    })
    expect(parseWorkspaceFileLink('docs/guide%20book.md:8')).toEqual({
      path: 'docs/guide book.md',
      line: 8
    })
    expect(parseWorkspaceFileLink('docs/bad%XX.md')).toEqual({
      path: 'docs/bad%XX.md'
    })
  })

  it('splits plain workspace file paths into clickable link segments', () => {
    expect(splitPlainWorkspaceFileLinks('Open apps/client/src/App.tsx:12 please')).toEqual([
      { type: 'text', text: 'Open ' },
      { type: 'link', href: 'apps/client/src/App.tsx:12', text: 'apps/client/src/App.tsx:12' },
      { type: 'text', text: ' please' }
    ])
    expect(splitPlainWorkspaceFileLinks('https://example.com/assets/app.tsx')).toEqual([
      { type: 'text', text: 'https://example.com/assets/app.tsx' }
    ])
  })

  it('resolves link icons for external and file links', () => {
    expect(getMarkdownLinkIconMeta('https://example.com')).toMatchObject({
      icon: 'public',
      kind: 'external'
    })
    expect(getMarkdownLinkIconMeta('apps/client/src/App.tsx:12')).toMatchObject({
      icon: 'data_object',
      kind: 'workspace-file',
      tone: 'typescript'
    })
    expect(getMarkdownLinkIconMeta('file:///tmp/report.pdf')).toMatchObject({
      icon: 'picture_as_pdf',
      kind: 'local-file',
      tone: 'pdf'
    })
  })

  it('maps common file suffixes to distinct icon tones', () => {
    expect(getFileLinkIconMeta('src/main.py')).toMatchObject({ icon: 'code', tone: 'python' })
    expect(getFileLinkIconMeta('README.md')).toMatchObject({ icon: 'article', tone: 'markdown' })
    expect(getFileLinkIconMeta('public/logo.svg')).toMatchObject({ icon: 'image', tone: 'image' })
    expect(getFileLinkIconMeta('scripts/release.sh')).toMatchObject({ icon: 'terminal', tone: 'script' })
  })

  it('resolves message link config defaults and overrides', () => {
    expect(resolveMessageLinksConfig(undefined)).toEqual(DEFAULT_MESSAGE_LINKS_CONFIG)
    expect(resolveMessageLinksConfig({
      externalLinkTarget: 'currentTab',
      workspaceFileTarget: 'externalIde',
      workspaceFileOpener: 'vscode',
      imageLinkMode: 'link',
      plainWorkspacePathMode: 'text'
    })).toEqual({
      externalLinkTarget: 'currentTab',
      workspaceFileTarget: 'externalIde',
      workspaceFileOpener: 'vscode',
      imageLinkMode: 'link',
      plainWorkspacePathMode: 'text'
    })
    expect(resolveMessageLinksConfig(
      {
        externalLinkTarget: 'other',
        workspaceFileTarget: 'other',
        workspaceFileOpener: 'other',
        imageLinkMode: 'other',
        plainWorkspacePathMode: 'other'
      } as unknown as Parameters<typeof resolveMessageLinksConfig>[0]
    )).toEqual(DEFAULT_MESSAGE_LINKS_CONFIG)
  })

  it('builds app options from detected workspace file openers', () => {
    expect(resolveWorkspaceFileOpenerSelectModels(undefined)).toEqual([
      { icon: 'auto_awesome', kind: 'auto', value: 'auto' }
    ])

    expect(resolveWorkspaceFileOpenerSelectModels({
      defaultOpener: 'vscode',
      openers: [
        { available: true, id: 'vscode', source: 'path', title: 'Visual Studio Code' },
        { available: false, id: 'cursor', title: 'Cursor' },
        { available: true, id: 'zed', source: 'path', title: 'Zed' },
        { available: true, id: 'textedit', source: 'macApp', title: 'TextEdit' }
      ]
    })).toEqual([
      {
        kind: 'auto',
        icon: 'auto_awesome',
        value: 'auto',
        defaultOpenerTitle: 'Visual Studio Code',
        defaultOpenerValue: 'vscode'
      },
      { icon: 'developer_mode', kind: 'detected', title: 'Visual Studio Code', value: 'vscode' },
      { icon: 'terminal', kind: 'detected', title: 'Zed', value: 'zed' },
      { icon: 'edit_note', kind: 'detected', title: 'TextEdit', value: 'textedit' }
    ])
  })
})
