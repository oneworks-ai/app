import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  readProjectSkillDependencies,
  readProjectSkillsLockfile,
  writeProjectSkillsLockfile
} from '#~/project-skills.js'

const tempDirs: string[] = []

describe('project skills lockfile and metadata', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('writes and reads the project skills lockfile as YAML', async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ow-project-skills-lock-')))
    tempDirs.push(cwd)

    await writeProjectSkillsLockfile(cwd, {
      version: 1,
      skills: {
        research: {
          constraints: [{ from: 'app-builder', version: '^1.0.0' }],
          dependencyOf: ['app-builder'],
          hash: 'sha256:abc',
          installedAt: '2026-05-13T00:00:00.000Z',
          installPath: '.oo/skills/research',
          name: 'research',
          requested: false,
          source: 'example/skills',
          version: '1.2.3'
        }
      }
    })

    const content = await readFile(path.join(cwd, '.oo/skills.lock.yaml'), 'utf8')
    expect(content.trim().startsWith('{')).toBe(false)
    expect(content).toContain('version: 1')
    expect(content).toContain('skills:')
    expect(content).toContain('research:')

    await expect(readProjectSkillsLockfile(cwd)).resolves.toEqual({
      version: 1,
      skills: {
        research: {
          constraints: [{ from: 'app-builder', version: '^1.0.0' }],
          dependencyOf: ['app-builder'],
          hash: 'sha256:abc',
          installedAt: '2026-05-13T00:00:00.000Z',
          installPath: '.oo/skills/research',
          name: 'research',
          requested: false,
          source: 'example/skills',
          version: '1.2.3'
        }
      }
    })
  })

  it('parses SKILL.md YAML dependencies in string and object forms', async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ow-project-skills-meta-')))
    tempDirs.push(cwd)
    const skillPath = path.join(cwd, 'SKILL.md')
    await mkdir(path.dirname(skillPath), { recursive: true })
    await writeFile(
      skillPath,
      [
        '---',
        'name: app-builder',
        'description: Build apps',
        'dependencies:',
        '  - frontend-design',
        '  - name: review-helper',
        '    source: example/skills',
        '    registry: https://registry.example.test',
        '    version: ^1.2.0',
        '---',
        'Build the app.'
      ].join('\n')
    )

    await expect(readProjectSkillDependencies(skillPath)).resolves.toEqual([
      {
        ref: 'frontend-design',
        name: 'frontend-design'
      },
      {
        ref: 'https://registry.example.test@example/skills@review-helper@^1.2.0',
        name: 'review-helper',
        registry: 'https://registry.example.test',
        source: 'example/skills',
        version: '^1.2.0'
      }
    ])
  })
})
