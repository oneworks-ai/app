import { ensureDriver, getDriverStatus } from './driver.js'
import type { CuaPluginContext } from './types.js'

const statusApiInputSchema = {
  type: 'object',
  description: 'The status endpoint does not require a request body.',
  additionalProperties: false
}

const statusApiOutputSchema = {
  type: 'object',
  required: ['ok', 'platform', 'appInstalled', 'needsInstall'],
  properties: {
    ok: { type: 'boolean' },
    platform: { type: 'string' },
    appInstalled: { type: 'boolean' },
    driverPath: { type: 'string' },
    driverRealPath: { type: 'string' },
    needsInstall: { type: 'boolean' },
    daemon: {
      type: 'object',
      additionalProperties: true
    }
  },
  additionalProperties: true
}

const statusApiHeaderSchema = {
  type: 'object',
  properties: {
    accept: {
      type: 'string',
      description: 'Use application/json for the status response.'
    }
  },
  additionalProperties: true
}

const json = (body: unknown) => ({
  headers: {
    'content-type': 'application/json; charset=utf-8'
  },
  body
})

export function activatePlugin(ctx: CuaPluginContext) {
  ctx.logger.info({ role: ctx.runtime.role, scope: ctx.scope }, '[cua-driver] activated')

  ctx.registerCommand('status', payload => getDriverStatus(payload))
  ctx.registerCommand('driver-path', async () => {
    const status = await getDriverStatus({ checkDaemon: false })
    return {
      ok: status.driverPath != null,
      driverPath: status.driverPath,
      driverRealPath: status.driverRealPath,
      needsInstall: status.needsInstall
    }
  })
  ctx.registerCommand('ensure', payload => ensureDriver(ctx, payload))

  ctx.registerApi('status', {
    title: {
      en: 'Cua Driver status API',
      'zh-Hans': 'Cua Driver 状态 API'
    },
    description: {
      en: 'Reports the local Cua Driver installation, resolved binary, and daemon status without installing anything.',
      'zh-Hans': '只读返回本机 Cua Driver 安装、可执行文件与 daemon 状态，不触发安装。'
    },
    inputSchema: statusApiInputSchema,
    outputSchema: statusApiOutputSchema,
    headerSchema: statusApiHeaderSchema,
    handler: async () => json(await getDriverStatus({ checkDaemon: true }))
  })

  ctx.dispose(() => {
    ctx.logger.info({ role: ctx.runtime.role, scope: ctx.scope }, '[cua-driver] disposed')
  })
}
