import { describe, expect, it } from 'vitest'

import { buildMessageContent, getInitialComposerState } from '#~/components/chat/sender/@core/content-attachments'
import {
  normalizePendingReferenceDraft
} from '#~/components/chat/sender/@utils/sender-pending-reference-draft-normalizers'

describe('sender content attachments helpers', () => {
  it('preserves exact file and file-comment paths through persisted draft restore and submission', () => {
    const exactPath = ' reports/report.txt '
    const restored = normalizePendingReferenceDraft(JSON.parse(JSON.stringify({
      pendingFiles: [{ name: 'report.txt', path: exactPath }],
      pendingFileComments: [{ comment: 'Review this', path: exactPath }]
    })))

    expect(restored.pendingFiles[0]?.path).toBe(exactPath)
    expect(restored.pendingFileComments[0]?.path).toBe(exactPath)
    const content = buildMessageContent(
      '',
      [],
      restored.pendingFiles,
      [],
      [],
      restored.pendingFileComments
    )

    expect(content).toEqual([
      expect.objectContaining({ text: expect.stringContaining(`File: ${exactPath}`), type: 'text' }),
      expect.objectContaining({ path: exactPath, type: 'file' })
    ])
  })

  it('hydrates pending files from structured content', () => {
    expect(getInitialComposerState([
      { type: 'text', text: 'Inspect this' },
      { type: 'file', path: 'apps/server/src/index.ts', name: 'index.ts' }
    ])).toEqual({
      input: 'Inspect this',
      pendingImages: [],
      pendingFiles: [
        {
          path: 'apps/server/src/index.ts',
          name: 'index.ts',
          size: undefined
        }
      ],
      pendingAnnotations: [],
      pendingFileComments: [],
      pendingTextSelections: []
    })
  })

  it('builds message content with files appended after text and images', () => {
    expect(buildMessageContent('Inspect this', [{
      id: 'img-1',
      url: 'data:image/png;base64,abc',
      name: 'shot.png',
      mimeType: 'image/png'
    }], [{
      path: 'apps/client/src/main.tsx',
      name: 'main.tsx'
    }])).toEqual([
      { type: 'text', text: 'Inspect this' },
      {
        type: 'image',
        url: 'data:image/png;base64,abc',
        name: 'shot.png',
        size: undefined,
        mimeType: 'image/png'
      },
      {
        type: 'file',
        path: 'apps/client/src/main.tsx',
        name: 'main.tsx',
        size: undefined
      }
    ])
  })
})
