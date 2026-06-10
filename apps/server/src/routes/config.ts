import process from 'node:process'

import Router from '@koa/router'

import {
  composeBaseConfigSchemaBundle,
  composeWorkspaceConfigSchemaBundle,
  resolveConfigSectionWriteError,
  resolveWritableConfigPath,
  updateConfigFile,
  validateConfigSection,
  writeWorkspaceConfigSchemaFile
} from '@oneworks/config'
import type { ConfigSchemaResponse, ConfigSource } from '@oneworks/types'
import { resolveProjectOoBaseDirName } from '@oneworks/utils'

import { getWorkspaceFolder, loadConfigState } from '#~/services/config/index.js'
import { badRequest, internalServerError, isHttpError } from '#~/utils/http.js'

import { buildConfigAbout, buildSections, loadAdapterBuiltinModels } from './config-helpers.js'
import { applyUnsetPaths } from './config-unset.js'

export function configRouter(): Router {
  const router = new Router()

  router.get('/schema', async (ctx) => {
    try {
      const workspaceFolder = getWorkspaceFolder()
      const [base, workspace] = await Promise.all([
        Promise.resolve(composeBaseConfigSchemaBundle()),
        composeWorkspaceConfigSchemaBundle({ cwd: workspaceFolder })
      ])

      const body: ConfigSchemaResponse = {
        base: {
          jsonSchema: base.jsonSchema,
          extensions: base.extensions
        },
        workspace: {
          jsonSchema: workspace.jsonSchema,
          uiSchema: workspace.uiSchema,
          extensions: workspace.extensions
        }
      }

      ctx.body = body
    } catch (err) {
      throw internalServerError('Failed to load config schema', { cause: err, code: 'config_schema_load_failed' })
    }
  })

  router.post('/schema/generate', async (ctx) => {
    try {
      const workspaceFolder = getWorkspaceFolder()
      const { outputPath, bundle } = await writeWorkspaceConfigSchemaFile({ cwd: workspaceFolder })
      ctx.body = {
        ok: true,
        outputPath,
        extensions: bundle.extensions
      }
    } catch (err) {
      throw internalServerError('Failed to generate config schema', {
        cause: err,
        code: 'config_schema_generate_failed'
      })
    }
  })

  router.get('/', async (ctx) => {
    try {
      const {
        workspaceFolder,
        mergedConfig,
        globalSource,
        projectSource,
        userSource
      } = await loadConfigState()
      const mergedSections = buildSections(mergedConfig)
      mergedSections.general.baseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__ != null
        ? resolveProjectOoBaseDirName(process.env)
        : mergedConfig.baseDir ?? resolveProjectOoBaseDirName(process.env)
      mergedSections.adapterBuiltinModels = loadAdapterBuiltinModels(mergedConfig)
      const about = await buildConfigAbout()
      ctx.body = {
        sources: {
          global: buildSections(globalSource?.rawConfig),
          project: buildSections(projectSource?.rawConfig),
          user: buildSections(userSource?.rawConfig),
          merged: mergedSections
        },
        resolvedSources: {
          global: buildSections(globalSource?.resolvedConfig),
          project: buildSections(projectSource?.resolvedConfig),
          user: buildSections(userSource?.resolvedConfig)
        },
        meta: {
          workspaceFolder,
          configPresent: {
            global: globalSource?.configPath != null,
            project: projectSource?.configPath != null,
            user: userSource?.configPath != null
          },
          sourceFiles: {
            global: {
              configPath: globalSource?.configPath,
              writableConfigPath: resolveWritableConfigPath(workspaceFolder, 'global'),
              extendPaths: globalSource?.extendPaths ?? []
            },
            project: {
              configPath: projectSource?.configPath,
              writableConfigPath: resolveWritableConfigPath(workspaceFolder, 'project'),
              extendPaths: projectSource?.extendPaths ?? []
            },
            user: {
              configPath: userSource?.configPath,
              writableConfigPath: resolveWritableConfigPath(workspaceFolder, 'user'),
              extendPaths: userSource?.extendPaths ?? []
            }
          },
          experiments: {},
          about
        }
      }
    } catch (err) {
      throw internalServerError('Failed to load config', { cause: err, code: 'config_load_failed' })
    }
  })

  router.patch('/', async (ctx) => {
    const { source, section, unsetPaths, value } = ctx.request.body as {
      source?: ConfigSource
      section?: string
      unsetPaths?: unknown
      value?: unknown
    }

    if (source !== 'global' && source !== 'project' && source !== 'user') {
      throw badRequest('Invalid source', { source }, 'invalid_source')
    }

    if (section == null || typeof section !== 'string' || section.trim() === '') {
      throw badRequest('Invalid section', { section }, 'invalid_section')
    }

    const writeError = resolveConfigSectionWriteError(source, section, value)
    if (writeError != null) {
      throw badRequest(writeError, { source, section }, 'invalid_config_section_source')
    }

    try {
      const workspaceFolder = getWorkspaceFolder()
      const parsed = await validateConfigSection(section, applyUnsetPaths(value, unsetPaths), {
        cwd: workspaceFolder
      })
      if (!parsed.success) {
        throw badRequest(
          'Invalid config section value',
          {
            section,
            issues: parsed.error.issues.map(issue => ({
              path: issue.path,
              message: issue.message
            }))
          },
          'invalid_config_section_value'
        )
      }
      await updateConfigFile({ workspaceFolder, source, section, value: parsed.data })
      ctx.body = { ok: true }
    } catch (err) {
      if (isHttpError(err)) {
        throw err
      }
      throw internalServerError('Failed to update config', { cause: err, code: 'config_update_failed' })
    }
  })

  return router
}
