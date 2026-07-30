import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveMockHome } from '@oneworks/hooks'

import { prepareCodexSessionHome } from '#~/runtime/accounts.js'
import { readCodexConfigFromAppServer } from '#~/runtime/model-provider-config-read.js'
import { buildCodexProjectConfigPolicyOverrideArgs } from '#~/runtime/session-common.js'

const binaryPath = process.env.ONEWORKS_TEST_CODEX_BINARY?.trim()
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('Codex project config recovery runtime boundary', () => {
  it.skipIf(binaryPath == null || binaryPath === '')(
    'suppresses only the active project layer while retaining the complete isolated global config',
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), 'ow-codex-project-policy-runtime-'))
      tempDirs.push(workspace)
      const realHome = join(workspace, 'real-home')
      const mockHome = resolveMockHome(workspace, {
        HOME: join(workspace, 'mock-home'),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      })
      await mkdir(join(workspace, '.codex'), { recursive: true })
      await mkdir(join(realHome, '.codex'), { recursive: true })
      await mkdir(join(mockHome, '.codex'), { recursive: true })
      const globalConfig = [
        'model = "gpt-5.6"',
        'model_provider = "company"',
        '',
        '[model_providers.company]',
        'name = "Company"',
        'base_url = "https://example.invalid/v1"',
        'wire_api = "responses"',
        '',
        '[profiles.review]',
        'model = "gpt-5.6"',
        'model_provider = "company"',
        '',
        '[notices]',
        'hide_rate_limit_model_nudge = true',
        '',
        `[projects.${JSON.stringify(workspace)}]`,
        'trust_level = "trusted"',
        ''
      ].join('\n')
      await writeFile(join(realHome, '.codex', 'config.toml'), globalConfig)
      await writeFile(join(mockHome, '.codex', 'config.toml'), 'model = "managed-default"\n')
      await writeFile(
        join(workspace, '.codex', 'config.toml'),
        '[model_providers.invalid\nwire_api = "legacy"\n'
      )
      const env = {
        CODEX_HOME: join(realHome, '.codex'),
        HOME: mockHome,
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      }
      const prepared = await prepareCodexSessionHome({
        ctx: {
          cwd: workspace,
          ctxId: 'runtime-policy',
          env,
          configs: []
        },
        projectConfigPolicy: 'global-only',
        sessionId: 'recovery'
      })

      expect(await readFile(join(prepared.homeDir, '.codex', 'config.toml'), 'utf8')).toBe(globalConfig)
      const recovery = await readCodexConfigFromAppServer({
        binaryPath: binaryPath!,
        codexHome: join(prepared.homeDir, '.codex'),
        configOverrideArgs: buildCodexProjectConfigPolicyOverrideArgs(workspace, 'global-only'),
        cwd: workspace,
        env,
        includeLayers: true
      })

      expect(recovery.config).toEqual(expect.objectContaining({
        model: 'gpt-5.6',
        model_provider: 'company',
        model_providers: expect.objectContaining({
          company: expect.objectContaining({
            base_url: 'https://example.invalid/v1',
            wire_api: 'responses'
          })
        }),
        profiles: expect.objectContaining({
          review: expect.objectContaining({
            model: 'gpt-5.6',
            model_provider: 'company'
          })
        }),
        notices: expect.objectContaining({
          hide_rate_limit_model_nudge: true
        })
      }))

      await expect(readCodexConfigFromAppServer({
        binaryPath: binaryPath!,
        codexHome: join(prepared.homeDir, '.codex'),
        cwd: workspace,
        env,
        includeLayers: true
      })).rejects.toThrow()
      expect(await readFile(join(realHome, '.codex', 'config.toml'), 'utf8')).toBe(globalConfig)
      expect(await readFile(join(workspace, '.codex', 'config.toml'), 'utf8')).toBe(
        '[model_providers.invalid\nwire_api = "legacy"\n'
      )
    }
  )
})
