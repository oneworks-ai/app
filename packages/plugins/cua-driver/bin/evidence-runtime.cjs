const { spawnSync } = require('node:child_process')
const {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, isAbsolute, join, resolve } = require('node:path')

const { verifyExpectedStateText } = require('./evidence-state.cjs')
const { findOnPath } = require('./runtime.cjs')

const requiredTurnFiles = ['action.json', 'app_state.json']

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyFile(filePath) {
  try {
    return statSync(filePath).isFile() && statSync(filePath).size > 0
  } catch {
    return false
  }
}

function listTurnDirectories(outputDir) {
  return readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^turn-\d{5}$/.test(entry.name))
    .map(entry => join(outputDir, entry.name))
    .sort()
}

function readPngDimensions(filePath) {
  const data = readFileSync(filePath)
  if (data.length < 24 || data.toString('ascii', 12, 16) !== 'IHDR') return undefined
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

function getVideoDimensions(screenshots) {
  const dimensions = screenshots.map(readPngDimensions).filter(Boolean)
  if (dimensions.length === 0) return { width: 1280, height: 720 }
  const sourceWidth = Math.max(...dimensions.map(item => item.width))
  const sourceHeight = Math.max(...dimensions.map(item => item.height))
  const scale = Math.min(6, 1920 / sourceWidth, 1080 / sourceHeight)
  const toEven = value => Math.max(2, Math.floor(value / 2) * 2)
  return { width: toEven(sourceWidth * scale), height: toEven(sourceHeight * scale) }
}

function renderScreenshotVideo(outputDir, screenshots, frameDurationMs, options = {}) {
  const ffmpeg = options.ffmpegPath ?? findOnPath('ffmpeg')
  if (ffmpeg == null) {
    throw new Error('Recording contains zero native frames and ffmpeg is unavailable for the trajectory fallback.')
  }

  const { width, height } = getVideoDimensions(screenshots)
  const frameSeconds = (frameDurationMs / 1000).toFixed(3)
  const totalSeconds = ((frameDurationMs * screenshots.length) / 1000).toFixed(3)
  const filterParts = []
  const concatInputs = []
  const args = ['-y', '-loglevel', 'error']
  for (const [index, screenshot] of screenshots.entries()) {
    args.push('-loop', '1', '-framerate', '30', '-i', screenshot)
    filterParts.push(
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,` +
        `trim=duration=${frameSeconds},setpts=PTS-STARTPTS[v${index}]`
    )
    concatInputs.push(`[v${index}]`)
  }
  filterParts.push(
    `${concatInputs.join('')}concat=n=${screenshots.length}:v=1:a=0,` +
      'fps=30,format=yuv420p[v]'
  )

  const temporaryDir = mkdtempSync(join(tmpdir(), 'oneworks-cua-evidence-'))
  const temporaryVideo = join(temporaryDir, 'recording_rendered.mp4')
  const renderedVideo = join(outputDir, 'recording_rendered.mp4')
  try {
    const result = (options.spawnSync ?? spawnSync)(ffmpeg, [
      ...args,
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[v]',
      '-t',
      totalSeconds,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '24',
      '-movflags',
      '+faststart',
      temporaryVideo
    ], { encoding: 'utf8', timeout: 120_000 })
    if (result.status !== 0 || !nonEmptyFile(temporaryVideo)) {
      const detail = String(result.stderr ?? result.error?.message ?? '').trim()
      throw new Error(`Could not render trajectory video${detail === '' ? '.' : `: ${detail}`}`)
    }
    renameSync(temporaryVideo, renderedVideo)
    return renderedVideo
  } finally {
    rmSync(temporaryDir, { force: true, recursive: true })
  }
}

function finalizeRecording(payload, options = {}) {
  if (!isRecord(payload) || typeof payload.output_dir !== 'string' || !isAbsolute(payload.output_dir)) {
    throw new Error('output_dir must be an absolute recording directory path.')
  }

  const outputDir = resolve(payload.output_dir)
  const sessionPath = join(outputDir, 'session.json')
  if (!nonEmptyFile(sessionPath)) throw new Error(`Missing non-empty recording metadata: ${sessionPath}`)
  const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
  const turnDirectories = listTurnDirectories(outputDir)
  if (turnDirectories.length === 0) throw new Error(`No recorded turns found in ${outputDir}`)
  for (const turnDirectory of turnDirectories) {
    for (const fileName of requiredTurnFiles) {
      const filePath = join(turnDirectory, fileName)
      if (!nonEmptyFile(filePath)) throw new Error(`Missing non-empty trajectory artifact: ${filePath}`)
    }
  }

  const firstScreenshot = turnDirectories
    .map(turnDirectory => join(turnDirectory, 'screenshot.png'))
    .find(nonEmptyFile)
  if (firstScreenshot == null) throw new Error(`No non-empty trajectory screenshots found in ${outputDir}`)
  let previousScreenshot = firstScreenshot
  let reusedScreenshotCount = 0
  const screenshots = turnDirectories.map(turnDirectory => {
    const screenshot = join(turnDirectory, 'screenshot.png')
    if (nonEmptyFile(screenshot)) previousScreenshot = screenshot
    else reusedScreenshotCount += 1
    return previousScreenshot
  })
  const requestedScreenshot = typeof payload.final_screenshot === 'string'
    ? resolve(payload.final_screenshot)
    : screenshots.at(-1)
  if (requestedScreenshot == null || !nonEmptyFile(requestedScreenshot)) {
    throw new Error(`Missing non-empty final screenshot: ${requestedScreenshot ?? 'unknown'}`)
  }
  const verifiedStateText = verifyExpectedStateText(
    turnDirectories,
    requestedScreenshot,
    payload.expected_state_text
  )
  const finalScreenshot = join(outputDir, 'final-screenshot.png')
  if (resolve(requestedScreenshot) !== resolve(finalScreenshot)) copyFileSync(requestedScreenshot, finalScreenshot)

  const rawVideoName = isRecord(session.video) && typeof session.video.path === 'string'
    ? basename(session.video.path)
    : 'recording.mp4'
  const rawVideo = join(outputDir, rawVideoName)
  const nativeFrameCount = isRecord(session.video) && Number.isFinite(session.video.frame_count)
    ? Math.max(0, Math.trunc(session.video.frame_count))
    : 0
  const renderedVideo = join(outputDir, 'recording_rendered.mp4')
  let usedTrajectoryFallback = false

  if (nativeFrameCount > 0 && nonEmptyFile(rawVideo)) {
    if (!nonEmptyFile(renderedVideo)) copyFileSync(rawVideo, renderedVideo)
  } else {
    const frameDurationMs = typeof payload.frame_duration_ms === 'number'
      ? Math.max(250, Math.min(5000, Math.trunc(payload.frame_duration_ms)))
      : 1200
    renderScreenshotVideo(outputDir, screenshots, frameDurationMs, options)
    usedTrajectoryFallback = true
  }

  if (!nonEmptyFile(renderedVideo)) throw new Error(`Recording finalization produced no video: ${renderedVideo}`)
  return {
    ok: true,
    outputDir,
    videoPath: renderedVideo,
    nativeVideoPath: nonEmptyFile(rawVideo) ? rawVideo : undefined,
    screenshotPath: finalScreenshot,
    turnCount: turnDirectories.length,
    reusedScreenshotCount,
    verifiedStateText,
    nativeFrameCount,
    usedTrajectoryFallback
  }
}

module.exports = { finalizeRecording, renderScreenshotVideo }
