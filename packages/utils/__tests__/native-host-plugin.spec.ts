import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { listNativeHostPluginAssetsWithin } from '../src/native-host-plugin'

describe('native host plugin assets', () => {
  it('groups recognized assets and excludes sensitive files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-native-assets-'))
    await mkdir(path.join(root, 'skills', 'example'), { recursive: true })
    await mkdir(path.join(root, 'scripts'), { recursive: true })
    await writeFile(path.join(root, 'skills', 'example', 'SKILL.md'), '# Example')
    await writeFile(path.join(root, 'scripts', 'run.ts'), 'export const run = true')
    await writeFile(path.join(root, 'scripts', 'access-token.txt'), 'not-for-the-api')
    await writeFile(path.join(root, '.mcp.json'), '{"mcpServers":{}}')

    const groups = await listNativeHostPluginAssetsWithin(root)

    expect(groups.map(group => group.kind)).toEqual(['mcp', 'scripts', 'skills'])
    expect(groups.find(group => group.kind === 'skills')?.files[0]).toMatchObject({
      content: '# Example',
      contentKind: 'markdown',
      path: 'skills/example/SKILL.md'
    })
    expect(groups.flatMap(group => group.files).some(file => file.path.includes('token'))).toBe(false)
  })

  it('does not follow symlinks outside the plugin root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-native-assets-root-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'oneworks-native-assets-outside-'))
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(outside, 'secret.md'), '# Outside')
    await symlink(outside, path.join(root, 'docs', 'escaped'))

    const groups = await listNativeHostPluginAssetsWithin(root)

    expect(groups).toEqual([])
  })

  it('truncates large text assets while preserving their real size', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'oneworks-native-assets-large-'))
    await mkdir(path.join(root, 'docs'), { recursive: true })
    await writeFile(path.join(root, 'docs', 'large.md'), 'x'.repeat(300 * 1024))

    const file = (await listNativeHostPluginAssetsWithin(root))[0]?.files[0]

    expect(file?.truncated).toBe(true)
    expect(file?.size).toBe(300 * 1024)
    expect(file?.content?.length).toBe(256 * 1024)
  })
})
