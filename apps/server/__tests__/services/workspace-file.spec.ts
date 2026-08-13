import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HttpError } from '#~/utils/http.js'

import { readWorkspaceFile, updateWorkspaceFile } from '#~/services/workspace/file.js'
import { resolveWorkspaceImageResource, resolveWorkspaceMediaResource } from '#~/services/workspace/media.js'

describe('workspace file service', () => {
  let externalDir: string
  let productArtifactDir: string
  let workspaceDir: string

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'ow-workspace-file-'))
    externalDir = await mkdtemp(join(tmpdir(), 'ow-workspace-file-external-'))
    await mkdir('/tmp/oneworks-cua', { recursive: true })
    productArtifactDir = await mkdtemp('/tmp/oneworks-cua/ow-workspace-media-')
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceDir)

    await mkdir(join(workspaceDir, 'src'), { recursive: true })
    await mkdir(join(workspaceDir, 'assets'), { recursive: true })
    await writeFile(join(workspaceDir, 'src', 'index.ts'), 'export const value = 1\n')
    await writeFile(join(workspaceDir, 'assets', 'logo.png'), Buffer.from([137, 80, 78, 71]))
    await writeFile(join(workspaceDir, 'assets', 'clip.mp4'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(workspaceDir, 'assets', 'sound.mp3'), Buffer.from([4, 5, 6, 7]))
    await writeFile(join(productArtifactDir, 'final screenshot.png'), Buffer.from([8, 9, 10, 11]))
    await writeFile(join(workspaceDir, 'binary.dat'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(externalDir, 'outside.ts'), 'export const outside = true\n')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(externalDir, { recursive: true, force: true })
    await rm(productArtifactDir, { recursive: true, force: true })
  })

  it('reads UTF-8 files relative to the workspace root', async () => {
    await expect(readWorkspaceFile('src/index.ts')).resolves.toEqual({
      path: 'src/index.ts',
      content: 'export const value = 1\n',
      encoding: 'utf-8',
      size: 23
    })
  })

  it('updates an existing workspace file', async () => {
    await expect(updateWorkspaceFile('src/index.ts', 'export const value = 2\n')).resolves.toEqual({
      path: 'src/index.ts',
      content: 'export const value = 2\n',
      encoding: 'utf-8',
      size: 23
    })

    await expect(readFile(join(workspaceDir, 'src', 'index.ts'), 'utf8')).resolves.toBe('export const value = 2\n')
  })

  it('reads and updates the exact whitespace-bearing file instead of its adjacent peer', async () => {
    const rawPath = ' notes.txt '
    const adjacentPath = rawPath.trim()
    await writeFile(join(workspaceDir, rawPath), 'raw\n')
    await writeFile(join(workspaceDir, adjacentPath), 'adjacent\n')

    await expect(readWorkspaceFile(rawPath)).resolves.toMatchObject({
      content: 'raw\n',
      path: rawPath
    })
    await expect(updateWorkspaceFile(rawPath, 'updated raw\n')).resolves.toMatchObject({
      content: 'updated raw\n',
      path: rawPath
    })
    await expect(readFile(join(workspaceDir, rawPath), 'utf8')).resolves.toBe('updated raw\n')
    await expect(readFile(join(workspaceDir, adjacentPath), 'utf8')).resolves.toBe('adjacent\n')
  })

  it('keeps POSIX literal-backslash file and media paths distinct from nested peers', async () => {
    if (process.platform === 'win32') return
    const literalFile = String.raw`notes\draft.md`
    const nestedFile = 'notes/draft.md'
    const literalMedia = String.raw`assets\clip.mp4`
    await mkdir(join(workspaceDir, 'notes'), { recursive: true })
    await writeFile(join(workspaceDir, literalFile), 'literal\n')
    await writeFile(join(workspaceDir, nestedFile), 'nested\n')
    await writeFile(join(workspaceDir, literalMedia), Buffer.from([9, 8, 7]))

    await expect(readWorkspaceFile(literalFile)).resolves.toMatchObject({
      content: 'literal\n',
      path: literalFile
    })
    await expect(updateWorkspaceFile(literalFile, 'updated\n')).resolves.toMatchObject({ path: literalFile })
    await expect(readFile(join(workspaceDir, nestedFile), 'utf8')).resolves.toBe('nested\n')
    await expect(resolveWorkspaceMediaResource(literalMedia)).resolves.toMatchObject({
      filePath: await realpath(join(workspaceDir, literalMedia)),
      path: literalMedia
    })
  })

  it('reads and updates internal symbolic link files', async () => {
    await symlink('src/index.ts', join(workspaceDir, 'index-link.ts'), 'file')

    await expect(readWorkspaceFile('index-link.ts')).resolves.toEqual({
      path: 'index-link.ts',
      content: 'export const value = 1\n',
      encoding: 'utf-8',
      size: 23
    })

    await expect(updateWorkspaceFile('index-link.ts', 'export const value = 3\n')).resolves.toEqual({
      path: 'index-link.ts',
      content: 'export const value = 3\n',
      encoding: 'utf-8',
      size: 23
    })

    await expect(readFile(join(workspaceDir, 'src', 'index.ts'), 'utf8')).resolves.toBe('export const value = 3\n')
  })

  it('resolves image resources for streaming', async () => {
    const workspaceRealPath = await realpath(workspaceDir)
    await expect(resolveWorkspaceImageResource('assets/logo.png')).resolves.toMatchObject({
      filePath: join(workspaceRealPath, 'assets', 'logo.png'),
      mimeType: 'image/png',
      path: 'assets/logo.png',
      size: 4
    })
  })

  it('rejects non-image resources', async () => {
    await expect(resolveWorkspaceImageResource('src/index.ts')).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_resource_not_image'
      } satisfies Partial<HttpError>
    )
  })

  it('resolves image, video, and audio media with canonical paths and MIME types', async () => {
    const workspaceRealPath = await realpath(workspaceDir)

    await expect(resolveWorkspaceMediaResource('assets/logo.png')).resolves.toMatchObject({
      filePath: join(workspaceRealPath, 'assets', 'logo.png'),
      mimeType: 'image/png',
      size: 4
    })
    await expect(resolveWorkspaceMediaResource('assets/clip.mp4')).resolves.toMatchObject({
      filePath: join(workspaceRealPath, 'assets', 'clip.mp4'),
      mimeType: 'video/mp4',
      size: 4
    })
    await expect(resolveWorkspaceMediaResource('assets/sound.mp3')).resolves.toMatchObject({
      filePath: join(workspaceRealPath, 'assets', 'sound.mp3'),
      mimeType: 'audio/mpeg',
      size: 4
    })
  })

  it('resolves the exact whitespace-bearing relative media file', async () => {
    const rawPath = 'assets/clip.mp4 '
    const adjacentPath = rawPath.trim()
    await writeFile(join(workspaceDir, rawPath), Buffer.from([9, 8, 7]))

    await expect(resolveWorkspaceMediaResource(rawPath)).resolves.toMatchObject({
      filePath: await realpath(join(workspaceDir, rawPath)),
      mimeType: 'video/mp4',
      path: rawPath,
      size: 3
    })
    await expect(resolveWorkspaceMediaResource(adjacentPath)).resolves.toMatchObject({
      filePath: await realpath(join(workspaceDir, adjacentPath)),
      size: 4
    })
  })

  it('allows only session-enabled media under the product artifact root', async () => {
    const artifactPath = join(productArtifactDir, 'final screenshot.png')

    await expect(resolveWorkspaceMediaResource(artifactPath, {
      allowProductArtifactPaths: true
    })).resolves.toMatchObject({
      filePath: await realpath(artifactPath),
      mimeType: 'image/png',
      path: artifactPath,
      size: 4
    })
    await expect(resolveWorkspaceMediaResource(artifactPath)).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_media_path_not_authorized'
      } satisfies Partial<HttpError>
    )
  })

  it('resolves the exact whitespace-bearing absolute artifact path', async () => {
    const rawPath = join(productArtifactDir, 'final screenshot.png ')
    const adjacentPath = rawPath.trim()
    await writeFile(rawPath, Buffer.from([7, 8, 9]))

    await expect(resolveWorkspaceMediaResource(rawPath, {
      allowProductArtifactPaths: true
    })).resolves.toMatchObject({
      filePath: await realpath(rawPath),
      mimeType: 'image/png',
      path: rawPath,
      size: 3
    })
    await expect(resolveWorkspaceMediaResource(adjacentPath, {
      allowProductArtifactPaths: true
    })).resolves.toMatchObject({
      filePath: await realpath(adjacentPath),
      size: 4
    })
  })

  it('rejects unauthorized, missing, directory, and escaping artifact paths', async () => {
    const missingPath = join(productArtifactDir, 'missing.mp4')
    const outsideMedia = join(externalDir, 'outside.mp4')
    await writeFile(outsideMedia, Buffer.from([1, 2, 3]))
    await symlink(outsideMedia, join(productArtifactDir, 'outside-link.mp4'), 'file')

    await expect(resolveWorkspaceMediaResource('/dev/null', {
      allowProductArtifactPaths: true
    })).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_media_path_not_authorized'
      } satisfies Partial<HttpError>
    )
    await expect(resolveWorkspaceMediaResource(missingPath, {
      allowProductArtifactPaths: true
    })).rejects.toMatchObject(
      {
        status: 404,
        code: 'workspace_media_not_found'
      } satisfies Partial<HttpError>
    )
    await expect(resolveWorkspaceMediaResource(productArtifactDir, {
      allowProductArtifactPaths: true
    })).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_media_path_not_file'
      } satisfies Partial<HttpError>
    )
    await expect(resolveWorkspaceMediaResource(join(productArtifactDir, 'outside-link.mp4'), {
      allowProductArtifactPaths: true
    })).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_media_path_escapes_authorized_root'
      } satisfies Partial<HttpError>
    )
  })

  it('streams internal symlinks through their canonical target path', async () => {
    await symlink('assets/clip.mp4', join(workspaceDir, 'clip-link.mp4'), 'file')

    await expect(resolveWorkspaceMediaResource('clip-link.mp4')).resolves.toMatchObject({
      filePath: await realpath(join(workspaceDir, 'assets', 'clip.mp4')),
      mimeType: 'video/mp4'
    })
  })

  it('rejects paths outside the workspace root', async () => {
    await expect(readWorkspaceFile('../outside.ts')).rejects.toMatchObject(
      {
        status: 400,
        code: 'invalid_workspace_tree_path'
      } satisfies Partial<HttpError>
    )
  })

  it('rejects symbolic link files that resolve outside the workspace root', async () => {
    await symlink(join(externalDir, 'outside.ts'), join(workspaceDir, 'outside-link.ts'), 'file')

    await expect(readWorkspaceFile('outside-link.ts')).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_file_path_escapes_workspace'
      } satisfies Partial<HttpError>
    )
  })

  it('rejects broken symbolic link files as not found', async () => {
    await symlink('missing.ts', join(workspaceDir, 'missing-link.ts'), 'file')

    await expect(readWorkspaceFile('missing-link.ts')).rejects.toMatchObject(
      {
        status: 404,
        code: 'workspace_file_not_found'
      } satisfies Partial<HttpError>
    )
  })

  it('rejects Git worktree pointer files as metadata links', async () => {
    await writeFile(join(workspaceDir, '.git'), `gitdir: ${join(externalDir, '.git')}\n`)

    await expect(readWorkspaceFile('.git')).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_file_gitdir_pointer'
      } satisfies Partial<HttpError>
    )
  })

  it('rejects binary files', async () => {
    await expect(readWorkspaceFile('binary.dat')).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_file_binary'
      } satisfies Partial<HttpError>
    )
  })

  it('rejects updating binary files', async () => {
    await expect(updateWorkspaceFile('binary.dat', 'text')).rejects.toMatchObject(
      {
        status: 400,
        code: 'workspace_file_binary'
      } satisfies Partial<HttpError>
    )
  })
})
