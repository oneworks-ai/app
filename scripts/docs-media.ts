import { Buffer } from 'node:buffer'
import { execFile as execFileCallback } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const adapterPromoFileNames = [
  'oneworks-adapter-promo-dark-en.mp4',
  'oneworks-adapter-promo-dark-zh.mp4',
  'oneworks-adapter-promo-light-en.mp4',
  'oneworks-adapter-promo-light-zh.mp4'
] as const

const expectedDurationSeconds = 21
const mediaDirectory = '.oo/docs/videos/adapter-promo'

interface CommandResult {
  stdout: string
}

type RunCommand = (
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
  }
) => Promise<CommandResult>

const runCommand: RunCommand = async (command, args, options) => {
  const result = await execFile(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeoutMs
  })
  return {
    stdout: result.stdout
  }
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const assertFastStartMp4 = (contents: Buffer, fileName: string) => {
  const moovOffset = contents.indexOf(Buffer.from('moov'))
  const mdatOffset = contents.indexOf(Buffer.from('mdat'))

  assert(moovOffset >= 0, `${fileName}: missing moov atom.`)
  assert(mdatOffset >= 0, `${fileName}: missing mdat atom.`)
  assert(moovOffset < mdatOffset, `${fileName}: moov atom must precede mdat for fast-start playback.`)
}

interface ProbeStream {
  codec_name?: string
  codec_type?: string
  height?: number
  pix_fmt?: string
  r_frame_rate?: string
  width?: number
}

interface ProbeOutput {
  format?: {
    duration?: string
  }
  streams?: ProbeStream[]
}

const assertExpectedProbe = (fileName: string, probe: ProbeOutput) => {
  const streams = probe.streams ?? []
  const videoStreams = streams.filter(stream => stream.codec_type === 'video')
  const audioStreams = streams.filter(stream => stream.codec_type === 'audio')

  assert(videoStreams.length === 1, `${fileName}: expected exactly one video stream.`)
  assert(audioStreams.length === 0, `${fileName}: documentation derivatives must not contain audio.`)

  const video = videoStreams[0]
  assert(video.codec_name === 'h264', `${fileName}: expected H.264 video.`)
  assert(video.width === 1280 && video.height === 720, `${fileName}: expected 1280x720 video.`)
  assert(video.pix_fmt === 'yuv420p', `${fileName}: expected yuv420p pixel format.`)
  assert(video.r_frame_rate === '24/1', `${fileName}: expected 24 fps video.`)

  const duration = Number.parseFloat(probe.format?.duration ?? '')
  assert(Number.isFinite(duration), `${fileName}: missing duration.`)
  assert(
    Math.abs(duration - expectedDurationSeconds) <= 0.05,
    `${fileName}: expected ${expectedDurationSeconds}s duration, received ${duration}s.`
  )
}

const assertBinaryGitAttribute = async (
  rootDir: string,
  relativePath: string,
  commandRunner: RunCommand
) => {
  const result = await commandRunner(
    'git',
    ['check-attr', 'text', '--', relativePath],
    { cwd: rootDir, timeoutMs: 10_000 }
  )
  assert(
    result.stdout.trim().endsWith(': text: unset'),
    `${relativePath}: Git must treat MP4 assets as binary (add "*.mp4 -text" to .gitattributes).`
  )
}

export interface DocsMediaVerification {
  durationSeconds: number
  file: string
  height: number
  width: number
}

export const verifyDocsMedia = async (input: {
  ffmpegPath?: string
  ffprobePath?: string
  rootDir?: string
  runCommand?: RunCommand
} = {}): Promise<DocsMediaVerification[]> => {
  const rootDir = path.resolve(input.rootDir ?? process.cwd())
  const commandRunner = input.runCommand ?? runCommand
  const ffmpegPath = input.ffmpegPath ?? 'ffmpeg'
  const ffprobePath = input.ffprobePath ?? 'ffprobe'
  const results: DocsMediaVerification[] = []

  for (const fileName of adapterPromoFileNames) {
    const relativePath = path.posix.join(mediaDirectory, fileName)
    const absolutePath = path.resolve(rootDir, relativePath)
    const contents = await readFile(absolutePath)

    await assertBinaryGitAttribute(rootDir, relativePath, commandRunner)
    assertFastStartMp4(contents, fileName)

    const probeResult = await commandRunner(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate:format=duration',
        '-of',
        'json',
        absolutePath
      ],
      { cwd: rootDir, timeoutMs: 30_000 }
    )
    const probe = JSON.parse(probeResult.stdout) as ProbeOutput
    assertExpectedProbe(fileName, probe)

    await commandRunner(
      ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-i',
        absolutePath,
        '-map',
        '0:v:0',
        '-f',
        'null',
        '-'
      ],
      { cwd: rootDir, timeoutMs: 60_000 }
    )

    results.push({
      durationSeconds: Number.parseFloat(probe.format?.duration ?? ''),
      file: relativePath,
      height: 720,
      width: 1280
    })
  }

  return results
}

export const runDocsMediaVerify = async (input: {
  ffmpegPath?: string
  ffprobePath?: string
  json?: boolean
} = {}) => {
  const results = await verifyDocsMedia(input)
  if (input.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, videos: results }, null, 2)}\n`)
    return
  }

  process.stdout.write(
    `Verified ${results.length} documentation MP4 files: binary, fast-start, expected metadata, and complete decode.\n`
  )
}
