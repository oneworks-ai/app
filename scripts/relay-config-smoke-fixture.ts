import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

export const RELAY_CONFIG_SMOKE_SERVICE_KEY = 'relay-smoke'
export const RELAY_CONFIG_SMOKE_MODEL = 'relay-smoke-model'
export const RELAY_CONFIG_SNAPSHOT_RELATIVE_PATH = ['.local', 'plugins', 'relay', 'config-snapshot.json'] as const

export interface RelayConfigSmokeFixture {
  cachePath: string
  env: NodeJS.ProcessEnv
  projectHome: string
  tempRoot: string
  workspaceDir: string
}

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const createSnapshotFixture = (workspaceDir: string) => ({
  version: '2026.06.15-smoke',
  hash: 'sha256:relay-config-smoke',
  lastError: null,
  lastSyncedAt: '2026-06-15T00:00:00.000Z',
  sourceServerId: 'corp',
  updatedAt: '2026-06-15T00:00:00.000Z',
  assignments: [
    {
      id: 'smoke-workspace-assignment',
      allowedFields: ['defaultModelService', 'modelServices'],
      project: {
        allow: [workspaceDir]
      },
      configPatch: {
        defaultModelService: RELAY_CONFIG_SMOKE_SERVICE_KEY,
        env: {
          RELAY_FORBIDDEN_ENV: 'must-not-merge'
        },
        mcpServers: {
          forbidden: {
            command: 'echo',
            args: ['must-not-merge']
          }
        },
        modelServices: {
          [RELAY_CONFIG_SMOKE_SERVICE_KEY]: {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiKey: 'relay-smoke-key',
            models: [RELAY_CONFIG_SMOKE_MODEL],
            title: 'Relay smoke service'
          }
        },
        plugins: [
          {
            id: '@oneworks/plugin-forbidden'
          }
        ]
      }
    },
    {
      id: 'smoke-workspace-denied-assignment',
      allowedFields: ['defaultModelService', 'modelServices'],
      project: {
        allow: ['/not/the/smoke/workspace']
      },
      configPatch: {
        defaultModelService: 'relay-denied',
        modelServices: {
          'relay-denied': {
            apiBaseUrl: 'https://denied.example.com/v1',
            apiKey: 'denied-key',
            models: ['denied-model'],
            title: 'Denied relay service'
          }
        }
      }
    }
  ],
  rules: []
})

export const createWorkspaceFixture = async (repoRoot: string): Promise<RelayConfigSmokeFixture> => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-smoke-'))
  const workspaceDir = join(tempRoot, 'workspace')
  const projectHome = join(tempRoot, 'project-home')
  const realHome = join(tempRoot, 'real-home')
  const configRoot = resolve(repoRoot, 'packages/config')
  const pluginRoot = resolve(repoRoot, 'packages/plugins/relay')
  const configLink = join(workspaceDir, 'node_modules/@oneworks/config')
  const pluginLink = join(workspaceDir, 'node_modules/@oneworks/plugin-relay')
  const env = {
    ...process.env,
    __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
    __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
    __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome,
    __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: join(tempRoot, 'project-homes'),
    __ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__: 'false',
    __ONEWORKS_PROJECT_REAL_HOME__: realHome
  }

  await mkdir(dirname(pluginLink), { recursive: true })
  await mkdir(projectHome, { recursive: true })
  await mkdir(realHome, { recursive: true })
  await symlink(configRoot, configLink, 'dir')
  await symlink(pluginRoot, pluginLink, 'dir')
  await writeJson(join(workspaceDir, '.oo.config.json'), {
    disableGlobalConfig: true,
    plugins: [
      {
        id: '@oneworks/plugin-relay',
        options: {
          activeServerId: 'corp',
          enableOfficialCloudflareRelay: false,
          enableOfficialVercelRelay: false,
          servers: [
            {
              id: 'corp',
              baseUrl: 'https://relay.example.com'
            }
          ]
        }
      }
    ]
  })

  const cachePath = join(projectHome, ...RELAY_CONFIG_SNAPSHOT_RELATIVE_PATH)
  await writeJson(cachePath, createSnapshotFixture(workspaceDir))

  return {
    cachePath,
    env,
    projectHome,
    tempRoot,
    workspaceDir
  }
}
