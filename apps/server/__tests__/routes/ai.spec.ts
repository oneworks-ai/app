import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetConfigCache } from '@oneworks/config'

import { aiRouter } from '#~/routes/ai.js'

const findRouteHandler = (routePath: string, method: string) => {
  const router = aiRouter() as any
  const layer = router.stack.find((item: any) => item.path === routePath && item.methods.includes(method))
  if (layer == null) {
    throw new Error(`Route ${method} ${routePath} not found`)
  }
  return layer.stack[0] as (ctx: any) => Promise<void> | void
}

describe('aiRouter', () => {
  let workspaceFolder = ''
  const originalRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
  const originalWorkspaceFolder = process.env.WORKSPACE_FOLDER

  beforeEach(async () => {
    workspaceFolder = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-routes-'))
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = path.join(workspaceFolder, '.test-home')
    process.env.WORKSPACE_FOLDER = workspaceFolder
    resetConfigCache()
  })

  afterEach(async () => {
    await rm(workspaceFolder, { recursive: true, force: true })
    workspaceFolder = ''
    if (originalRealHome == null) {
      delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    } else {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = originalRealHome
    }
    if (originalWorkspaceFolder == null) {
      delete process.env.WORKSPACE_FOLDER
    } else {
      process.env.WORKSPACE_FOLDER = originalWorkspaceFolder
    }
    resetConfigCache()
  })

  it('returns presenter-aligned skill detail payloads after creating a skill', async () => {
    const handleCreateSkill = findRouteHandler('/skills', 'POST')
    const ctx = {
      request: {
        body: {
          name: 'Research',
          description: 'Read docs',
          body: 'Use docs'
        }
      },
      status: undefined,
      body: undefined
    }

    await handleCreateSkill(ctx)

    expect(ctx.status).toBe(201)
    expect(ctx.body).toEqual({
      skill: {
        id: '.oo/skills/research/SKILL.md',
        name: 'research',
        description: 'Read docs',
        always: false,
        instancePath: undefined,
        source: 'project',
        sourceDetail: {
          kind: 'projectDefault'
        },
        body: 'Use docs'
      }
    })
    await expect(
      readFile(path.join(workspaceFolder, '.oo', 'skills', 'research', 'SKILL.md'), 'utf8')
    ).resolves.toBe('---\ndescription: "Read docs"\n---\n\nUse docs\n')
  })

  it('labels globally configured skills as global config sources', async () => {
    await mkdir(path.join(workspaceFolder, '.oo', 'skills', 'internal-review'), { recursive: true })
    await writeFile(
      path.join(workspaceFolder, '.oo', 'skills', 'internal-review', 'SKILL.md'),
      '---\nname: internal-review\ndescription: review skill\n---\nReview skill body\n'
    )
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        skills: ['internal-review']
      })
    )
    resetConfigCache()

    const handleListSkills = findRouteHandler('/skills', 'GET')
    const ctx = {
      body: undefined
    }

    await handleListSkills(ctx)

    expect(ctx.body).toEqual({
      skills: [
        expect.objectContaining({
          name: 'internal-review',
          sourceDetail: {
            kind: 'globalConfig',
            configSource: 'global',
            configLabel: '~/.oneworks/.oo.config.json'
          }
        })
      ]
    })
  })
})
