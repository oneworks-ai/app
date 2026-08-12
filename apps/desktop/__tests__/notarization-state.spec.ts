import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const notarization = require('../scripts/notarization-state.cjs') as {
  bindState: (stateDir: string, provenance: Record<string, unknown>) => NotarizationState
  inspectState: (stateDir: string) => NotarizationState
  prepareState: (options: Record<string, unknown>) => NotarizationState
  queryState: (stateDir: string, options: Record<string, unknown>) => {
    pending: boolean
    state: NotarizationState
  }
  reconcileState: (stateDir: string, options: Record<string, unknown>) => NotarizationState
  restoreState: (stateDir: string, workspaceDir: string, options: Record<string, unknown>) => NotarizationState
  submitState: (stateDir: string, options: Record<string, unknown>) => NotarizationState
  waitForState: (stateDir: string, options: Record<string, unknown>) => Promise<NotarizationState>
}

interface NotarizationTarget {
  name: string
  payload: string
  relativePath: string
  sha256: string
  size: number
  status: string
  submissionId?: string
  submissionAttemptedAt?: string
}

interface NotarizationState {
  schemaVersion: number
  stage: 'app' | 'installer'
  sourceSha: string
  builderSha: string
  buildBranch: string
  buildTime: string
  artifactProvenance: {
    headSha: string
    runAttempt: number
    runId: string
    workflowPath: string
  }
  releaseTag: string
  targets: NotarizationTarget[]
  files: NotarizationTarget[]
}

const credentials = {
  APPLE_ID: 'developer@example.test',
  APPLE_ID_PASSWORD: 'app-password',
  APPLE_TEAM_ID: 'TEAMID'
}

