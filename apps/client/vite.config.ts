/* eslint-disable max-lines -- Vite config keeps dev-server plugins and production build policy together. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { types } from 'node:util'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { resolveDevServerFsAllow } from './vite-fs-allow.js'
import { resolveManualChunk } from './vite-manual-chunks.js'
import { pluginClientSourceWatch } from './vite-plugin-client-source-watch.js'

const clientMode = process.env.__ONEWORKS_PROJECT_CLIENT_MODE__
const clientDeployMode = process.env.__ONEWORKS_PROJECT_CLIENT_DEPLOY_MODE__
const clientDevServer = /^(?:1|true|yes|on)$/i.test(process.env.__ONEWORKS_PROJECT_CLIENT_DEV_SERVER__ ?? '')
const readBooleanEnv = (value: string | undefined) => {
  if (value == null) return undefined
  if (/^(?:1|true|yes|on)$/i.test(value)) return true
  if (/^(?:0|false|no|off)$/i.test(value)) return false
  return undefined
}
const isDev = clientMode === 'dev' || clientDevServer
const isStandaloneMode = (value: string | undefined) => value === 'standalone' || value === 'independent'
const isStandalone = isStandaloneMode(clientMode) || isStandaloneMode(clientDeployMode)
const normalizeViteBase = (value: string) => {
  const trimmed = value.trim()
  if (trimmed === '') return '/'
  const base = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return base.endsWith('/') ? base : `${base}/`
}
const clientBase = normalizeViteBase(
  isDev
    ? (process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ ?? '/')
    : isStandalone
    ? (process.env.__ONEWORKS_PROJECT_CLIENT_BASE__ ?? '/')
    : '/__ONEWORKS_PROJECT_CLIENT_BASE__/'
)
const clientBasePath = new URL(clientBase, 'http://vibe.local').pathname
const devClientBasePath = isDev && clientBasePath !== '/' ? clientBasePath.replace(/\/$/, '') : ''
const homepagePreviewEnabled = readBooleanEnv(process.env.__ONEWORKS_PROJECT_CLIENT_HOMEPAGE_PREVIEW__) ??
  (isStandalone && clientBase === '/pwa/')
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const clientPackageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string
}
const require = createRequire(import.meta.url)
const {
  parseAppBuildInfoJson
} = require('../../packages/types/src/app-build-info-runtime.js') as {
  parseAppBuildInfoJson: (value: string) => {
    buildTime: string | null
    commit: string | null
    version: string
  }
}

const normalizeViteVersion = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = parseAppBuildInfoJson(JSON.stringify({ version: value })).version
  return normalized === value.trim() ? normalized : undefined
}
const normalizeViteCommit = (value: unknown) => (
  parseAppBuildInfoJson(JSON.stringify({ commit: value })).commit
)
const normalizeViteBuildTime = (value: unknown) => (
  parseAppBuildInfoJson(JSON.stringify({ buildTime: value })).buildTime
)

const readGit = (args: string[]) =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()

const resolveDevGitRef = () => {
  try {
    return readGit(['symbolic-ref', '--short', 'HEAD'])
  } catch {
    try {
      return `detached@${readGit(['rev-parse', '--short', 'HEAD'])}`
    } catch {
      return ''
    }
  }
}

const resolveGitCommitHash = () => {
  try {
    return readGit(['rev-parse', 'HEAD'])
  } catch {
    return ''
  }
}

const firstNormalized = <T>(
  values: unknown[],
  normalize: (value: unknown) => T | null | undefined
) => {
  for (const value of values) {
    if (types.isProxy(value)) continue
    const normalized = normalize(value)
    if (normalized != null) return normalized
  }
  return undefined
}

const resolveSourceDateEpoch = (value: string | undefined) => {
  const normalized = value?.trim() ?? ''
  if (!/^\d{1,15}$/u.test(normalized)) return ''
  const milliseconds = Number(normalized) * 1_000
  if (!Number.isSafeInteger(milliseconds)) return ''
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? '' : normalizeViteBuildTime(date.toISOString()) ?? ''
}

const resolveGitCommitTime = (commitHash: string) => {
  try {
    return normalizeViteBuildTime(readGit(['show', '-s', '--format=%cI', commitHash])) ?? ''
  } catch {
    return ''
  }
}

export const resolveViteBuildMetadata = (candidates: {
  buildTime: unknown[]
  commit: unknown[]
  version: unknown[]
}) => ({
  buildTime: firstNormalized(candidates.buildTime, normalizeViteBuildTime) ?? '',
  commit: firstNormalized(candidates.commit, normalizeViteCommit) ?? '',
  version: firstNormalized(candidates.version, normalizeViteVersion) ?? ''
})

const devGitRef = isDev ? resolveDevGitRef() : ''
const explicitBuildMetadata = resolveViteBuildMetadata({
  buildTime: [
    process.env.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME__,
    process.env.ONEWORKS_CLIENT_BUILD_TIME,
    resolveSourceDateEpoch(process.env.SOURCE_DATE_EPOCH)
  ],
  commit: [
    process.env.__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__,
    process.env.ONEWORKS_CLIENT_COMMIT_HASH,
    process.env.GITHUB_SHA,
    resolveGitCommitHash()
  ],
  version: [
    process.env.__ONEWORKS_PROJECT_CLIENT_VERSION__,
    process.env.ONEWORKS_CLIENT_VERSION,
    clientPackageJson.version
  ]
})
const clientCommitHash = explicitBuildMetadata.commit
const explicitClientBuildTime = explicitBuildMetadata.buildTime
const clientBuildTime = explicitClientBuildTime ||
  (clientCommitHash === '' ? '' : resolveGitCommitTime(clientCommitHash))
const clientBuildTimeSource = clientBuildTime === ''
  ? 'unavailable'
  : explicitClientBuildTime === ''
  ? 'commit'
  : 'build'
process.env.__ONEWORKS_PROJECT_DEV_GIT_REF__ = devGitRef
process.env.__ONEWORKS_PROJECT_CLIENT_VERSION__ = explicitBuildMetadata.version
process.env.__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__ = clientCommitHash
process.env.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME__ = clientBuildTime
process.env.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__ = clientBuildTimeSource
const normalizeTitle = (title: string) => title.trim().replace(/\s+\[[^\]]+\]$/, '')
const normalizeProxyHost = (value?: string) => {
  const host = value?.trim()
  if (host == null || host === '' || host === '0.0.0.0' || host === '::' || host === '[::]') {
    return '127.0.0.1'
  }
  return host
}
const resolveDevServerProxyTarget = () => {
  if (!isDev) {
    return undefined
  }

  const explicitBaseUrl = process.env.__ONEWORKS_PROJECT_SERVER_BASE_URL__?.trim()
  if (explicitBaseUrl != null && explicitBaseUrl !== '') {
    return undefined
  }

  const serverPort = process.env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim()
  if (serverPort == null || serverPort === '') {
    return undefined
  }

  return `http://${normalizeProxyHost(process.env.__ONEWORKS_PROJECT_SERVER_HOST__)}:${serverPort}`
}

const devServerProxyTarget = resolveDevServerProxyTarget()
const devServerHttpProxy = devServerProxyTarget == null
  ? undefined
  : { target: devServerProxyTarget, changeOrigin: true }
const devServerFsAllow = resolveDevServerFsAllow(repoRoot, process.env)
const sourceAlias = (find: string, source: string) => ({
  find,
  replacement: fileURLToPath(new URL(source, import.meta.url))
})

export default defineConfig({
  plugins: [
    react(),
    pluginClientSourceWatch(),
    {
      name: 'oneworks-dev-base-redirect',
      enforce: 'pre',
      configureServer(server) {
        if (devClientBasePath === '') return
        server.middlewares.use((request, response, next) => {
          const url = request.url ?? ''
          if (url !== devClientBasePath && !url.startsWith(`${devClientBasePath}?`)) {
            next()
            return
          }
          response.statusCode = 307
          response.setHeader('Location', `${clientBasePath}${url.slice(devClientBasePath.length)}`)
          response.end()
        })
      }
    },
    {
      name: 'oneworks-dev-document-title',
      transformIndexHtml(html) {
        if (!isDev || devGitRef === '') {
          return html
        }
        return html.replace(/<title>([^<]*)<\/title>/, (_match, title: string) => {
          return `<title>${normalizeTitle(title)} [${devGitRef}]</title>`
        })
      }
    }
  ],
  root: '.',
  base: clientBase,
  define: {
    __ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__: JSON.stringify(homepagePreviewEnabled)
  },
  resolve: {
    alias: [
      sourceAlias('@oneworks/core/channel', '../../packages/core/src/channel.ts'),
      sourceAlias('@oneworks/plugin-chrome-devtools/schema', '../../packages/plugins/chrome-devtools/src/schema.ts'),
      sourceAlias('@oneworks/utils/model-providers', '../../packages/utils/src/model-providers.ts'),
      sourceAlias('@oneworks/utils/model-selection', '../../packages/utils/src/model-selection.ts'),
      sourceAlias('@oneworks/utils/log-level', '../../packages/utils/src/log-level.ts'),
      sourceAlias('@oneworks/utils/pinyin-search', '../../packages/utils/src/pinyin-search.ts'),
      sourceAlias('@oneworks/channel-lark', '../../packages/channels/lark/src/index.ts'),
      sourceAlias('@oneworks/core', '../../packages/core/src/index.ts'),
      sourceAlias('@oneworks/types/standalone-route', '../../packages/types/src/standalone-route.ts'),
      sourceAlias('@oneworks/types', '../../packages/types/src/index.ts'),
      sourceAlias('@oneworks/utils', '../../packages/utils/src/index.ts')
    ],
    conditions: ['browser', '__oneworks__', 'module', 'import', 'development']
  },
  server: {
    host: process.env.__ONEWORKS_PROJECT_CLIENT_HOST__,
    port: Number(process.env.__ONEWORKS_PROJECT_CLIENT_PORT__ ?? 5173),
    strictPort: process.env.__ONEWORKS_PROJECT_CLIENT_PORT__ != null,
    fs: {
      allow: devServerFsAllow
    },
    ...(devServerHttpProxy == null
      ? {}
      : {
        proxy: {
          '/__oneworks_chii__': { ...devServerHttpProxy, ws: true },
          '/api': devServerHttpProxy,
          '/channels': devServerHttpProxy,
          '/ws': { ...devServerHttpProxy, ws: true }
        }
      })
  },
  envPrefix: ['__ONEWORKS_PROJECT_'],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler'
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk
      }
    }
  }
})
