import path from 'node:path'
import process from 'node:process'

import { recordDemoVideoScenario } from './demo-video/recorder'
import { getDemoVideoScenario, listDemoVideoScenarios } from './demo-video/scenarios'
import type {
  DemoVideoBatchOptions,
  DemoVideoBatchResult,
  DemoVideoCaptureSource,
  DemoVideoColorScheme,
  DemoVideoListOptions,
  DemoVideoPageBackground,
  DemoVideoRecordOptions,
  DemoVideoRecordResult,
  DemoVideoSystemWindowCaptureBackend
} from './demo-video/types'

export type {
  DemoVideoBatchOptions,
  DemoVideoBatchResult,
  DemoVideoCaptureSource,
  DemoVideoColorScheme,
  DemoVideoListOptions,
  DemoVideoPageBackground,
  DemoVideoRecordOptions,
  DemoVideoRecordResult,
  DemoVideoSystemWindowCaptureBackend
}

const DEFAULT_BATCH_COLOR_SCHEMES: DemoVideoColorScheme[] = ['light', 'dark']
const DEFAULT_BATCH_LANGUAGES = ['zh', 'en']

export const parseDemoVideoCaptureSource = (value: string): DemoVideoCaptureSource => {
  if (value === 'cdp' || value === 'system-display' || value === 'system-window') return value
  throw new Error('capture-source must be one of: cdp, system-display, system-window.')
}

export const parseDemoVideoColorScheme = (value: string): DemoVideoColorScheme => {
  if (value === 'dark' || value === 'light' || value === 'system') return value
  throw new Error('color-scheme must be one of: light, dark, system.')
}

export const parseDemoVideoColorSchemeList = (value: string) => {
  const colorSchemes = value
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')
    .map(parseDemoVideoColorScheme)
  if (colorSchemes.length === 0) {
    throw new Error('color-schemes must include at least one value.')
  }
  return colorSchemes
}

export const parseDemoVideoLanguage = (value: string) => {
  const normalized = value.trim().replaceAll('_', '-')
  if (normalized === '' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(normalized)) {
    throw new Error('language must be a BCP-47-like language code, for example zh, en, zh-Hans, or en-US.')
  }
  return normalized
}

export const parseDemoVideoLanguageList = (value: string) => {
  const languages = value
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')
    .map(parseDemoVideoLanguage)
  if (languages.length === 0) {
    throw new Error('languages must include at least one value.')
  }
  return languages
}

export const parseDemoVideoPageBackground = (value: string): DemoVideoPageBackground => {
  if (value === 'app' || value === 'macos-wallpaper') return value
  throw new Error('page-background must be one of: app, macos-wallpaper.')
}

export const parseDemoVideoSystemWindowCaptureBackend = (value: string): DemoVideoSystemWindowCaptureBackend => {
  if (value === 'video' || value === 'frames') return value
  throw new Error('system-window-capture-backend must be one of: video, frames.')
}

export const parseDemoVideoBackgroundColor = (value: string) => {
  const normalized = value.trim()
  const match = /^(?:#|0x)?([0-9a-fA-F]{6})$/u.exec(normalized)
  if (match == null) {
    throw new Error('video-background-color must be a 6-digit hex color, for example #323232.')
  }
  return `0x${match[1]!.toUpperCase()}`
}

export const runDemoVideoList = async (options: DemoVideoListOptions = {}) => {
  const scenarios = listDemoVideoScenarios()
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify({ scenarios }, null, 2)}\n`)
    return scenarios
  }

  process.stdout.write('[demo-video] scenarios\n')
  for (const scenario of scenarios) {
    const urlRequirement = scenario.requiresUrl ? 'requires --url' : 'no --url required'
    process.stdout.write(
      `- ${scenario.id}: ${scenario.title} (${scenario.defaultViewport.width}x${scenario.defaultViewport.height}, ${scenario.defaultFps}fps, ${urlRequirement})\n`
    )
    process.stdout.write(`  ${scenario.description}\n`)
  }
  return scenarios
}

export const runDemoVideoRecord = async (
  options: DemoVideoRecordOptions
): Promise<DemoVideoRecordResult> => {
  const scenario = getDemoVideoScenario(options.scenarioId)
  const result = await recordDemoVideoScenario(scenario, options)
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return result
  }

  process.stdout.write('[demo-video] ready\n')
  process.stdout.write(`[demo-video] scenario=${result.scenarioId}\n`)
  process.stdout.write(`[demo-video] video=${result.videoPath}\n`)
  process.stdout.write(`[demo-video] poster=${result.posterPath}\n`)
  process.stdout.write(`[demo-video] stills=${result.stillsManifestPath}\n`)
  process.stdout.write(
    `[demo-video] frames=${result.frameCount} duration=${(result.durationMs / 1_000).toFixed(1)}s fps=${result.fps}\n`
  )
  return result
}

export const runDemoVideoBatch = async (
  options: DemoVideoBatchOptions
): Promise<DemoVideoBatchResult> => {
  const scenario = getDemoVideoScenario(options.scenarioId)
  const colorSchemes = options.colorSchemes ?? DEFAULT_BATCH_COLOR_SCHEMES
  const languages = options.languages ?? DEFAULT_BATCH_LANGUAGES
  const variants: DemoVideoBatchResult['variants'] = []

  for (const colorScheme of colorSchemes) {
    for (const language of languages) {
      const variantId = `${colorScheme}-${language}`
      const result = await recordDemoVideoScenario(scenario, {
        ...options,
        colorScheme,
        json: false,
        language,
        name: `${options.name ?? scenario.id}-${variantId}`,
        outDir: path.join(options.outDir ?? path.join('.logs/demo-videos', scenario.id), variantId)
      })
      variants.push({
        colorScheme,
        language,
        result,
        variantId
      })
    }
  }

  const batchResult = {
    scenarioId: scenario.id,
    variants
  }
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(batchResult, null, 2)}\n`)
    return batchResult
  }

  process.stdout.write('[demo-video] batch ready\n')
  process.stdout.write(`[demo-video] scenario=${batchResult.scenarioId}\n`)
  for (const variant of variants) {
    process.stdout.write(`[demo-video] ${variant.variantId} video=${variant.result.videoPath}\n`)
    process.stdout.write(`[demo-video] ${variant.variantId} stills=${variant.result.stillsManifestPath}\n`)
  }
  return batchResult
}
