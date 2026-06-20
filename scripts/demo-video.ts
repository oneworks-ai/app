import process from 'node:process'

import { recordDemoVideoScenario } from './demo-video/recorder'
import { getDemoVideoScenario, listDemoVideoScenarios } from './demo-video/scenarios'
import type {
  DemoVideoColorScheme,
  DemoVideoListOptions,
  DemoVideoRecordOptions,
  DemoVideoRecordResult
} from './demo-video/types'

export type { DemoVideoColorScheme, DemoVideoListOptions, DemoVideoRecordOptions, DemoVideoRecordResult }

export const parseDemoVideoColorScheme = (value: string): DemoVideoColorScheme => {
  if (value === 'dark' || value === 'light' || value === 'system') return value
  throw new Error('color-scheme must be one of: light, dark, system.')
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
  process.stdout.write(
    `[demo-video] frames=${result.frameCount} duration=${(result.durationMs / 1_000).toFixed(1)}s fps=${result.fps}\n`
  )
  return result
}
