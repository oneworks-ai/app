const path = require('node:path')
const { types } = require('node:util')

const packageJson = require('./package.json')
const { parseAppBuildInfoJson } = require('@oneworks/types/app-build-info')

const DEFAULT_CLIENT_BASE = '/ui/'
const DEFAULT_BASE_PLACEHOLDER = '/__ONEWORKS_PROJECT_CLIENT_BASE__/'
const DEFAULT_SERVER_WS_PATH = '/ws'

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const normalizeBase = (value = DEFAULT_CLIENT_BASE) => {
  let base = typeof value === 'string' ? value.trim() : DEFAULT_CLIENT_BASE
  if (!base) {
    base = DEFAULT_CLIENT_BASE
  }
  if (!base.startsWith('/')) {
    base = `/${base}`
  }
  if (!base.endsWith('/')) {
    base += '/'
  }
  return base
}

const trimTrailingSlash = (value) => {
  if (value === '/') {
    return value
  }
  return value.replace(/\/+$/, '')
}

const normalizePath = (value, fallback) => {
  let next = typeof value === 'string' ? value.trim() : ''
  if (!next) {
    return fallback
  }
  if (!next.startsWith('/')) {
    next = `/${next}`
  }
  return next
}

const replaceBase = (content, base, placeholder) => {
  if (!placeholder || placeholder === base) {
    return content
  }
  return content.split(placeholder).join(base)
}

const readNodeEnvironment = (env) => {
  if (env == null || typeof env !== 'object' || Array.isArray(env) || types.isProxy(env)) {
    return {}
  }
  const prototype = Object.getPrototypeOf(env)
  if (prototype !== Object.prototype && prototype !== null) return {}

  const result = {}
  for (const key of [
    '__ONEWORKS_PROJECT_CLIENT_VERSION__',
    '__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__',
    '__ONEWORKS_PROJECT_CLIENT_BUILD_TIME__',
    '__ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__',
    '__ONEWORKS_PROJECT_SERVER_BASE_URL__',
    '__ONEWORKS_PROJECT_SERVER_HOST__',
    '__ONEWORKS_PROJECT_SERVER_PORT__',
    '__ONEWORKS_PROJECT_SERVER_WS_PATH__',
    '__ONEWORKS_PROJECT_CLIENT_MODE__'
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(env, key)
    if (descriptor != null && Object.hasOwn(descriptor, 'value')) result[key] = descriptor.value
  }
  return result
}

const createRuntimeScript = (base, env) => {
  const trustedEnv = readNodeEnvironment(env)
  const clientBuild = parseAppBuildInfoJson(JSON.stringify({
    version: trustedEnv.__ONEWORKS_PROJECT_CLIENT_VERSION__ ?? packageJson.version,
    commit: trustedEnv.__ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__,
    buildTime: trustedEnv.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME__,
    buildTimeSource: trustedEnv.__ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__
  }), packageJson.version)
  const runtimeEnv = {
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: trustedEnv.__ONEWORKS_PROJECT_SERVER_BASE_URL__,
    __ONEWORKS_PROJECT_SERVER_HOST__: trustedEnv.__ONEWORKS_PROJECT_SERVER_HOST__,
    __ONEWORKS_PROJECT_SERVER_PORT__: trustedEnv.__ONEWORKS_PROJECT_SERVER_PORT__,
    __ONEWORKS_PROJECT_SERVER_WS_PATH__: normalizePath(
      trustedEnv.__ONEWORKS_PROJECT_SERVER_WS_PATH__,
      DEFAULT_SERVER_WS_PATH
    ),
    __ONEWORKS_PROJECT_CLIENT_MODE__: trustedEnv.__ONEWORKS_PROJECT_CLIENT_MODE__ ?? 'static',
    __ONEWORKS_PROJECT_CLIENT_BASE__: trimTrailingSlash(base),
    __ONEWORKS_PROJECT_CLIENT_VERSION__: clientBuild.version,
    __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: clientBuild.commit ?? '',
    __ONEWORKS_PROJECT_CLIENT_BUILD_TIME__: clientBuild.buildTime ?? '',
    __ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__: clientBuild.buildTimeSource
  }
  const serializedRuntimeEnv = JSON.stringify(runtimeEnv).replace(/</gu, '\\u003c')
  const runtimeEnvJsonLiteral = JSON.stringify(serializedRuntimeEnv).replace(/</gu, '\\u003c')
  const clientBuildJsonLiteral = JSON.stringify(JSON.stringify(clientBuild)).replace(/</gu, '\\u003c')
  return `<script>window.__ONEWORKS_PROJECT_RUNTIME_ENV_JSON__=${runtimeEnvJsonLiteral};window.__ONEWORKS_PROJECT_CLIENT_BUILD_INFO_JSON__=${clientBuildJsonLiteral};window.__ONEWORKS_PROJECT_RUNTIME_ENV__=JSON.parse(window.__ONEWORKS_PROJECT_RUNTIME_ENV_JSON__)</script>`
}

const getContentType = (filePath) => {
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()]
  return contentType ?? 'application/octet-stream'
}

const resolveStaticFile = (distPath, relativePath) => {
  const normalizedRelativePath = relativePath.replace(/^\/+/, '')
  if (!normalizedRelativePath || normalizedRelativePath.includes('\0')) {
    return null
  }

  const absolutePath = path.resolve(distPath, normalizedRelativePath)
  const relativeFromRoot = path.relative(distPath, absolutePath)
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    return null
  }

  return {
    absolutePath,
    relativePath: normalizedRelativePath
  }
}

const formatOriginHost = (host) => {
  if (host === '0.0.0.0') {
    return '127.0.0.1'
  }
  if (host === '::') {
    return '[::1]'
  }
  return host.includes(':') ? `[${host}]` : host
}

module.exports = {
  DEFAULT_BASE_PLACEHOLDER,
  DEFAULT_CLIENT_BASE,
  createRuntimeScript,
  formatOriginHost,
  getContentType,
  normalizeBase,
  replaceBase,
  resolveStaticFile,
  trimTrailingSlash
}
