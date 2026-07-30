import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AdapterStartupError } from '@oneworks/types'

import {
  CODEX_PROJECT_CONFIG_ERROR_CODE,
  validateCodexProjectConfig
} from '../src/runtime/project-config'

const tempDirs: string[] = []

const createWorkspace = async (content: string) => {
  const workspace = await mkdtemp(join(tmpdir(), 'oneworks-codex-project-config-'))
  tempDirs.push(workspace)
  await mkdir(join(workspace, '.codex'), { recursive: true })
  await writeFile(join(workspace, '.codex', 'config.toml'), content)
  return workspace
}

const expectProjectConfigError = async (content: string) => {
  const workspace = await createWorkspace(content)
  try {
    await validateCodexProjectConfig({
      adapter: 'codex',
      cwd: workspace,
      sessionId: 'session-project-config'
    })
    throw new Error('Expected project config validation to fail.')
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterStartupError)
    expect(error).toMatchObject({ code: CODEX_PROJECT_CONFIG_ERROR_CODE })
    return (error as AdapterStartupError).details as Record<string, unknown>
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Codex active project config validation', () => {
  it('reports an exact quoted-key location for an unsupported wire API', async () => {
    const details = await expectProjectConfigError(
      '[model_providers."quoted-provider"]\n  "wire_api"   = "legacy"\n'
    )

    expect(details).toMatchObject({
      adapter: 'codex',
      runtimeAdapter: 'codex',
      configPath: '.codex/config.toml',
      configSource: 'project',
      workspaceSource: 'active-session-workspace',
      workspaceFolder: expect.any(String),
      sessionId: 'session-project-config',
      reason: 'Unsupported wire_api value. Expected "responses" or "chat".',
      line: 2,
      column: 3
    })
  })

  it('reports the final key location for dotted keys', async () => {
    const details = await expectProjectConfigError(
      'model_providers.provider.wire_api = "legacy"\n'
    )

    expect(details).toMatchObject({ line: 1, column: 26 })
  })

  it('reports nested inline-table keys without matching duplicate-looking text', async () => {
    const details = await expectProjectConfigError([
      '# wire_api = "legacy"',
      'notice = "wire_api = legacy"',
      'model_providers = { provider = { wire_api = "legacy" } }',
      ''
    ].join('\n'))

    expect(details).toMatchObject({ line: 3, column: 34 })
  })

  it.each([
    { label: 'array', value: '["responses"]', expectedType: 'array' },
    { label: 'inline table', value: '{ kind = "responses" }', expectedType: 'table' },
    { label: 'number', value: '42', expectedType: 'number' },
    { label: 'boolean', value: 'true', expectedType: 'boolean' }
  ])('rejects a non-string wire_api $label at its structural key', async ({ value, expectedType }) => {
    const details = await expectProjectConfigError(
      `[model_providers.provider]\r\nwire_api = ${value}\r\n`
    )

    expect(details).toMatchObject({
      line: 2,
      column: 1,
      reason: `wire_api must be a string, not ${expectedType}.`
    })
  })

  it('tracks quoted UTF-8 provider keys with CRLF line endings', async () => {
    const details = await expectProjectConfigError(
      '[model_providers."服务"]\r\n  wire_api = "legacy"\r\n'
    )

    expect(details).toMatchObject({
      line: 2,
      column: 3
    })
  })

  it('intentionally omits a location when the TOML parser has no stable location contract', async () => {
    const details = await expectProjectConfigError(
      '[model_providers.provider\nwire_api = "legacy"\n'
    )

    expect(details).toEqual(expect.objectContaining({
      configPath: '.codex/config.toml',
      configSource: 'project',
      reason: 'The project config contains invalid TOML syntax.'
    }))
    expect(details).not.toHaveProperty('line')
    expect(details).not.toHaveProperty('column')
  })

  it('accepts supported project config and skips project config for global-only recovery', async () => {
    const validWorkspace = await createWorkspace(
      '[model_providers.provider]\nwire_api = "responses"\n'
    )
    await expect(validateCodexProjectConfig({
      adapter: 'codex',
      cwd: validWorkspace,
      sessionId: 'session-valid'
    })).resolves.toBeUndefined()

    const invalidWorkspace = await createWorkspace(
      '[model_providers.provider]\nwire_api = "legacy"\n'
    )
    await expect(validateCodexProjectConfig({
      adapter: 'codex',
      cwd: invalidWorkspace,
      projectConfigPolicy: 'global-only',
      sessionId: 'session-recovery'
    })).resolves.toBeUndefined()
  })
})
