import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import type { NotificationMetadata } from 'node-notifier'
import notifier from 'node-notifier'
import z from 'zod'

export const notifyOptionsSchema = z.object({
  title: z.string().optional(),
  description: z.string(),
  icon: z.string().optional().describe('自定义图标路径'),
  sound: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe('是否播放音效或指定音效文件路径'),
  volume: z.number().optional().describe('音量，0-1 或 0-100'),
  timeout: z
    .union([z.number(), z.literal(false)])
    .optional()
    .describe('通知超时时间'),
  actions: z.array(z.string()).optional().describe('通知操作按钮'),
  needConfirm: z.boolean().optional().describe('是否需要用户确认')
})

export type NotifyOptions = z.infer<typeof notifyOptionsSchema>

const notificationAssetNames = {
  icon: 'mcp.png',
  sound: 'completed.mp3'
} as const

const hasNotificationAssets = (directory: string) => (
  fs.existsSync(path.join(directory, notificationAssetNames.icon)) &&
  fs.existsSync(path.join(directory, notificationAssetNames.sound))
)

const resolveUtilsPackageDir = (runtimePackageDir: string | undefined) => {
  const normalizedPackageDir = runtimePackageDir?.trim()
  if (normalizedPackageDir == null || normalizedPackageDir === '') return undefined

  try {
    const packageJsonPath = createRequire(path.join(normalizedPackageDir, 'package.json'))
      .resolve('@oneworks/utils/package.json')
    return path.dirname(packageJsonPath)
  } catch {
    return undefined
  }
}

export const resolveDefaultNotificationAssetPaths = (
  env: NodeJS.ProcessEnv = process.env,
  moduleDir = __dirname
) => {
  const desktopAppDir = env.__ONEWORKS_DESKTOP_APP_DIR__?.trim()
  const utilsPackageDirs = [
    resolveUtilsPackageDir(env.__ONEWORKS_PROJECT_PACKAGE_DIR__),
    desktopAppDir == null || desktopAppDir === ''
      ? undefined
      : path.join(desktopAppDir, 'node_modules', '@oneworks', 'utils')
  ].filter((candidate): candidate is string => candidate != null)
  const candidateDirectories = [
    ...utilsPackageDirs.flatMap(packageDir => [
      path.join(packageDir, 'src', 'assets'),
      path.join(packageDir, 'dist', 'assets'),
      path.join(packageDir, 'assets')
    ]),
    path.resolve(moduleDir, 'assets'),
    path.resolve(moduleDir, '..', 'src', 'assets')
  ]
  const assetDir = candidateDirectories.find(hasNotificationAssets) ?? path.resolve(moduleDir, 'assets')

  return {
    icon: path.join(assetDir, notificationAssetNames.icon),
    sound: path.join(assetDir, notificationAssetNames.sound)
  }
}

export const notify = async (options: NotifyOptions) => {
  const {
    title,
    description,
    icon,
    sound = true,
    volume,
    timeout = 10 * 60 * 1000,
    needConfirm
  } = options

  const { icon: defaultIcon, sound: defaultSound } = resolveDefaultNotificationAssetPaths()

  const resolvedSound = typeof sound === 'string'
    ? sound
    : (sound ? defaultSound : undefined)
  const resolvedVolume = typeof volume === 'number'
    ? (volume > 1 ? Math.min(volume, 100) / 100 : Math.max(volume, 0))
    : undefined
  const shouldPlaySound = resolvedSound != null && resolvedVolume !== 0
  const shouldUseNotifierSound = !(resolvedVolume != null && resolvedSound != null && process.platform === 'darwin')

  if (shouldPlaySound && !shouldUseNotifierSound && resolvedSound != null) {
    try {
      const args = ['-v', `${resolvedVolume ?? 1}`, resolvedSound]
      const proc = spawn('afplay', args, { stdio: 'ignore', detached: true })
      proc.unref()
    } catch {
    }
  }

  const [response, metadata] = await new Promise<
    [string, NotificationMetadata | undefined]
  >((ok, no) => {
    notifier.notify(
      {
        icon: icon || defaultIcon,
        title,
        sound: shouldUseNotifierSound ? resolvedSound : undefined,
        message: description,
        wait: true,
        reply: true,
        timeout
      },
      (err, nextResponse, nextMetadata) => {
        if (err) {
          no(err)
          return
        }
        if (!needConfirm) {
          return
        }
        ok([nextResponse, nextMetadata])
      }
    )

    if (!needConfirm) {
      ok([
        'default',
        {
          activationType: 'default',
          activationAt: Date.now().toLocaleString(),
          deliveredAt: Date.now().toLocaleString()
        }
      ])
    }
  })

  return { response, metadata }
}
