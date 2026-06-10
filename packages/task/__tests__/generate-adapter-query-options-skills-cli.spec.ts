/* eslint-disable import/first -- hoisted vitest mocks must be declared before importing the module under test */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findSkillsCli: vi.fn(),
  installSkillsCliRefToTemp: vi.fn(),
  installSkillsCliSkillToTemp: vi.fn()
}))

vi.mock('@oneworks/utils/skills-cli', async () => {
  const actual = await vi.importActual<typeof import('@oneworks/utils/skills-cli')>('@oneworks/utils/skills-cli')
  return {
    ...actual,
    findSkillsCli: mocks.findSkillsCli,
    installSkillsCliRefToTemp: mocks.installSkillsCliRefToTemp,
    installSkillsCliSkillToTemp: mocks.installSkillsCliSkillToTemp
  }
})

import { generateAdapterQueryOptions } from '#~/generate-adapter-query-options.js'

const tempDirs: string[] = []

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-adapter-query-options-skills-cli-'))
  const realHome = await mkdtemp(join(tmpdir(), 'generate-adapter-query-options-skills-cli-home-'))
  tempDirs.push(dir, realHome)
  process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHome
  return dir
}

const writeDocument = async (filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

describe('generateAdapterQueryOptions skills CLI startup', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
    delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
  })

  it('does not download remote skill dependencies during normal session startup', async () => {
    const workspace = await createWorkspace()
    await writeDocument(
      join(workspace, '.oo/skills/lynx-miniapp/SKILL.md'),
      [
        '---',
        'name: lynx-miniapp',
        'description: lynx 调试使用',
        'dependencies:',
        '  - https://registry.example.com@example-source/lynx/skills@lynx-cat@latest',
        '---',
        '',
        '这是一个测试的 lynx 调试技能'
      ].join('\n')
    )

    await expect(generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        adapter: 'codex',
        skills: {
          include: ['lynx-miniapp']
        }
      }
    )).rejects.toThrow('Run oneworks skills install or oneworks skills update')
    expect(mocks.findSkillsCli).not.toHaveBeenCalled()
    expect(mocks.installSkillsCliRefToTemp).not.toHaveBeenCalled()
    expect(mocks.installSkillsCliSkillToTemp).not.toHaveBeenCalled()
  })
})