const withFixture = (
  callback: (fixture: {
    stateDir: string
    workspaceDir: string
  }) => void | Promise<void>
) =>
async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'oneworks-notarization-state-'))
  const stateDir = path.join(root, 'state')
  const workspaceDir = path.join(root, 'workspace')
  mkdirSync(path.join(workspaceDir, 'apps', 'desktop', 'release'), { recursive: true })
  writeFileSync(path.join(workspaceDir, 'apps', 'desktop', 'release', 'oneworks-arm64.dmg'), 'dmg-bytes')
  writeFileSync(path.join(workspaceDir, 'apps', 'desktop', 'release', 'oneworks-arm64.pkg'), 'pkg-bytes')
  writeFileSync(path.join(workspaceDir, 'apps', 'desktop', 'release', 'oneworks-arm64.zip'), 'zip-bytes')
  writeFileSync(path.join(workspaceDir, 'apps', 'desktop', 'release', 'latest-mac.yml'), 'metadata')
  try {
    await callback({ stateDir, workspaceDir })
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

const prepareInstallerState = (stateDir: string, workspaceDir: string) =>
  notarization.prepareState({
    buildBranch: 'main',
    buildTime: '2026-08-11T12:00:00.000Z',
    builderSha: 'b'.repeat(40),
    releaseTag: 'pkg/oneworks-desktop/v1.0.0-rc.2',
    runAttempt: '1',
    runHeadSha: 'b'.repeat(40),
    runId: '31527515015',
    sourceSha: 'a'.repeat(40),
    stage: 'installer',
    stateDir,
    workspaceDir
  })

describe('recoverable desktop notarization state', () => {
  it(
    'submits every exact payload once and persists IDs before waiting',
    withFixture(({ stateDir, workspaceDir }) => {
      prepareInstallerState(stateDir, workspaceDir)
      const calls: string[][] = []
      let nextId = 1
      const command = (_command: string, args: string[]) => {
        calls.push(args)
        return JSON.stringify({ id: `submission-${nextId++}`, status: 'Uploaded' })
      }

      const first = notarization.submitState(stateDir, { command, env: credentials })
      const second = notarization.submitState(stateDir, { command, env: credentials })

      expect(calls).toHaveLength(2)
      expect(calls.every(args => args.includes('--no-wait'))).toBe(true)
      expect(first.targets.map(target => target.submissionId)).toEqual(['submission-1', 'submission-2'])
      expect(second.targets.map(target => target.submissionId)).toEqual(['submission-1', 'submission-2'])
      expect(notarization.inspectState(stateDir).targets.every(target => target.submissionId != null)).toBe(true)
      const rebound = notarization.bindState(stateDir, {
        headSha: 'c'.repeat(40),
        runAttempt: '2',
        runId: '31527519999'
      })
      expect(rebound.artifactProvenance).toEqual({
        headSha: 'c'.repeat(40),
        runAttempt: 2,
        runId: '31527519999',
        workflowPath: '.github/workflows/desktop-package.yml'
      })
    })
  )

  it(
    'polls existing submission IDs without resubmitting and accepts only terminal success',
    withFixture(async ({ stateDir, workspaceDir }) => {
      prepareInstallerState(stateDir, workspaceDir)
      notarization.submitState(stateDir, {
        command: (_command: string, args: string[]) =>
          JSON.stringify({
            id: args[2].endsWith('.dmg') ? 'dmg-id' : 'pkg-id',
            status: 'Uploaded'
          }),
        env: credentials
      })
      let round = 0
      const infoCalls: string[][] = []
      const command = (_command: string, args: string[]) => {
        infoCalls.push(args)
        return JSON.stringify({ status: round === 0 ? 'In Progress' : 'Accepted' })
      }

      const pending = notarization.queryState(stateDir, { command, env: credentials })
      expect(pending.pending).toBe(true)
      round = 1
      const accepted = await notarization.waitForState(stateDir, {
        command,
        env: credentials,
        intervalMs: 0,
        sleep: () => Promise.resolve(),
        timeoutMs: 100
      })

      expect(accepted.targets.every(target => target.status === 'Accepted')).toBe(true)
      expect(infoCalls.every(args => args[0] === 'notarytool' && args[1] === 'info')).toBe(true)
      expect(infoCalls.some(args => args.includes('submit'))).toBe(false)
    })
  )

  it(
    'persists an ambiguous attempt and reconciles its exact history without a duplicate submit',
    withFixture(({ stateDir, workspaceDir }) => {
      prepareInstallerState(stateDir, workspaceDir)
      let submitCalls = 0
      expect(() =>
        notarization.submitState(stateDir, {
          command: () => {
            submitCalls += 1
            if (submitCalls === 1) return JSON.stringify({ id: 'submitted-1', status: 'Uploaded' })
            throw new Error('connection closed after upload')
          },
          env: credentials
        })
      ).toThrow('connection closed after upload')

      const attempted = notarization.inspectState(stateDir)
      expect(attempted.targets[0].submissionId).toBe('submitted-1')
      expect(attempted.targets[1].submissionAttemptedAt).toBeTruthy()
      expect(() =>
        notarization.submitState(stateDir, {
          command: () => {
            throw new Error('must not submit again')
          },
          env: credentials
        })
      ).toThrow('refusing to duplicate')

      const createdDate = attempted.targets[1].submissionAttemptedAt as string
      const reconciled = notarization.reconcileState(stateDir, {
        command: () =>
          JSON.stringify({
            history: [{
              createdDate,
              id: 'history-2',
              name: path.basename(attempted.targets[1].payload),
              status: 'In Progress'
            }]
          }),
        env: credentials
      })

      expect(reconciled.targets.map(target => target.submissionId)).toEqual(['submitted-1', 'history-2'])
      let duplicateCalls = 0
      notarization.submitState(stateDir, {
        command: () => {
          duplicateCalls += 1
          return '{}'
        },
        env: credentials
      })
      expect(duplicateCalls).toBe(0)
    })
  )

  it(
    'fails closed when history cannot uniquely identify an ambiguous submission',
    withFixture(({ stateDir, workspaceDir }) => {
      prepareInstallerState(stateDir, workspaceDir)
      expect(() =>
        notarization.submitState(stateDir, {
          command: () => {
            throw new Error('ambiguous upload')
          },
          env: credentials
        })
      ).toThrow('ambiguous upload')
      const state = notarization.inspectState(stateDir)
      const target = state.targets[0]
      const duplicate = {
        createdDate: target.submissionAttemptedAt,
        id: 'ambiguous-id',
        name: path.basename(target.payload),
        status: 'In Progress'
      }

      expect(() =>
        notarization.reconcileState(stateDir, {
          command: () => JSON.stringify({ history: [duplicate, { ...duplicate, id: 'other-id' }] }),
          env: credentials
        })
      ).toThrow('cannot safely reconcile')
    })
  )

  it(
    'fails closed when a recovery payload no longer matches its saved size and digest',
    withFixture(({ stateDir, workspaceDir }) => {
      const state = prepareInstallerState(stateDir, workspaceDir)
      writeFileSync(path.join(stateDir, state.targets[0].payload), 'changed')

      expect(() => notarization.restoreState(stateDir, workspaceDir, {}))
        .toThrow('notarization recovery payload changed')
    })
  )

  it(
    'preserves non-submitted ZIP and update metadata with installer recovery',
    withFixture(({ stateDir, workspaceDir }) => {
      const state = prepareInstallerState(stateDir, workspaceDir)
      const releaseDir = path.join(workspaceDir, 'apps', 'desktop', 'release')
      rmSync(releaseDir, { force: true, recursive: true })

      notarization.restoreState(stateDir, workspaceDir, {})

      expect(state.targets.map(target => path.extname(target.name))).toEqual(['.dmg', '.pkg'])
      expect(readFileSync(path.join(releaseDir, 'oneworks-arm64.zip'), 'utf8')).toBe('zip-bytes')
      expect(readFileSync(path.join(releaseDir, 'latest-mac.yml'), 'utf8')).toBe('metadata')
    })
  )

  it(
    'rejects recovery paths that escape the workspace or state artifact',
    withFixture(({ stateDir, workspaceDir }) => {
      prepareInstallerState(stateDir, workspaceDir)
      const statePath = path.join(stateDir, 'notarization-state.json')
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as NotarizationState
      state.files[0].relativePath = '../../outside.dmg'
      writeFileSync(statePath, JSON.stringify(state))

      expect(() => notarization.restoreState(stateDir, workspaceDir, {}))
        .toThrow(/escapes|outside/u)
    })
  )

  it(
    'rejects an invalid Apple result and records it for diagnosis',
    withFixture(({ stateDir, workspaceDir }) => {
      prepareInstallerState(stateDir, workspaceDir)
      notarization.submitState(stateDir, {
        command: () => JSON.stringify({ id: 'submission-id', status: 'Uploaded' }),
        env: credentials
      })

      expect(() =>
        notarization.queryState(stateDir, {
          command: () => JSON.stringify({ status: 'Invalid' }),
          env: credentials
        })
      ).toThrow('Apple rejected notarization')
      expect(readFileSync(path.join(stateDir, 'notarization-state.json'), 'utf8')).toContain('Invalid')
    })
  )
})
