/* eslint-disable max-lines -- CDP recording keeps Chrome lifecycle, frame capture, and ffmpeg encoding together. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { deflateSync } from 'node:zlib'

import type {
  DemoVideoCaptureSource,
  DemoVideoClickOptions,
  DemoVideoColorScheme,
  DemoVideoCropRect,
  DemoVideoKeyOptions,
  DemoVideoPageBackground,
  DemoVideoRecordOptions,
  DemoVideoRecordResult,
  DemoVideoScenario,
  DemoVideoScenarioContext,
  DemoVideoSystemCursorWindowBounds,
  DemoVideoSystemWindowCaptureBackend,
  DemoVideoTextOptions,
  DemoVideoTypeOptions,
  DemoVideoViewport
} from './types'

interface ChromeDebugTarget {
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface ChromeLaunch {
  close: () => Promise<void>
  port: number
}

interface CdpPendingRequest {
  reject: (reason: Error) => void
  resolve: (value: unknown) => void
}

interface CdpProtocolError {
  code?: number
  message?: string
}

interface RuntimeEvaluateResponse {
  exceptionDetails?: {
    exception?: {
      description?: string
    }
    text?: string
  }
  result?: {
    value?: unknown
  }
}

interface PageCaptureScreenshotResponse {
  data?: string
}

interface BrowserGetWindowForTargetResponse {
  windowId?: number
}

interface MacWindowInfo {
  height: number
  id: number
  ownerName: string
  ownerPid: number
  title: string
  width: number
  x: number
  y: number
}

interface Point {
  x: number
  y: number
}

type CursorAction = 'click' | 'idle' | 'move' | 'release'

interface KeyDefinition {
  code: string
  display: string
  key: string
  windowsVirtualKeyCode: number
  text?: string
}

interface SystemVideoSegment {
  durationMs: number
  videoPath: string
  alphaMaskPath?: string
}

interface SystemCursorEvent {
  action: CursorAction
  durationMs: number
  from: Point
  startMs: number
  to: Point
}

interface SystemCursorTimeline {
  enabled: boolean
  events: SystemCursorEvent[]
  initialPoint: Point
}

interface SystemCursorFrameSample extends Point {
  action: CursorAction
  frameIndex: number
  scale: number
  timestampMs: number
}

interface SystemCursorContinuityIssue {
  code: 'cursor_event_overlap' | 'cursor_event_source_jump' | 'cursor_frame_jump' | 'cursor_speed_jump'
  message: string
  severity: 'error' | 'warning'
  frameIndex?: number
  timestampMs?: number
  value?: number
}

interface SystemCursorContinuityReport {
  fps: number
  issueCount: number
  issues: SystemCursorContinuityIssue[]
  maxFrameDistancePx: number
  maxSpeedPxPerSecond: number
  ok: boolean
  sampleCount: number
  thresholds: {
    maxFrameDistanceErrorPx: number
    maxFrameDistanceWarningPx: number
    maxSpeedErrorPxPerSecond: number
    maxSpeedWarningPxPerSecond: number
  }
}

interface ModifierKeyDefinition extends KeyDefinition {
  modifierBit: number
}

interface ParsedKeyCombo {
  displayLabels: string[]
  key: KeyDefinition
  modifiers: ModifierKeyDefinition[]
}

interface SettledAction {
  ok: boolean
  error?: unknown
}

const DEFAULT_COLOR_SCHEME: DemoVideoColorScheme = 'light'
const DEFAULT_SYSTEM_WINDOW_VIDEO_BACKGROUND_COLOR = '0x323232'
const DEFAULT_SYSTEM_WINDOW_CAPTURE_BACKEND: DemoVideoSystemWindowCaptureBackend = 'video'
const DEFAULT_SYSTEM_WINDOW_VIDEO_PADDING_RATIO = 0.12
const DEFAULT_SYSTEM_WINDOW_VIDEO_CORNER_RADIUS = 32
const MIN_SYSTEM_WINDOW_VIDEO_PADDING_X = 240
const MIN_SYSTEM_WINDOW_VIDEO_PADDING_Y = 180
const DEFAULT_OUTPUT_ROOT = '.logs/demo-videos'
const DEFAULT_CHROME_TIMEOUT_MS = 15_000
const DEFAULT_ACTION_TIMEOUT_MS = 10_000
const DEFAULT_CLICK_SETTLE_MS = 260
const DEFAULT_KEY_SETTLE_MS = 220
const SYSTEM_CURSOR_PRESS_LEAD_MS = 90
const SYSTEM_CURSOR_PRESS_HOLD_MS = 150
const SYSTEM_CURSOR_CLICK_DURATION_MS = SYSTEM_CURSOR_PRESS_LEAD_MS + SYSTEM_CURSOR_PRESS_HOLD_MS
const SYSTEM_CURSOR_RELEASE_DURATION_MS = 360
const SYSTEM_CURSOR_INPUT_AFTER_VISUAL_DELAY_MS = 420
const SYSTEM_CURSOR_INPUT_HOLD_MS = 40
const SYSTEM_CURSOR_PRESS_SCALE = 0.88
const SYSTEM_CURSOR_MOVE_BASE_MS = 620
const SYSTEM_CURSOR_MOVE_DISTANCE_MS_PER_PX = 0.5
const SYSTEM_CURSOR_MOVE_MIN_MS = 720
const SYSTEM_CURSOR_MOVE_MAX_MS = 1_320
const SYSTEM_CURSOR_MOVE_RECORD_PADDING_MS = 60
const SYSTEM_CURSOR_STATIONARY_MOVE_MS = 140
const SYSTEM_DISPLAY_CAPTURE_TIMELINE_OFFSET_MS = 260
const APP_LANGUAGE_OVERRIDE_STORAGE_KEY = 'oneworks.interfaceLanguageOverride'
const DEFAULT_PAGE_BACKGROUND: DemoVideoPageBackground = 'app'
const MACOS_WALLPAPER_CANDIDATES = [
  '/System/Library/Desktop Pictures/Sonoma.heic',
  '/System/Library/Desktop Pictures/.wallpapers/Sonoma Horizon/Sonoma Horizon.heic',
  '/System/Library/Desktop Pictures/.wallpapers/Sonoma Horizon/Sonoma Horizon Thumbnail@2x.png',
  '/System/Library/Desktop Pictures/.thumbnails/Ventura Graphic.heic',
  '/System/Library/Desktop Pictures/.thumbnails/Big Sur Graphic.heic'
]

const isSystemCaptureSource = (source: DemoVideoCaptureSource) => (
  source === 'system-display' || source === 'system-window'
)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const settleAction = async (promise: Promise<void>): Promise<SettledAction> => {
  try {
    await promise
    return { ok: true }
  } catch (error) {
    return { error, ok: false }
  }
}

const rethrowSettledAction = (result: SettledAction) => {
  if (result.ok) return
  throw result.error
}

export const shouldContinueSystemCaptureDuringAction = (input: {
  actionSettled: boolean
  capturedMs: number
  requestedDurationMs: number
}) => input.capturedMs < input.requestedDurationMs || !input.actionSettled

export const getSystemCaptureTimelineElapsedMs = (input: {
  captureSource: DemoVideoCaptureSource
  elapsedWallMs: number
}) =>
  Math.max(
    0,
    input.elapsedWallMs - (input.captureSource === 'system-display'
      ? SYSTEM_DISPLAY_CAPTURE_TIMELINE_OFFSET_MS
      : 0)
  )

export const buildSystemCursorClickTimingPlan = (input: {
  startMs: number
}) => ({
  cursorClickStartMs: input.startMs,
  cursorClickDurationMs: SYSTEM_CURSOR_CLICK_DURATION_MS,
  cursorReleaseStartMs: input.startMs + SYSTEM_CURSOR_PRESS_LEAD_MS + SYSTEM_CURSOR_PRESS_HOLD_MS,
  cursorReleaseDurationMs: SYSTEM_CURSOR_RELEASE_DURATION_MS,
  mousePressedMs: input.startMs +
    SYSTEM_CURSOR_PRESS_LEAD_MS +
    SYSTEM_CURSOR_PRESS_HOLD_MS +
    SYSTEM_CURSOR_RELEASE_DURATION_MS +
    SYSTEM_CURSOR_INPUT_AFTER_VISUAL_DELAY_MS,
  mouseReleasedMs: input.startMs +
    SYSTEM_CURSOR_PRESS_LEAD_MS +
    SYSTEM_CURSOR_PRESS_HOLD_MS +
    SYSTEM_CURSOR_RELEASE_DURATION_MS +
    SYSTEM_CURSOR_INPUT_AFTER_VISUAL_DELAY_MS +
    SYSTEM_CURSOR_INPUT_HOLD_MS
})

const macWindowListScript = `
import Foundation
import CoreGraphics

let ownerPid = Int(CommandLine.arguments.dropFirst().first ?? "") ?? -1
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
let rawList = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
var windows: [[String: Any]] = []

for item in rawList {
  guard (item[kCGWindowOwnerPID as String] as? Int) == ownerPid else { continue }
  let alpha = item[kCGWindowAlpha as String] as? Double ?? 1
  if alpha <= 0 { continue }
  guard let id = item[kCGWindowNumber as String] as? Int else { continue }
  let bounds = item[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = bounds["Width"] as? Double ?? 0
  let height = bounds["Height"] as? Double ?? 0
  if width < 80 || height < 80 { continue }
  windows.append([
    "id": id,
    "ownerPid": ownerPid,
    "ownerName": item[kCGWindowOwnerName as String] as? String ?? "",
    "title": item[kCGWindowName as String] as? String ?? "",
    "x": bounds["X"] as? Double ?? 0,
    "y": bounds["Y"] as? Double ?? 0,
    "width": width,
    "height": height
  ])
}

windows.sort {
  let leftArea = ($0["width"] as? Double ?? 0) * ($0["height"] as? Double ?? 0)
  let rightArea = ($1["width"] as? Double ?? 0) * ($1["height"] as? Double ?? 0)
  return leftArea > rightArea
}

let data = try JSONSerialization.data(withJSONObject: windows)
print(String(data: data, encoding: .utf8)!)
`

const currentMacosWallpaperScript = `
import AppKit

let urls = NSScreen.screens.compactMap { screen in
  NSWorkspace.shared.desktopImageURL(for: screen)?.path
}
if let first = urls.first(where: { !$0.isEmpty }) {
  print(first)
}
`

const screenCaptureKitWindowVideoScript = `
import Foundation
import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreGraphics
import Dispatch

_ = NSApplication.shared

@available(macOS 15.0, *)
final class RecordingDelegate: NSObject, SCRecordingOutputDelegate, SCStreamDelegate {
  let started = DispatchSemaphore(value: 0)
  let finished = DispatchSemaphore(value: 0)
  var error: (any Error)?

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    started.signal()
  }

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    finished.signal()
  }

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: any Error) {
    self.error = error
    started.signal()
    finished.signal()
  }

  func stream(_ stream: SCStream, didStopWithError error: any Error) {
    self.error = error
    started.signal()
    finished.signal()
  }
}

@available(macOS 15.0, *)
func start(_ stream: SCStream) async throws {
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
    stream.startCapture { error in
      if let error {
        continuation.resume(throwing: error)
      } else {
        continuation.resume()
      }
    }
  }
}

@available(macOS 15.0, *)
func stop(_ stream: SCStream) async throws {
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
    stream.stopCapture { error in
      if let error {
        continuation.resume(throwing: error)
      } else {
        continuation.resume()
      }
    }
  }
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 4 else {
  throw NSError(
    domain: "OneWorksScreenCaptureKit",
    code: 64,
    userInfo: [NSLocalizedDescriptionKey: "Expected window id, duration seconds, output path and fps."]
  )
}

if #available(macOS 15.0, *) {
  guard let rawWindowId = UInt32(args[0]) else {
    throw NSError(
      domain: "OneWorksScreenCaptureKit",
      code: 65,
      userInfo: [NSLocalizedDescriptionKey: "Invalid window id."]
    )
  }
  guard let seconds = Double(args[1]) else {
    throw NSError(
      domain: "OneWorksScreenCaptureKit",
      code: 66,
      userInfo: [NSLocalizedDescriptionKey: "Invalid duration seconds."]
    )
  }
  let outputPath = args[2]
  guard let fpsValue = Int32(args[3]), fpsValue > 0 else {
    throw NSError(
      domain: "OneWorksScreenCaptureKit",
      code: 67,
      userInfo: [NSLocalizedDescriptionKey: "Invalid fps."]
    )
  }
  let matte = args.count > 4 ? args[4] : "light"

  let windowId = CGWindowID(rawWindowId)
  let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  guard let window = content.windows.first(where: { $0.windowID == windowId }) else {
    throw NSError(
      domain: "OneWorksScreenCaptureKit",
      code: 68,
      userInfo: [NSLocalizedDescriptionKey: "Window not found for ScreenCaptureKit recording."]
    )
  }

  let filter = SCContentFilter(desktopIndependentWindow: window)
  let info = SCShareableContent.info(for: filter)
  let configuration = SCStreamConfiguration()
  configuration.width = max(2, Int(round(info.contentRect.width * CGFloat(info.pointPixelScale))))
  configuration.height = max(2, Int(round(info.contentRect.height * CGFloat(info.pointPixelScale))))
  configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fpsValue))
  configuration.pixelFormat = kCVPixelFormatType_32BGRA
  configuration.showsCursor = false
  configuration.showMouseClicks = false
  configuration.capturesAudio = false
  let backgroundColor: CGColor
  if matte == "dark" {
    backgroundColor = CGColor(red: 0.06, green: 0.06, blue: 0.06, alpha: 1)
  } else {
    backgroundColor = CGColor(red: 0.92, green: 0.92, blue: 0.92, alpha: 1)
  }
  configuration.backgroundColor = backgroundColor

  let delegate = RecordingDelegate()
  let stream = SCStream(filter: filter, configuration: configuration, delegate: delegate)
  let outputConfiguration = SCRecordingOutputConfiguration()
  outputConfiguration.outputURL = URL(fileURLWithPath: outputPath)
  outputConfiguration.outputFileType = .mov
  outputConfiguration.videoCodecType = .h264
  let output = SCRecordingOutput(configuration: outputConfiguration, delegate: delegate)
  try stream.addRecordingOutput(output)

  try await start(stream)
  if delegate.started.wait(timeout: .now() + 5) == .timedOut {
    throw NSError(
      domain: "OneWorksScreenCaptureKit",
      code: 69,
      userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for ScreenCaptureKit recording to start."]
    )
  }
  if let error = delegate.error {
    throw error
  }

  try await Task.sleep(nanoseconds: UInt64(max(0.05, seconds) * 1_000_000_000))
  try await stop(stream)
  if delegate.finished.wait(timeout: .now() + 10) == .timedOut {
    throw NSError(
      domain: "OneWorksScreenCaptureKit",
      code: 70,
      userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for ScreenCaptureKit recording to finish."]
    )
  }
  if let error = delegate.error {
    throw error
  }

  let data = try JSONSerialization.data(withJSONObject: [
    "height": configuration.height,
    "width": configuration.width
  ])
  print(String(data: data, encoding: .utf8)!)
} else {
  throw NSError(
    domain: "OneWorksScreenCaptureKit",
    code: 71,
    userInfo: [NSLocalizedDescriptionKey: "ScreenCaptureKit recording requires macOS 15 or later."]
  )
}
`

const modifierKeyDefinitions: Record<string, ModifierKeyDefinition> = {
  alt: {
    code: 'AltLeft',
    display: 'Alt',
    key: 'Alt',
    modifierBit: 1,
    windowsVirtualKeyCode: 18
  },
  control: {
    code: 'ControlLeft',
    display: 'Ctrl',
    key: 'Control',
    modifierBit: 2,
    windowsVirtualKeyCode: 17
  },
  meta: {
    code: 'MetaLeft',
    display: '⌘',
    key: 'Meta',
    modifierBit: 4,
    windowsVirtualKeyCode: 91
  },
  shift: {
    code: 'ShiftLeft',
    display: 'Shift',
    key: 'Shift',
    modifierBit: 8,
    windowsVirtualKeyCode: 16
  }
}

const modifierAliases: Record<string, keyof typeof modifierKeyDefinitions> = {
  alt: 'alt',
  cmd: 'meta',
  command: 'meta',
  control: 'control',
  ctrl: 'control',
  meta: 'meta',
  option: 'alt',
  shift: 'shift'
}

const specialKeyDefinitions: Record<string, KeyDefinition> = {
  arrowdown: {
    code: 'ArrowDown',
    display: '↓',
    key: 'ArrowDown',
    windowsVirtualKeyCode: 40
  },
  arrowleft: {
    code: 'ArrowLeft',
    display: '←',
    key: 'ArrowLeft',
    windowsVirtualKeyCode: 37
  },
  arrowright: {
    code: 'ArrowRight',
    display: '→',
    key: 'ArrowRight',
    windowsVirtualKeyCode: 39
  },
  arrowup: {
    code: 'ArrowUp',
    display: '↑',
    key: 'ArrowUp',
    windowsVirtualKeyCode: 38
  },
  backspace: {
    code: 'Backspace',
    display: 'Backspace',
    key: 'Backspace',
    windowsVirtualKeyCode: 8
  },
  delete: {
    code: 'Delete',
    display: 'Delete',
    key: 'Delete',
    windowsVirtualKeyCode: 46
  },
  enter: {
    code: 'Enter',
    display: 'Enter',
    key: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13
  },
  escape: {
    code: 'Escape',
    display: 'Esc',
    key: 'Escape',
    windowsVirtualKeyCode: 27
  },
  space: {
    code: 'Space',
    display: 'Space',
    key: ' ',
    text: ' ',
    windowsVirtualKeyCode: 32
  },
  tab: {
    code: 'Tab',
    display: 'Tab',
    key: 'Tab',
    windowsVirtualKeyCode: 9
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim() !== ''
)

const parsePngDimensions = (buffer: Buffer): DemoVideoViewport | undefined => {
  if (buffer.byteLength < 24) return undefined
  const signature = buffer.subarray(0, 8)
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return undefined
  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16)
  }
}

const expandViewport = (
  current: DemoVideoViewport | undefined,
  next: DemoVideoViewport | undefined
): DemoVideoViewport | undefined => {
  if (next == null) return current
  if (current == null) return next
  return {
    height: Math.max(current.height, next.height),
    width: Math.max(current.width, next.width)
  }
}

const toEvenDimension = (value: number) => Math.ceil(value / 2) * 2

const addSystemWindowVideoCanvasPadding = (contentSize: DemoVideoViewport): DemoVideoViewport => {
  const paddingX = Math.max(
    MIN_SYSTEM_WINDOW_VIDEO_PADDING_X,
    Math.round(contentSize.width * DEFAULT_SYSTEM_WINDOW_VIDEO_PADDING_RATIO)
  )
  const paddingY = Math.max(
    MIN_SYSTEM_WINDOW_VIDEO_PADDING_Y,
    Math.round(contentSize.height * DEFAULT_SYSTEM_WINDOW_VIDEO_PADDING_RATIO)
  )
  return {
    height: toEvenDimension(contentSize.height + paddingY * 2),
    width: toEvenDimension(contentSize.width + paddingX * 2)
  }
}

const resolveSystemWindowVideoCornerRadius = (contentSize: DemoVideoViewport) => (
  Math.max(
    2,
    Math.min(DEFAULT_SYSTEM_WINDOW_VIDEO_CORNER_RADIUS, Math.floor(Math.min(contentSize.width, contentSize.height) / 6))
  )
)

const buildRoundedWindowAlphaExpression = (radius: number) => {
  const roundedRadius = Math.max(2, Math.round(radius))
  return `clip(255*(${roundedRadius}+0.5-sqrt(pow(max(abs(X-W/2)-(W/2-${roundedRadius}),0),2)+pow(max(abs(Y-H/2)-(H/2-${roundedRadius}),0),2))),0,255)`
}

const sleep = async (ms: number) =>
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const sanitizeFileSegment = (value: string) => {
  const sanitized = value.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return sanitized === '' ? 'demo-video' : sanitized
}

const normalizeVideoBackgroundColor = (value: string | undefined) => {
  if (value == null) return undefined
  const match = /^(?:#|0x)?([0-9a-fA-F]{6})$/u.exec(value.trim())
  if (match == null) {
    throw new Error('videoBackgroundColor must be a 6-digit hex color, for example #323232.')
  }
  return `0x${match[1]!.toUpperCase()}`
}

const normalizeDemoVideoLanguage = (value: string | undefined) => {
  const normalized = value?.trim().replaceAll('_', '-')
  if (normalized == null || normalized === '') return undefined
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u.test(normalized)) {
    throw new Error(`Unsupported demo video language: ${value}`)
  }
  return normalized
}

const normalizeDemoVideoPageBackground = (value: DemoVideoPageBackground | undefined) => {
  if (value == null) return DEFAULT_PAGE_BACKGROUND
  if (value === 'app' || value === 'macos-wallpaper') return value
  throw new Error(`Unsupported demo video page background: ${String(value)}`)
}

const normalizeSystemWindowCaptureBackend = (value: DemoVideoSystemWindowCaptureBackend | undefined) => {
  if (value == null) return DEFAULT_SYSTEM_WINDOW_CAPTURE_BACKEND
  if (value === 'video' || value === 'frames') return value
  throw new Error(`Unsupported system-window capture backend: ${String(value)}`)
}

const normalizeKeyToken = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '')

const createPrintableKeyDefinition = (value: string): KeyDefinition => {
  if (/^[a-z]$/i.test(value)) {
    const upper = value.toUpperCase()
    const lower = value.toLowerCase()
    return {
      code: `Key${upper}`,
      display: upper,
      key: lower,
      text: lower,
      windowsVirtualKeyCode: upper.charCodeAt(0)
    }
  }

  if (/^\d$/.test(value)) {
    return {
      code: `Digit${value}`,
      display: value,
      key: value,
      text: value,
      windowsVirtualKeyCode: value.charCodeAt(0)
    }
  }

  if (value.length === 1) {
    return {
      code: value,
      display: value,
      key: value,
      text: value,
      windowsVirtualKeyCode: value.toUpperCase().charCodeAt(0)
    }
  }

  throw new Error(`Unsupported demo video key: ${value}`)
}

const parseKeyDefinition = (value: string): KeyDefinition => {
  const normalized = normalizeKeyToken(value)
  return specialKeyDefinitions[normalized] ?? createPrintableKeyDefinition(value)
}

const parseKeyCombo = (value: string): ParsedKeyCombo => {
  const parts = value.split('+').map(part => part.trim()).filter(part => part !== '')
  if (parts.length === 0) throw new Error('A key value is required.')

  const keyPart = parts.at(-1)
  if (keyPart == null) throw new Error('A key value is required.')
  const modifiers = parts.slice(0, -1).map((part) => {
    const alias = modifierAliases[normalizeKeyToken(part)]
    if (alias == null) throw new Error(`Unsupported demo video modifier key: ${part}`)
    return modifierKeyDefinitions[alias]
  })
  const key = parseKeyDefinition(keyPart)

  return {
    displayLabels: modifiers.map(modifier => modifier.display).concat(key.display),
    key,
    modifiers
  }
}

const formatTypedText = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized === '') return 'empty text'
  return normalized.length <= 24 ? `"${normalized}"` : `"${normalized.slice(0, 21)}..."`
}

const resolveOutputPaths = (input: {
  name?: string
  outDir?: string
  scenarioId: string
}) => {
  const outputName = sanitizeFileSegment(input.name ?? input.scenarioId)
  const outDir = path.resolve(process.cwd(), input.outDir ?? path.join(DEFAULT_OUTPUT_ROOT, input.scenarioId))
  return {
    cursorContinuityPath: path.join(outDir, `${outputName}-cursor-continuity.json`),
    cursorTimelinePath: path.join(outDir, `${outputName}-cursor-timeline.json`),
    framesDir: path.join(outDir, 'frames'),
    outDir,
    posterPath: path.join(outDir, `${outputName}-poster.png`),
    segmentsDir: path.join(outDir, 'segments'),
    stillsDir: path.join(outDir, 'stills'),
    stillsManifestPath: path.join(outDir, `${outputName}-stills.json`),
    videoPath: path.join(outDir, `${outputName}.mp4`)
  }
}

const frameFileName = (index: number) => `frame_${String(index).padStart(5, '0')}.png`
const stillFileName = (index: number) => `second_${String(index).padStart(4, '0')}.png`

const commandExists = async (command: string) =>
  await new Promise<string | undefined>((resolve) => {
    const child = spawn('which', [command], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.once('error', () => resolve(undefined))
    child.once('close', code => {
      if (code !== 0) {
        resolve(undefined)
        return
      }
      const resolved = Buffer.concat(chunks).toString('utf8').trim()
      resolve(resolved === '' ? undefined : resolved)
    })
  })

const canExecute = async (filePath: string) => {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const isPathLikeCommand = (value: string) => (
  value.includes(path.sep) || value.startsWith('.')
)

const resolveCommandPath = async (value: string) => {
  if (isPathLikeCommand(value) || path.isAbsolute(value)) {
    return await canExecute(value) ? value : undefined
  }
  return await commandExists(value)
}

const resolveFfmpegPath = async (explicitPath?: string) => {
  const explicitCandidates = [explicitPath, process.env.FFMPEG_PATH, process.env.FFMPEG]
  for (const candidate of explicitCandidates) {
    if (!isNonEmptyString(candidate)) continue
    const resolved = await resolveCommandPath(candidate)
    if (resolved != null) return resolved
    if (candidate !== 'ffmpeg') {
      throw new Error(`ffmpeg executable is not available or not executable: ${candidate}`)
    }
  }

  const fileCandidates = process.platform === 'darwin'
    ? [
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/Applications/Screen Studio.app/Contents/Resources/app.asar.unpacked/bin/ffmpeg-darwin-arm64'
    ]
    : []
  for (const candidate of fileCandidates) {
    if (await canExecute(candidate)) return candidate
  }

  throw new Error('Unable to find ffmpeg. Install ffmpeg, set FFMPEG_PATH, or pass --ffmpeg-path.')
}

const resolveChromePath = async (explicitPath?: string) => {
  if (isNonEmptyString(explicitPath)) {
    if (await canExecute(explicitPath)) return explicitPath
    throw new Error(`Chrome executable is not available or not executable: ${explicitPath}`)
  }

  const envPath = process.env.CHROME_PATH ?? process.env.GOOGLE_CHROME_SHIM
  if (isNonEmptyString(envPath) && await canExecute(envPath)) return envPath

  const fileCandidates = process.platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(process.env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ]
    : []
  for (const candidate of fileCandidates) {
    if (candidate !== '' && await canExecute(candidate)) return candidate
  }

  const commandCandidates = process.platform === 'win32'
    ? ['chrome', 'chrome.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  for (const candidate of commandCandidates) {
    const commandPath = await commandExists(candidate)
    if (commandPath != null) return commandPath
  }

  throw new Error('Unable to find Chrome. Set CHROME_PATH or pass --chrome-path.')
}

const getFreePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address == null || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a local port.')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`)
  }
  return await response.json() as unknown
}

const parseChromeTargets = (value: unknown): ChromeDebugTarget[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const type = item.type
    const url = item.url
    const webSocketDebuggerUrl = item.webSocketDebuggerUrl
    if (!isNonEmptyString(type) || !isNonEmptyString(url)) return []
    return [{
      type,
      url,
      webSocketDebuggerUrl: isNonEmptyString(webSocketDebuggerUrl) ? webSocketDebuggerUrl : undefined
    }]
  })
}

const waitForChrome = async (input: {
  port: number
  stderrChunks: Buffer[]
  timeoutMs: number
}) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < input.timeoutMs) {
    try {
      const targets = parseChromeTargets(await fetchJson(`http://127.0.0.1:${input.port}/json/list`))
      const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl != null)
      if (page?.webSocketDebuggerUrl != null) return page.webSocketDebuggerUrl
    } catch {
    }
    await sleep(100)
  }

  const stderr = Buffer.concat(input.stderrChunks).toString('utf8').trim()
  throw new Error(
    [
      `Timed out waiting for Chrome DevTools on port ${input.port}.`,
      stderr === '' ? undefined : `Chrome stderr:\n${stderr}`
    ].filter(Boolean).join('\n')
  )
}

const resolveCdpTargetListUrl = (webSocketDebuggerUrl: string | undefined) => {
  if (webSocketDebuggerUrl == null) return undefined
  try {
    const url = new URL(webSocketDebuggerUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    url.pathname = '/json/list'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

const isFollowableCdpPageTarget = (target: ChromeDebugTarget) => (
  target.type === 'page' &&
  target.webSocketDebuggerUrl != null &&
  /^https?:\/\//u.test(target.url) &&
  !target.url.includes('/ui/launcher')
)

const launchChrome = async (input: {
  chromePath?: string
  headless: boolean
  language?: string
  viewport: DemoVideoViewport
}): Promise<ChromeLaunch & { webSocketDebuggerUrl: string }> => {
  const chromePath = await resolveChromePath(input.chromePath)
  const port = await getFreePort()
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'oneworks-demo-video-chrome-'))
  const stderrChunks: Buffer[] = []
  const child = spawn(chromePath, [
    ...(input.headless ? ['--headless=new'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-sandbox',
    '--allow-insecure-localhost',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${input.viewport.width},${input.viewport.height}`,
    ...(input.language == null ? [] : [`--lang=${input.language}`]),
    'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe']
  })

  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const close = async () => {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM')
      await Promise.race([
        new Promise<void>(resolve => child.once('close', () => resolve())),
        sleep(3_000).then(() => {
          if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
        })
      ])
    }
    await rm(userDataDir, { force: true, recursive: true })
  }

  try {
    const webSocketDebuggerUrl = await Promise.race([
      waitForChrome({
        port,
        stderrChunks,
        timeoutMs: DEFAULT_CHROME_TIMEOUT_MS
      }),
      new Promise<never>((_resolve, reject) => {
        child.once('error', reject)
      })
    ])
    return {
      close,
      port,
      webSocketDebuggerUrl
    }
  } catch (error) {
    await close()
    throw error
  }
}

const stringifyWebSocketMessage = (value: string | ArrayBuffer | Blob | ArrayBufferView) => {
  if (typeof value === 'string') return value
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8')
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8')
  throw new TypeError('Unsupported WebSocket payload type')
}

const createCdpClient = async (webSocketDebuggerUrl: string) => {
  const socket = new WebSocket(webSocketDebuggerUrl)
  let nextId = 0
  let isClosed = false
  const pending = new Map<number, CdpPendingRequest>()

  const rejectPending = (message: string) => {
    for (const request of pending.values()) {
      request.reject(new Error(message))
    }
    pending.clear()
  }

  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      socket.removeEventListener('error', handleError)
      resolve()
    }
    const handleError = () => {
      socket.removeEventListener('open', handleOpen)
      reject(new Error(`Failed to connect to Chrome DevTools: ${webSocketDebuggerUrl}`))
    }

    socket.addEventListener('open', handleOpen, { once: true })
    socket.addEventListener('error', handleError, { once: true })
  })

  socket.addEventListener('message', (event) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(stringifyWebSocketMessage(event.data))
    } catch (error) {
      rejectPending(error instanceof Error ? error.message : String(error))
      return
    }

    if (!isRecord(parsed) || typeof parsed.id !== 'number') return
    const request = pending.get(parsed.id)
    if (request == null) return
    pending.delete(parsed.id)

    if (isRecord(parsed.error)) {
      const errorInfo = parsed.error as CdpProtocolError
      request.reject(
        new Error(`Chrome DevTools error ${errorInfo.code ?? 'unknown'}: ${errorInfo.message ?? 'unknown error'}`)
      )
      return
    }

    request.resolve(parsed.result)
  })

  socket.addEventListener('close', () => {
    isClosed = true
    rejectPending('Chrome DevTools connection closed unexpectedly.')
  })

  return {
    close() {
      if (isClosed) return
      isClosed = true
      socket.close()
      rejectPending('Chrome DevTools connection closed.')
    },
    async send<TResult>(method: string, params?: Record<string, unknown>) {
      if (isClosed) throw new Error('Chrome DevTools connection is already closed.')
      const id = ++nextId
      const resultPromise = new Promise<TResult>((resolve, reject) => {
        pending.set(id, {
          reject,
          resolve: value => resolve(value as TResult | PromiseLike<TResult>)
        })
      })
      socket.send(JSON.stringify({
        id,
        method,
        params: params ?? {}
      }))
      return await resultPromise
    }
  }
}

type CdpClient = Awaited<ReturnType<typeof createCdpClient>>

const runCommand = async (input: {
  args: string[]
  command: string
  cwd: string
  timeoutMs: number
}) => {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let timedOut = false

  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, input.timeoutMs)

  return await new Promise<{
    code: number
    stderr: string
    stdout: string
    timedOut: boolean
  }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      clearTimeout(timeout)
      resolve({
        code: code ?? (timedOut ? -1 : 0),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        timedOut
      })
    })
  })
}

const assertFfmpegUsable = async (ffmpegPath: string) => {
  const result = await runCommand({
    args: ['-hide_banner', '-version'],
    command: ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 10_000
  })
  if (result.code === 0) return
  throw new Error(
    [
      `ffmpeg executable is not usable: ${ffmpegPath}`,
      `exitCode=${result.code}`,
      result.timedOut ? 'timedOut=true' : undefined,
      result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
      result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
    ].filter(Boolean).join('\n')
  )
}

const canReadFile = async (filePath: string) => {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

const resolveReadableFile = async (filePath: string) => {
  const resolvedPath = path.resolve(process.cwd(), filePath)
  if (await canReadFile(resolvedPath)) return resolvedPath
  if (path.isAbsolute(filePath) && await canReadFile(filePath)) return filePath
  throw new Error(`Demo video background image is not readable: ${filePath}`)
}

const resolveMacosWallpaperPath = async () => {
  const currentWallpaperPath = await resolveCurrentMacosWallpaperPath()
  if (currentWallpaperPath != null) return currentWallpaperPath

  for (const candidate of MACOS_WALLPAPER_CANDIDATES) {
    if (await canReadFile(candidate)) return candidate
  }
  throw new Error('No readable macOS wallpaper was found from the current desktop or /System/Library/Desktop Pictures.')
}

const imageMimeTypeForPath = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  return undefined
}

const readImageAsDataUrl = async (filePath: string) => {
  const mimeType = imageMimeTypeForPath(filePath)
  if (mimeType == null) {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'oneworks-demo-video-background-'))
    const convertedPath = path.join(tmpDir, 'background.jpg')
    try {
      const result = await runCommand({
        args: ['-Z', '2560', '-s', 'format', 'jpeg', '-s', 'formatOptions', '85', filePath, '--out', convertedPath],
        command: 'sips',
        cwd: process.cwd(),
        timeoutMs: 60_000
      })
      if (result.code !== 0) {
        throw new Error(
          [
            `sips failed to convert demo video background image with exit code ${result.code}.`,
            result.timedOut ? 'timedOut=true' : undefined,
            result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
            result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
          ].filter(Boolean).join('\n')
        )
      }
      const convertedBuffer = await readFile(convertedPath)
      return `data:image/jpeg;base64,${convertedBuffer.toString('base64')}`
    } finally {
      await rm(tmpDir, { force: true, recursive: true })
    }
  }

  const buffer = await readFile(filePath)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

const prepareVideoBackgroundImage = async (input: {
  imagePath: string
  workDir: string
}) => {
  const resolvedPath = await resolveReadableFile(input.imagePath)
  if (imageMimeTypeForPath(resolvedPath) != null) return resolvedPath

  await mkdir(input.workDir, { recursive: true })
  const convertedPath = path.join(input.workDir, 'video-background.jpg')
  const result = await runCommand({
    args: ['-Z', '3840', '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', resolvedPath, '--out', convertedPath],
    command: 'sips',
    cwd: process.cwd(),
    timeoutMs: 60_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `sips failed to convert system-window video background with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
  return convertedPath
}

const resolvePageBackgroundDataUrl = async (input: {
  pageBackground: DemoVideoPageBackground
  pageBackgroundImage?: string
}) => {
  if (input.pageBackground === 'app' && input.pageBackgroundImage == null) return undefined
  const imagePath = input.pageBackgroundImage == null
    ? await resolveMacosWallpaperPath()
    : await resolveReadableFile(input.pageBackgroundImage)
  return await readImageAsDataUrl(imagePath)
}

const resolveCurrentMacosWallpaperPath = async () => {
  if (process.platform !== 'darwin') return undefined
  const result = await runCommand({
    args: ['-e', currentMacosWallpaperScript],
    command: 'swift',
    cwd: process.cwd(),
    timeoutMs: 10_000
  }).catch(() => undefined)
  const resolvedPath = result?.code === 0 ? result.stdout.trim().split(/\r?\n/u).find(isNonEmptyString) : undefined
  if (resolvedPath != null && await canReadFile(resolvedPath)) return resolvedPath
  return undefined
}

const parseMacWindowList = (value: unknown): MacWindowInfo[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = item.id
    const ownerPid = item.ownerPid
    const ownerName = item.ownerName
    const title = item.title
    const x = item.x
    const y = item.y
    const width = item.width
    const height = item.height
    if (
      typeof id !== 'number' ||
      typeof ownerPid !== 'number' ||
      typeof ownerName !== 'string' ||
      typeof title !== 'string' ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number'
    ) return []
    return [{
      height,
      id,
      ownerName,
      ownerPid,
      title,
      width,
      x,
      y
    }]
  })
}

const listMacWindowsByOwnerPid = async (ownerPid: number) => {
  if (process.platform !== 'darwin') {
    throw new Error('system-window demo video capture is only supported on macOS.')
  }
  const result = await runCommand({
    args: ['-e', macWindowListScript, String(ownerPid)],
    command: 'swift',
    cwd: process.cwd(),
    timeoutMs: 15_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `Failed to list macOS windows for pid ${ownerPid}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
  return parseMacWindowList(JSON.parse(result.stdout) as unknown)
}

const resolveSystemWindowId = async (input: {
  ownerPid?: number
  windowId?: number
}) => {
  if (input.windowId != null) return input.windowId
  if (input.ownerPid == null) {
    throw new Error('system-window demo video capture requires systemWindowId or systemWindowOwnerPid.')
  }
  const windows = await listMacWindowsByOwnerPid(input.ownerPid)
  const window = windows[0]
  if (window == null) {
    throw new Error(`No visible macOS window was found for pid ${input.ownerPid}.`)
  }
  return window.id
}

const findPointByTextExpression = (input: {
  exact: boolean
  text: string
}) => `
(() => {
  const targetText = ${JSON.stringify(input.text)};
  const exact = ${JSON.stringify(input.exact)};
  const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const scoreElement = (element, rect) => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') ?? '';
    const interactive = tag === 'button' || tag === 'a' || role === 'button' || role === 'tab' ? 0 : 1000000;
    return interactive + rect.width * rect.height;
  };
  const candidates = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], input, textarea, select, th, td, span, div, label')]
    .flatMap((element) => {
      if (!isVisible(element)) return [];
      const text = normalize(element.innerText || element.textContent);
      if (text === '') return [];
      const matched = exact ? text === targetText : text.includes(targetText);
      if (!matched) return [];
      const rect = element.getBoundingClientRect();
      return [{
        element,
        score: scoreElement(element, rect),
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      }];
    })
    .sort((a, b) => a.score - b.score);
  const target = candidates[0];
  if (target == null) return null;
  const isInViewport = (rect) => (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
  if (!isInViewport(target.element.getBoundingClientRect())) {
    target.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const rect = target.element.getBoundingClientRect();
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
})()
`

const findPointBySelectorExpression = (selector: string) => `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof Element)) return null;
  const initialRect = element.getBoundingClientRect();
  const isInViewport = (
    initialRect.bottom > 0 &&
    initialRect.right > 0 &&
    initialRect.top < window.innerHeight &&
    initialRect.left < window.innerWidth
  );
  if (!isInViewport) {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
})()
`

const hasSelectorExpression = (selector: string) => `
(() => document.querySelector(${JSON.stringify(selector)}) instanceof Element)()
`

const focusSelectorExpression = (selector: string) => `
(() => {
  const root = document.querySelector(${JSON.stringify(selector)});
  if (!(root instanceof Element)) return false;
  const focusTarget = root.matches('textarea, input, [contenteditable="true"]')
    ? root
    : root.querySelector('textarea, input, [contenteditable="true"]');
  if (!(focusTarget instanceof HTMLElement)) return false;
  focusTarget.focus({ preventScroll: true });
  return document.activeElement === focusTarget || root.contains(document.activeElement);
})()
`

const selectTextInSelectorExpression = (selector: string) => `
(() => {
  const root = document.querySelector(${JSON.stringify(selector)});
  if (!(root instanceof Element)) return false;
  const focusTarget = root.matches('textarea, input, [contenteditable="true"]')
    ? root
    : root.querySelector('textarea, input, [contenteditable="true"]');
  if (!(focusTarget instanceof HTMLElement)) return false;
  focusTarget.focus({ preventScroll: true });
  if (
    focusTarget instanceof HTMLInputElement ||
    focusTarget instanceof HTMLTextAreaElement
  ) {
    focusTarget.select();
    return true;
  }
  if (focusTarget.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(focusTarget);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  return false;
})()
`

const installOverlayExpression = `
(() => {
  const cursorId = '__oneworks_demo_video_cursor';
  const cursorStyleId = '__oneworks_demo_video_cursor_style';
  const keyboardId = '__oneworks_demo_video_keyboard';
  let cursorStyle = document.getElementById(cursorStyleId);
  if (cursorStyle == null) {
    cursorStyle = document.createElement('style');
    cursorStyle.id = cursorStyleId;
    cursorStyle.textContent = \`
      @keyframes oneworks-demo-cursor-idle {
        0%, 100% {
          transform: translate3d(0, 0, 0) rotate(-.9deg);
        }
        50% {
          transform: translate3d(1.4px, .8px, 0) rotate(.8deg);
        }
      }

      @keyframes oneworks-demo-cursor-click {
        0% {
          transform: scale(1) rotate(-.4deg);
        }
        45% {
          transform: scale(.93) translate3d(.8px, .8px, 0) rotate(-1.2deg);
        }
        100% {
          transform: scale(${SYSTEM_CURSOR_PRESS_SCALE}) translate3d(1.1px, 1.1px, 0) rotate(-1.6deg);
        }
      }

      @keyframes oneworks-demo-cursor-release {
        0% {
          transform: scale(${SYSTEM_CURSOR_PRESS_SCALE}) translate3d(1.1px, 1.1px, 0) rotate(-1.6deg);
        }
        55% {
          transform: scale(1.07) translate3d(-.7px, -.8px, 0) rotate(.9deg);
        }
        100% {
          transform: scale(1) rotate(0deg);
        }
      }

      #__oneworks_demo_video_cursor .oneworks-demo-video-cursor-idle {
        display: block;
        width: 54px;
        height: 68px;
        animation: oneworks-demo-cursor-idle 2.8s ease-in-out infinite;
        transform-origin: 7px 6px;
        will-change: transform;
      }

      #__oneworks_demo_video_cursor .oneworks-demo-video-cursor-graphic {
        display: block;
        width: 54px;
        height: 68px;
        filter:
          drop-shadow(0 8px 12px rgba(25, 34, 52, .22))
          drop-shadow(0 2px 2px rgba(13, 18, 28, .20));
        transform-origin: 7px 6px;
        transition: transform 140ms ease, filter 140ms ease;
      }

      #__oneworks_demo_video_cursor[data-action="move"] .oneworks-demo-video-cursor-idle,
      #__oneworks_demo_video_cursor[data-action="click"] .oneworks-demo-video-cursor-idle,
      #__oneworks_demo_video_cursor[data-action="release"] .oneworks-demo-video-cursor-idle {
        animation-play-state: paused;
      }

      #__oneworks_demo_video_cursor[data-action="move"] .oneworks-demo-video-cursor-graphic {
        filter:
          drop-shadow(0 8px 13px rgba(25, 34, 52, .20))
          drop-shadow(0 2px 2px rgba(13, 18, 28, .18));
        transform: rotate(-.7deg) scale(1.01);
      }

      #__oneworks_demo_video_cursor[data-action="click"] .oneworks-demo-video-cursor-graphic {
        filter:
          drop-shadow(0 5px 8px rgba(25, 34, 52, .22))
          drop-shadow(0 1px 2px rgba(13, 18, 28, .20));
        animation: oneworks-demo-cursor-click ${SYSTEM_CURSOR_CLICK_DURATION_MS}ms cubic-bezier(.2, .82, .28, 1) both;
      }

      #__oneworks_demo_video_cursor[data-action="release"] .oneworks-demo-video-cursor-graphic {
        filter:
          drop-shadow(0 7px 11px rgba(25, 34, 52, .20))
          drop-shadow(0 2px 2px rgba(13, 18, 28, .18));
        animation: oneworks-demo-cursor-release ${SYSTEM_CURSOR_RELEASE_DURATION_MS}ms cubic-bezier(.18, .78, .26, 1) both;
      }
    \`;
    document.documentElement.appendChild(cursorStyle);
  }
  let cursor = document.getElementById(cursorId);
  if (cursor == null) {
    cursor = document.createElement('div');
    cursor.id = cursorId;
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.position = 'fixed';
    cursor.style.zIndex = '2147483647';
    cursor.style.left = String(Math.round(window.innerWidth / 2)) + 'px';
    cursor.style.top = String(Math.round(window.innerHeight / 2)) + 'px';
    cursor.style.width = '54px';
    cursor.style.height = '68px';
    cursor.style.pointerEvents = 'none';
    cursor.style.transform = 'translate(-7px, -6px)';
    cursor.style.transition = 'opacity 140ms ease';
    cursor.style.opacity = '1';
    cursor.style.willChange = 'left, top, opacity';
    cursor.dataset.action = 'idle';
    cursor.innerHTML = \`
      <span class="oneworks-demo-video-cursor-idle">
        <svg class="oneworks-demo-video-cursor-graphic" viewBox="0 0 272 344" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M48 40C38 31 30 37 30 52L30 284C30 306 43 313 56 295L99 241C107 231 117 226 130 224L222 204C246 199 251 183 231 168L48 40Z" fill="#428DF4" stroke="rgba(14, 19, 29, .14)" stroke-width="16" stroke-linejoin="round"/>
          <path d="M48 40C38 31 30 37 30 52L30 284C30 306 43 313 56 295L99 241C107 231 117 226 130 224L222 204C246 199 251 183 231 168L48 40Z" fill="#428DF4" stroke="rgba(255, 255, 255, .96)" stroke-width="10" stroke-linejoin="round"/>
        </svg>
      </span>
    \`;
    document.documentElement.appendChild(cursor);
  }
  const cursorState = window.__oneworksDemoVideoCursorState ?? {
    animationFrame: 0,
    sequence: 0,
    x: Number.parseFloat(cursor.style.left) || Math.round(window.innerWidth / 2),
    y: Number.parseFloat(cursor.style.top) || Math.round(window.innerHeight / 2)
  };
  window.__oneworksDemoVideoCursorState = cursorState;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const setCursorPosition = (x, y) => {
    cursorState.x = x;
    cursorState.y = y;
    cursor.style.left = x.toFixed(3) + 'px';
    cursor.style.top = y.toFixed(3) + 'px';
  };
  const smootherStep = (value) => {
    const progress = clamp(value, 0, 1);
    return progress * progress * progress * (progress * (progress * 6 - 15) + 10);
  };
  const startMoveCursor = (x, y, visible = true, options = {}) => {
    const fromX = Number.isFinite(cursorState.x) ? cursorState.x : x;
    const fromY = Number.isFinite(cursorState.y) ? cursorState.y : y;
    const dx = x - fromX;
    const dy = y - fromY;
    const distance = Math.hypot(dx, dy);
    const durationMs = options.durationMs ?? clamp(
      ${SYSTEM_CURSOR_MOVE_BASE_MS} + distance * ${SYSTEM_CURSOR_MOVE_DISTANCE_MS_PER_PX},
      ${SYSTEM_CURSOR_MOVE_MIN_MS},
      ${SYSTEM_CURSOR_MOVE_MAX_MS}
    );
    const sequence = cursorState.sequence + 1;
    cursorState.sequence = sequence;
    if (cursorState.animationFrame) cancelAnimationFrame(cursorState.animationFrame);
    cursor.style.opacity = visible ? '1' : '0';
    cursor.dataset.action = distance < 4 ? 'idle' : 'move';
    const startedAt = performance.now();
    const perpendicularX = distance > 0 ? -dy / distance : 0;
    const perpendicularY = distance > 0 ? dx / distance : 0;
    const curveSign = (Math.round(fromX + fromY + x + y) % 2 === 0) ? 1 : -1;
    const curve = clamp(distance * .16, 14, 72) * curveSign;
    const step = (now) => {
      if (cursorState.sequence !== sequence) return;
      const progress = clamp((now - startedAt) / durationMs, 0, 1);
      const eased = smootherStep(progress);
      const arc = Math.sin(progress * Math.PI) * curve;
      const micro = Math.sin(progress * Math.PI * 3) * Math.min(2.4, Math.max(.4, distance / 260));
      setCursorPosition(
        fromX + dx * eased + perpendicularX * arc + perpendicularY * micro,
        fromY + dy * eased + perpendicularY * arc - perpendicularX * micro
      );
      if (progress < 1) {
        cursorState.animationFrame = requestAnimationFrame(step);
      } else {
        setCursorPosition(x, y);
        cursor.dataset.action = options.settleAction ?? 'idle';
      }
    };
    cursorState.animationFrame = requestAnimationFrame(step);
    return durationMs;
  };
  const playCursorAction = (x, y, action = 'click') => {
    cursorState.sequence += 1;
    if (cursorState.animationFrame) cancelAnimationFrame(cursorState.animationFrame);
    setCursorPosition(x, y);
    cursor.style.opacity = '1';
    cursor.dataset.action = 'idle';
    void cursor.offsetWidth;
    cursor.dataset.action = action;
    const durationMs = action === 'release'
      ? ${SYSTEM_CURSOR_RELEASE_DURATION_MS}
      : ${SYSTEM_CURSOR_CLICK_DURATION_MS};
    const sequence = cursorState.sequence;
    window.setTimeout(() => {
      if (cursorState.sequence === sequence) cursor.dataset.action = 'idle';
    }, durationMs);
    return durationMs;
  };
  let keyboard = document.getElementById(keyboardId);
  if (keyboard == null) {
    keyboard = document.createElement('div');
    keyboard.id = keyboardId;
    keyboard.setAttribute('aria-hidden', 'true');
    keyboard.style.position = 'fixed';
    keyboard.style.left = '50%';
    keyboard.style.bottom = '28px';
    keyboard.style.zIndex = '2147483647';
    keyboard.style.display = 'flex';
    keyboard.style.alignItems = 'center';
    keyboard.style.justifyContent = 'center';
    keyboard.style.gap = '8px';
    keyboard.style.maxWidth = 'calc(100vw - 48px)';
    keyboard.style.pointerEvents = 'none';
    keyboard.style.transform = 'translateX(-50%)';
    keyboard.style.transition = 'opacity 160ms ease, transform 160ms ease';
    keyboard.style.opacity = '0';
    document.documentElement.appendChild(keyboard);
  }
  const buildKey = (label) => {
    const key = document.createElement('kbd');
    key.textContent = String(label);
    key.style.display = 'inline-flex';
    key.style.alignItems = 'center';
    key.style.justifyContent = 'center';
    key.style.minWidth = '34px';
    key.style.minHeight = '28px';
    key.style.padding = '3px 10px';
    key.style.border = '1px solid rgba(255, 255, 255, 0.72)';
    key.style.borderRadius = '7px';
    key.style.background = 'rgba(15, 23, 42, 0.88)';
    key.style.boxShadow = '0 10px 24px rgba(15, 23, 42, 0.32)';
    key.style.color = '#ffffff';
    key.style.font = '700 13px/1.1 ui-sans-serif, system-ui, sans-serif';
    key.style.letterSpacing = '0';
    return key;
  };
  window.__oneworksDemoVideoSetCursor = (x, y, visible = true, action = 'idle', options = {}) => {
    if (action === 'move') return startMoveCursor(x, y, visible, options);
    if (action === 'click' || action === 'release') return playCursorAction(x, y, action);
    cursorState.sequence += 1;
    if (cursorState.animationFrame) cancelAnimationFrame(cursorState.animationFrame);
    setCursorPosition(x, y);
    cursor.style.opacity = visible ? '1' : '0';
    cursor.dataset.action = action;
    return 0;
  };
  window.__oneworksDemoVideoShowKeys = (labels) => {
    keyboard.replaceChildren(...labels.map(buildKey));
    keyboard.style.opacity = '1';
    keyboard.style.transform = 'translateX(-50%) translateY(0)';
    if (window.__oneworksDemoVideoKeyboardTimer != null) {
      clearTimeout(window.__oneworksDemoVideoKeyboardTimer);
    }
    window.__oneworksDemoVideoKeyboardTimer = setTimeout(() => {
      keyboard.style.opacity = '0';
      keyboard.style.transform = 'translateX(-50%) translateY(6px)';
    }, 1200);
  };
})()
`

const setCursorExpression = (point: Point, action: CursorAction = 'idle') => `
(() => {
  if (typeof window.__oneworksDemoVideoSetCursor === 'function') {
    return window.__oneworksDemoVideoSetCursor(
      ${JSON.stringify(point.x)},
      ${JSON.stringify(point.y)},
      true,
      ${JSON.stringify(action)}
    );
  }
  return 0;
})()
`

const showKeysExpression = (labels: string[]) => `
(() => {
  if (typeof window.__oneworksDemoVideoShowKeys === 'function') {
    window.__oneworksDemoVideoShowKeys(${JSON.stringify(labels)});
  }
})()
`

const hideRendererCursorExpression = `
(() => {
  const cursor = document.getElementById('__oneworks_demo_video_cursor');
  if (cursor != null) {
    cursor.style.opacity = '0';
    cursor.style.display = 'none';
  }
})()
`

const buildLanguageBootstrapExpression = (language: string) => `
(() => {
  const language = ${JSON.stringify(language)};
  const baseLanguage = language.split('-')[0] || language;
  const languages = baseLanguage === language ? [language] : [language, baseLanguage];
  try {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => language
    });
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      get: () => languages
    });
  } catch {}
  try {
    localStorage.setItem(${JSON.stringify(APP_LANGUAGE_OVERRIDE_STORAGE_KEY)}, language);
    localStorage.removeItem('i18nextLng');
  } catch {}
})()
`

const buildPageBackgroundExpression = (dataUrl: string) => {
  const css = `
html.oneworks-demo-video-page-background,
html.oneworks-demo-video-page-background body {
  min-height: 100%;
  background: transparent !important;
}

html.oneworks-demo-video-page-background #root,
html.oneworks-demo-video-page-background .ant-app {
  position: relative;
  z-index: 1;
  background: transparent !important;
}

html.oneworks-demo-video-page-background.oneworks-launcher-web,
html.oneworks-demo-video-page-background.oneworks-launcher-web body,
html.oneworks-demo-video-page-background.oneworks-launcher-web #root,
html.oneworks-demo-video-page-background.oneworks-launcher-web .ant-app {
  background: transparent !important;
}
`

  return `
(async () => {
  const styleId = '__oneworks_demo_video_page_background';
  const backgroundId = '__oneworks_demo_video_wallpaper_background';
  const imageUrl = ${JSON.stringify(dataUrl)};
  await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = imageUrl;
    if (image.complete) resolve(true);
    setTimeout(() => resolve(false), 5000);
  });
  let style = document.getElementById(styleId);
  if (style == null) {
    style = document.createElement('style');
    style.id = styleId;
    document.documentElement.appendChild(style);
  }
  style.textContent = ${JSON.stringify(css)};
  document.documentElement.classList.add('oneworks-demo-video-page-background');
  const installBackground = () => {
    if (document.body == null) return false;
    let background = document.getElementById(backgroundId);
    if (background == null) {
      background = document.createElement('div');
      background.id = backgroundId;
      background.setAttribute('aria-hidden', 'true');
      document.body.prepend(background);
    }
    Object.assign(background.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '0',
      pointerEvents: 'none',
      backgroundImage: 'url("' + imageUrl + '")',
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
      transform: 'translateZ(0)'
    });
    return true;
  };
  if (!installBackground()) {
    document.addEventListener('DOMContentLoaded', installBackground, { once: true });
  }
  if (window.__oneworksDemoVideoBackgroundObserver == null) {
    window.__oneworksDemoVideoBackgroundObserver = new MutationObserver(() => {
      installBackground();
    });
    window.__oneworksDemoVideoBackgroundObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})()
`
}

const buildDesktopPreferenceExpression = (input: {
  colorScheme: DemoVideoColorScheme
  language?: string
}) => `
(async () => {
  const desktop = window.oneworksDesktop;
  const language = ${JSON.stringify(input.language)};
  const colorScheme = ${JSON.stringify(input.colorScheme)};
  if (language != null) {
    try {
      localStorage.setItem(${JSON.stringify(APP_LANGUAGE_OVERRIDE_STORAGE_KEY)}, language);
      localStorage.removeItem('i18nextLng');
    } catch {}
    if (desktop?.updateGlobalInterfaceLanguageConfig != null) {
      await desktop.updateGlobalInterfaceLanguageConfig(language).catch(() => undefined);
    }
  }
  if (colorScheme === 'light' || colorScheme === 'dark') {
    if (desktop?.setThemeSource != null) {
      await desktop.setThemeSource(colorScheme).catch(() => undefined);
    }
    if (desktop?.updateGlobalAppearanceConfig != null) {
      await desktop.updateGlobalAppearanceConfig({ themeMode: colorScheme }).catch(() => undefined);
    }
  }
  return true;
})()
`

class DemoVideoRecorder implements DemoVideoScenarioContext {
  readonly durationMs: number
  readonly workspace: string | undefined
  readonly url: string | undefined

  private frameCount = 0
  private frameSize: DemoVideoViewport | undefined
  private actionCaptureDepth = 0
  private pageBackgroundApplied = false
  private recordedDurationMs = 0
  private systemActionCaptureDepth = 0
  private systemWindowId: number | undefined
  private readonly systemVideoSegments: SystemVideoSegment[] = []
  private readonly systemCursorEvents: SystemCursorEvent[] = []
  private systemCursorInitialPoint: Point | undefined
  private systemCursorTimelineMs: number | undefined
  private activeSystemSegment:
    | {
      startedAtMs: number
      timelineStartMs: number
    }
    | undefined
  private systemCursorPoint: Point | undefined

  constructor(
    private client: CdpClient,
    private readonly input: {
      captureSource: DemoVideoCaptureSource
      colorScheme: DemoVideoColorScheme
      cdpTargetListUrl?: string
      cdpWebSocketDebuggerUrl?: string
      durationMs: number
      followCdpTargets: boolean
      fps: number
      framesDir: string
      height: number
      language?: string
      pageBackgroundDataUrl?: string
      preserveTargetEnvironment: boolean
      segmentsDir: string
      systemDisplayCrop?: DemoVideoCropRect
      systemCursorWindowBounds?: DemoVideoSystemCursorWindowBounds
      systemDisplayId: number
      systemWindowFrameCapture: boolean
      systemWindowId?: number
      systemWindowOwnerPid?: number
      url?: string
      waitForText?: string
      waitForTextAbsent?: string
      waitForTextAbsentTimeoutMs?: number
      waitForTextTimeoutMs?: number
      workspace?: string
      width: number
    }
  ) {
    this.durationMs = input.durationMs
    this.systemWindowId = input.systemWindowId
    this.workspace = input.workspace
    this.url = input.url
  }

  getFrameCount() {
    return this.frameCount
  }

  getFrameSize() {
    return this.frameSize
  }

  getRecordedDurationMs() {
    return this.recordedDurationMs
  }

  getSystemVideoSegments() {
    return this.systemVideoSegments
  }

  getSystemCursorTimeline(): SystemCursorTimeline | undefined {
    if (!this.usesVideoLayerCursor()) return undefined
    return {
      enabled: true,
      events: this.systemCursorEvents,
      initialPoint: this.getInitialSystemCursorPoint()
    }
  }

  close() {
    this.client.close()
  }

  private usesVideoLayerCursor() {
    return this.input.captureSource === 'system-display'
  }

  private async installRendererOverlay() {
    await this.evaluate(installOverlayExpression)
    if (this.usesVideoLayerCursor()) {
      await this.evaluate(hideRendererCursorExpression)
    }
  }

  async initialize() {
    await this.client.send('Page.enable')
    await this.client.send('Runtime.enable')
    if (this.input.language != null) {
      const languageBootstrapExpression = buildLanguageBootstrapExpression(this.input.language)
      try {
        await this.client.send('Page.addScriptToEvaluateOnNewDocument', {
          source: languageBootstrapExpression
        })
      } catch {
        // Older Electron targets may not expose every CDP page helper.
      }
      try {
        await this.client.send('Emulation.setLocaleOverride', {
          locale: this.input.language
        })
      } catch {
        // Locale emulation is a best-effort hint; app config/localStorage still drives One Works i18n.
      }
      await this.evaluate(languageBootstrapExpression)
    }
    await this.evaluate(buildDesktopPreferenceExpression({
      colorScheme: this.input.colorScheme,
      language: this.input.language
    }))
    await this.installRendererOverlay()
    if (this.input.preserveTargetEnvironment) return

    await this.client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: this.input.height,
      mobile: false,
      width: this.input.width
    })
    await this.resizeBrowserWindowForViewport()
    if (this.input.colorScheme !== 'system') {
      await this.client.send('Emulation.setEmulatedMedia', {
        features: [{
          name: 'prefers-color-scheme',
          value: this.input.colorScheme
        }]
      })
    }
  }

  private async resizeBrowserWindowForViewport() {
    try {
      const result = await this.client.send<BrowserGetWindowForTargetResponse>('Browser.getWindowForTarget')
      if (typeof result.windowId !== 'number') return
      await this.client.send('Browser.setWindowBounds', {
        bounds: {
          height: this.input.height,
          width: this.input.width
        },
        windowId: result.windowId
      })
    } catch {
      // Electron and older Chromium targets may not expose Browser window controls.
    }
  }

  requireUrl() {
    if (!isNonEmptyString(this.url)) {
      throw new Error('This demo video scenario requires --url.')
    }
    return this.url
  }

  requireWorkspace() {
    if (!isNonEmptyString(this.workspace)) {
      throw new Error('This demo video scenario requires a workspace path.')
    }
    return this.workspace
  }

  resolveUrl(pathname: string) {
    const baseUrl = this.requireUrl()
    if (/^https?:\/\//.test(pathname)) return pathname
    return new URL(pathname, baseUrl).toString()
  }

  async navigate(url: string) {
    await this.client.send('Page.navigate', { url })
    await this.waitForReadyState()
    await this.installRendererOverlay()
  }

  async openDesktopWorkspace(workspaceFolder: string) {
    await this.evaluate<unknown>(
      `(async () => {
        if (window.oneworksDesktop?.openWorkspace == null) {
          throw new Error('window.oneworksDesktop.openWorkspace is not available.');
        }
        await window.oneworksDesktop.openWorkspace(${JSON.stringify(workspaceFolder)});
        return true;
      })()`
    )
  }

  async recordFor(
    durationMs: number,
    options: {
      allowDuringAction?: boolean
    } = {}
  ) {
    await this.waitForInitialText()

    if (this.usesSystemWindowFrameCapture()) {
      if (this.systemActionCaptureDepth > 0) {
        await this.sleepAndAdvanceSystemCursorTimeline(durationMs)
        return
      }
      await this.captureSystemWindowFrames(durationMs)
      return
    }

    if (isSystemCaptureSource(this.input.captureSource)) {
      if (this.systemActionCaptureDepth > 0) {
        await this.sleepAndAdvanceSystemCursorTimeline(durationMs)
        return
      }
      if (this.input.captureSource === 'system-window' && this.input.systemWindowOwnerPid != null) {
        await this.captureFollowedSystemWindowVideoSegments(durationMs)
        return
      }
      await this.captureSystemVideoSegment(durationMs)
      return
    }

    if (this.actionCaptureDepth > 0 && options.allowDuringAction !== true) {
      await sleep(durationMs)
      return
    }

    const intervalMs = 1_000 / this.input.fps
    const frameTotal = Math.max(1, Math.ceil(durationMs / intervalMs))
    for (let index = 0; index < frameTotal; index += 1) {
      await this.captureFrame()
      if (index < frameTotal - 1) await sleep(intervalMs)
    }
    this.recordedDurationMs += durationMs
  }

  async recordDuring(durationMs: number, action: () => Promise<void>) {
    await this.waitForInitialText()

    if (this.input.captureSource === 'system-window' && this.input.systemWindowOwnerPid != null) {
      if (this.usesSystemWindowFrameCapture()) {
        await this.captureFollowedSystemWindowFrames(durationMs, action)
        return
      }
      await this.captureFollowedSystemWindowVideo(durationMs, action)
      return
    }

    if (isSystemCaptureSource(this.input.captureSource)) {
      await this.captureSystemVideoDuringAction(durationMs, action)
      return
    }

    const actionPromise = settleAction(this.runRecordedAction(action))
    await this.recordFor(durationMs, { allowDuringAction: true })
    rethrowSettledAction(await actionPromise)
  }

  private async captureSystemVideoDuringAction(durationMs: number, action: () => Promise<void>) {
    const actionPromise = settleAction(sleep(500).then(() => this.runSystemRecordedAction(action)))
    let actionResult: SettledAction | undefined
    void actionPromise.then(result => {
      actionResult = result
    })

    const maxDurationMs = durationMs + 120_000
    let capturedMs = 0
    while (
      shouldContinueSystemCaptureDuringAction({
        actionSettled: actionResult != null,
        capturedMs,
        requestedDurationMs: durationMs
      })
    ) {
      if (capturedMs >= maxDurationMs && actionResult == null) {
        throw new Error('Timed out recording system video while waiting for the scenario action to finish.')
      }

      // System-display videos are continuous capture with a post-composited cursor timeline.
      // The requested duration is a minimum capture window, not a hard cutoff: if the scenario
      // action keeps clicking after the segment closes, those cursor events collapse onto a later
      // timestamp and show up as a visible cursor jump in the final MP4.
      const segmentMs = capturedMs < durationMs
        ? Math.min(1_000, durationMs - capturedMs)
        : 1_000
      const beforeMs = this.recordedDurationMs
      await this.captureSystemVideoSegment(segmentMs)
      capturedMs += Math.max(1_000, this.recordedDurationMs - beforeMs)
    }

    rethrowSettledAction(actionResult ?? await actionPromise)
  }

  async waitForText(text: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    await this.waitForPoint(() => this.findPointByText(text, options.exact ?? false), {
      label: `text "${text}"`,
      timeoutMs
    })
  }

  async recordUntilSelector(selector: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await this.followCdpTargetIfNeeded(selector)
      const matched = await this.hasSelector(selector).catch(() => false)
      if (matched) return
      const remainingMs = timeoutMs - (Date.now() - startedAt)
      await this.recordFor(Math.min(1_000, Math.max(100, remainingMs)))
    }
    throw new Error(
      [
        `Timed out recording until selector "${selector}".`,
        await this.buildSelectorTimeoutDiagnostic(selector)
      ].filter(Boolean).join('\n')
    )
  }

  async recordUntilSelectorAbsent(selector: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await this.followCdpTargetIfNeeded()
      const matched = await this.hasSelector(selector).catch(() => false)
      if (!matched) return
      const remainingMs = timeoutMs - (Date.now() - startedAt)
      await this.recordFor(Math.min(1_000, Math.max(100, remainingMs)))
    }
    throw new Error(
      [
        `Timed out recording until selector "${selector}" disappeared.`,
        await this.buildSelectorTimeoutDiagnostic(selector)
      ].filter(Boolean).join('\n')
    )
  }

  async recordUntilText(text: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await this.followCdpTargetIfNeeded()
      const matched = await this.evaluate<boolean>(
        `document.body?.innerText?.includes(${JSON.stringify(text)}) === true`
      ).catch(() => false)
      if (matched) return
      const remainingMs = timeoutMs - (Date.now() - startedAt)
      await this.recordFor(Math.min(1_000, Math.max(100, remainingMs)))
    }
    throw new Error(`Timed out recording until text "${text}".`)
  }

  async waitForTextAbsent(text: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const present = await this.evaluate<boolean>(
        `document.body?.innerText?.includes(${JSON.stringify(text)}) === true`
      )
      if (!present) return
      await sleep(150)
    }
    throw new Error(`Timed out waiting for text "${text}" to disappear.`)
  }

  async clickText(text: string, options: DemoVideoClickOptions = {}) {
    const point = await this.waitForPoint(() => this.findPointByText(text, options.exact ?? false), {
      label: `text "${text}"`,
      timeoutMs: options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    })
    await this.clickPoint(point, options.settleMs)
  }

  async clickSelector(selector: string, options: DemoVideoClickOptions = {}) {
    const point = await this.waitForPoint(() => this.findPointBySelector(selector), {
      label: `selector "${selector}"`,
      timeoutMs: options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    })
    await this.clickPoint(point, options.settleMs)
  }

  async focusSelector(selector: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await this.followCdpTargetIfNeeded()
      const focused = await this.evaluate<boolean>(focusSelectorExpression(selector))
      if (focused) return
      await sleep(150)
    }
    throw new Error(`Timed out focusing selector "${selector}".`)
  }

  async selectTextInSelector(selector: string, options: DemoVideoTextOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      await this.followCdpTargetIfNeeded()
      const selected = await this.evaluate<boolean>(selectTextInSelectorExpression(selector))
      if (selected) return
      await sleep(150)
    }
    throw new Error(`Timed out selecting text in selector "${selector}".`)
  }

  async pressKey(key: string, options: DemoVideoKeyOptions = {}) {
    const parsed = parseKeyCombo(key)
    await this.showKeys(parsed.displayLabels)
    await this.recordFor(300)

    let modifiers = 0
    for (const modifier of parsed.modifiers) {
      modifiers |= modifier.modifierBit
      await this.dispatchKeyEvent(modifier, 'rawKeyDown', modifiers)
    }

    const includeText = modifiers === 0 && parsed.key.text != null
    await this.dispatchKeyEvent(parsed.key, 'keyDown', modifiers, includeText)
    await this.dispatchKeyEvent(parsed.key, 'keyUp', modifiers)

    for (const modifier of parsed.modifiers.toReversed()) {
      await this.dispatchKeyEvent(modifier, 'keyUp', modifiers)
      modifiers &= ~modifier.modifierBit
    }

    await sleep(options.settleMs ?? DEFAULT_KEY_SETTLE_MS)
  }

  async typeText(text: string, options: DemoVideoTypeOptions = {}) {
    await this.showKeys(['Type', formatTypedText(text)])
    await this.recordFor(300)
    await this.client.send('Input.insertText', { text })
    await sleep(options.settleMs ?? DEFAULT_KEY_SETTLE_MS)
  }

  private async waitForReadyState(timeoutMs = DEFAULT_ACTION_TIMEOUT_MS) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const readyState = await this.evaluate<string>('document.readyState')
      if (readyState === 'complete' || readyState === 'interactive') return
      await sleep(100)
    }
    throw new Error('Timed out waiting for page readiness.')
  }

  private async waitForInitialText() {
    if (this.input.waitForText != null) {
      const text = this.input.waitForText
      this.input.waitForText = undefined
      await this.waitForText(text, {
        timeoutMs: this.input.waitForTextTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
      })
    }
    if (this.input.waitForTextAbsent != null) {
      const text = this.input.waitForTextAbsent
      this.input.waitForTextAbsent = undefined
      await this.waitForTextAbsent(text, {
        timeoutMs: this.input.waitForTextAbsentTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS
      })
    }
    await this.applyPageBackground()
  }

  private async applyPageBackground() {
    if (this.pageBackgroundApplied || this.input.pageBackgroundDataUrl == null) return
    await this.evaluate(buildPageBackgroundExpression(this.input.pageBackgroundDataUrl))
    this.pageBackgroundApplied = true
  }

  private async waitForPoint(
    findPoint: () => Promise<Point | undefined>,
    input: {
      label: string
      timeoutMs: number
    }
  ) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < input.timeoutMs) {
      await this.followCdpTargetIfNeeded()
      const point = await findPoint()
      if (point != null) return point
      await sleep(150)
    }
    throw new Error(`Timed out waiting for ${input.label}.`)
  }

  private getInitialSystemCursorPoint(): Point {
    if (this.systemCursorInitialPoint != null) return this.systemCursorInitialPoint
    const width = this.input.systemDisplayCrop?.width ?? this.input.width
    const height = this.input.systemDisplayCrop?.height ?? this.input.height
    this.systemCursorInitialPoint = {
      x: Math.round(width / 2),
      y: Math.round(height / 2)
    }
    this.systemCursorPoint ??= this.systemCursorInitialPoint
    return this.systemCursorInitialPoint
  }

  private getCurrentSystemCursorPoint(): Point {
    if (this.systemCursorPoint != null) return this.systemCursorPoint
    this.systemCursorPoint = this.getInitialSystemCursorPoint()
    return this.systemCursorPoint
  }

  private getSystemTimelineMs() {
    const captureTimelineMs = this.activeSystemSegment == null
      ? this.recordedDurationMs
      : this.activeSystemSegment.timelineStartMs + getSystemCaptureTimelineElapsedMs({
        captureSource: this.input.captureSource,
        elapsedWallMs: Date.now() - this.activeSystemSegment.startedAtMs
      })
    return this.systemCursorTimelineMs == null
      ? captureTimelineMs
      : Math.max(captureTimelineMs, this.systemCursorTimelineMs)
  }

  private getLastSystemCursorEventEndMs() {
    const lastEvent = this.systemCursorEvents.at(-1)
    if (lastEvent == null) return 0
    return lastEvent.startMs + lastEvent.durationMs
  }

  private async sleepAndAdvanceSystemCursorTimeline(durationMs: number) {
    const startedAtMs = this.systemCursorTimelineMs ?? this.getSystemTimelineMs()
    await sleep(durationMs)
    this.systemCursorTimelineMs = Math.max(startedAtMs + durationMs, this.getLastSystemCursorEventEndMs())
  }

  private async resolveSystemCursorPoint(point: Point): Promise<Point> {
    const crop = this.input.systemDisplayCrop
    const windowBounds = this.input.systemCursorWindowBounds
    if (crop == null || windowBounds == null) return point

    const windowKind = await this.evaluate<'launcher' | 'workspace'>(
      `(() => {
        const root = document.documentElement;
        if (
          root?.classList?.contains('oneworks-launcher-window') ||
          /(?:^|\\/)launcher\\/?$/.test(location.pathname)
        ) {
          return 'launcher';
        }
        return 'workspace';
      })()`
    ).catch(() => 'workspace' as const)
    const bounds = windowKind === 'launcher'
      ? windowBounds.launcher ?? windowBounds.workspace
      : windowBounds.workspace ?? windowBounds.launcher
    if (bounds == null) return point

    return {
      x: bounds.x - crop.x + point.x,
      y: bounds.y - crop.y + point.y
    }
  }

  private recordSystemCursorEvent(
    to: Point,
    action: CursorAction,
    durationMs: number
  ) {
    const from = this.getCurrentSystemCursorPoint()
    const startMs = Math.max(this.getSystemTimelineMs(), this.getLastSystemCursorEventEndMs())
    const previousEvent = this.systemCursorEvents.at(-1)
    if (action === 'release' && previousEvent?.action === 'click') {
      previousEvent.durationMs = Math.max(previousEvent.durationMs, startMs - previousEvent.startMs)
    }
    const event = {
      action,
      durationMs,
      from,
      startMs,
      to
    }
    this.systemCursorEvents.push(event)
    this.systemCursorTimelineMs = startMs
    this.systemCursorPoint = to
    return durationMs
  }

  private recordSystemCursorMove(to: Point) {
    const from = this.getCurrentSystemCursorPoint()
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    if (distance < 4) {
      return this.recordSystemCursorEvent(to, 'idle', SYSTEM_CURSOR_STATIONARY_MOVE_MS)
    }
    const durationMs = clamp(
      SYSTEM_CURSOR_MOVE_BASE_MS + distance * SYSTEM_CURSOR_MOVE_DISTANCE_MS_PER_PX,
      SYSTEM_CURSOR_MOVE_MIN_MS,
      SYSTEM_CURSOR_MOVE_MAX_MS
    )
    return this.recordSystemCursorEvent(to, distance < 4 ? 'idle' : 'move', durationMs)
  }

  private async clickPoint(point: Point, settleMs = DEFAULT_CLICK_SETTLE_MS) {
    if (this.usesVideoLayerCursor()) {
      const videoPoint = await this.resolveSystemCursorPoint(point)
      const moveDurationMs = this.recordSystemCursorMove(videoPoint)
      const minMoveRecordMs = moveDurationMs <= SYSTEM_CURSOR_STATIONARY_MOVE_MS
        ? SYSTEM_CURSOR_STATIONARY_MOVE_MS
        : SYSTEM_CURSOR_MOVE_MIN_MS
      await this.recordFor(Math.max(
        minMoveRecordMs,
        Math.round(moveDurationMs) + SYSTEM_CURSOR_MOVE_RECORD_PADDING_MS
      ))
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'none',
        buttons: 0,
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      })
      const clickDurationMs = this.recordSystemCursorEvent(
        videoPoint,
        'click',
        SYSTEM_CURSOR_CLICK_DURATION_MS
      )
      await this.recordFor(Math.max(SYSTEM_CURSOR_CLICK_DURATION_MS, Math.round(clickDurationMs)))
      const releaseDurationMs = this.recordSystemCursorEvent(
        videoPoint,
        'release',
        SYSTEM_CURSOR_RELEASE_DURATION_MS
      )
      await this.recordFor(Math.max(SYSTEM_CURSOR_RELEASE_DURATION_MS, Math.round(releaseDurationMs)))
      await this.recordFor(SYSTEM_CURSOR_INPUT_AFTER_VISUAL_DELAY_MS)
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'left',
        buttons: 1,
        clickCount: 1,
        type: 'mousePressed',
        x: point.x,
        y: point.y
      })
      await this.recordFor(SYSTEM_CURSOR_INPUT_HOLD_MS)
      await this.client.send('Input.dispatchMouseEvent', {
        button: 'left',
        buttons: 0,
        clickCount: 1,
        type: 'mouseReleased',
        x: point.x,
        y: point.y
      })
      await this.recordFor(settleMs)
      return
    }

    const moveDurationMs = await this.evaluate<number>(setCursorExpression(point, 'move'))
    await this.recordFor(Math.max(
      SYSTEM_CURSOR_MOVE_MIN_MS,
      Math.round(moveDurationMs) + SYSTEM_CURSOR_MOVE_RECORD_PADDING_MS
    ))
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'none',
      buttons: 0,
      type: 'mouseMoved',
      x: point.x,
      y: point.y
    })
    const clickDurationMs = await this.evaluate<number>(setCursorExpression(point, 'click'))
    await this.recordFor(Math.max(SYSTEM_CURSOR_CLICK_DURATION_MS, Math.round(clickDurationMs)))
    const releaseDurationMs = await this.evaluate<number>(setCursorExpression(point, 'release'))
    await this.recordFor(Math.max(SYSTEM_CURSOR_RELEASE_DURATION_MS, Math.round(releaseDurationMs)))
    await this.recordFor(SYSTEM_CURSOR_INPUT_AFTER_VISUAL_DELAY_MS)
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      type: 'mousePressed',
      x: point.x,
      y: point.y
    })
    await this.recordFor(SYSTEM_CURSOR_INPUT_HOLD_MS)
    await this.client.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      type: 'mouseReleased',
      x: point.x,
      y: point.y
    })
    await this.evaluate(setCursorExpression(point, 'idle'))
    await this.recordFor(settleMs)
  }

  private async showKeys(labels: string[]) {
    await this.evaluate(showKeysExpression(labels))
  }

  private async dispatchKeyEvent(
    key: KeyDefinition,
    type: 'keyDown' | 'keyUp' | 'rawKeyDown',
    modifiers: number,
    includeText = false
  ) {
    await this.client.send('Input.dispatchKeyEvent', {
      code: key.code,
      key: key.key,
      modifiers,
      nativeVirtualKeyCode: key.windowsVirtualKeyCode,
      type,
      windowsVirtualKeyCode: key.windowsVirtualKeyCode,
      ...(includeText && key.text != null
        ? {
          text: key.text,
          unmodifiedText: key.text
        }
        : {})
    })
  }

  private async findPointByText(text: string, exact: boolean) {
    return await this.evaluatePoint(findPointByTextExpression({ exact, text }))
  }

  private async findPointBySelector(selector: string) {
    return await this.evaluatePoint(findPointBySelectorExpression(selector))
  }

  private async hasSelector(selector: string) {
    return await this.evaluate<boolean>(hasSelectorExpression(selector))
  }

  private async evaluatePoint(expression: string): Promise<Point | undefined> {
    const value = await this.evaluate<unknown>(expression)
    if (!isRecord(value)) return undefined
    const x = value.x
    const y = value.y
    if (typeof x !== 'number' || typeof y !== 'number') return undefined
    return { x, y }
  }

  private async evaluate<TResult>(expression: string) {
    const response = await this.client.send<RuntimeEvaluateResponse>('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true
    })
    if (response.exceptionDetails != null) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Runtime.evaluate failed.'
      )
    }
    return response.result?.value as TResult
  }

  private async captureFrame() {
    await this.followCdpTargetIfNeeded()
    const response = await this.client.send<PageCaptureScreenshotResponse>('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png'
    })
    if (!isNonEmptyString(response.data)) {
      throw new Error('Chrome returned an empty screenshot frame.')
    }
    const frameBuffer = Buffer.from(response.data, 'base64')
    this.frameCount += 1
    await writeFile(
      path.join(this.input.framesDir, frameFileName(this.frameCount)),
      frameBuffer
    )
    this.frameSize = expandViewport(this.frameSize, parsePngDimensions(frameBuffer))
  }

  private async followCdpTargetIfNeeded(selector?: string) {
    if (!this.input.followCdpTargets || this.input.cdpTargetListUrl == null) return
    const targets = parseChromeTargets(await fetchJson(this.input.cdpTargetListUrl).catch(() => []))
    const followableTargets = targets.filter(isFollowableCdpPageTarget)
    const target = selector == null
      ? followableTargets[0]
      : await this.findFollowableTargetBySelector(followableTargets, selector) ?? followableTargets[0]
    if (target?.webSocketDebuggerUrl == null || target.webSocketDebuggerUrl === this.input.cdpWebSocketDebuggerUrl) {
      return
    }

    const nextClient = await createCdpClient(target.webSocketDebuggerUrl)
    this.client.close()
    this.client = nextClient
    this.input.cdpWebSocketDebuggerUrl = target.webSocketDebuggerUrl
    this.pageBackgroundApplied = false
    await this.initialize()
    await this.installRendererOverlay()
  }

  private async findFollowableTargetBySelector(targets: ChromeDebugTarget[], selector: string) {
    for (const target of targets) {
      if (target.webSocketDebuggerUrl == null) continue
      if (target.webSocketDebuggerUrl === this.input.cdpWebSocketDebuggerUrl) {
        const matched = await this.hasSelector(selector).catch(() => false)
        if (matched) return target
        continue
      }

      const candidateClient = await createCdpClient(target.webSocketDebuggerUrl).catch(() => undefined)
      if (candidateClient == null) continue
      try {
        await candidateClient.send('Runtime.enable')
        const response = await candidateClient.send<RuntimeEvaluateResponse>('Runtime.evaluate', {
          awaitPromise: true,
          expression: hasSelectorExpression(selector),
          returnByValue: true
        })
        if (response.exceptionDetails == null && response.result?.value === true) {
          return target
        }
      } finally {
        candidateClient.close()
      }
    }
    return undefined
  }

  private async buildSelectorTimeoutDiagnostic(selector: string) {
    const current = await this.evaluate<{
      bodyText?: string
      href?: string
      selectorMatched?: boolean
    }>(
      `(() => ({
        href: location.href,
        selectorMatched: document.querySelector(${JSON.stringify(selector)}) != null,
        bodyText: document.body?.innerText?.slice(0, 240)
      }))()`
    ).catch(error => ({
      bodyText: error instanceof Error ? error.message : String(error),
      href: '<unavailable>',
      selectorMatched: false
    }))
    const targets = this.input.cdpTargetListUrl == null
      ? []
      : parseChromeTargets(await fetchJson(this.input.cdpTargetListUrl).catch(() => []))
    const targetSummary = targets
      .filter(target => target.type === 'page')
      .map(target =>
        `${target.url}${target.webSocketDebuggerUrl === this.input.cdpWebSocketDebuggerUrl ? ' [current]' : ''}`
      )
      .join(' | ')

    return [
      `Current CDP target: ${current.href ?? '<unknown>'}; selectorMatched=${current.selectorMatched === true}`,
      current.bodyText == null || current.bodyText === '' ? undefined : `Current body: ${current.bodyText}`,
      targetSummary === '' ? 'CDP page targets: <none>' : `CDP page targets: ${targetSummary}`
    ].filter(Boolean).join('\n')
  }

  private async refreshSystemWindowIdFromOwner() {
    if (this.input.captureSource !== 'system-window') return
    if (this.input.systemWindowOwnerPid == null) {
      if (this.systemWindowId != null) return
      throw new Error('system-window demo video capture requires systemWindowId or systemWindowOwnerPid.')
    }

    const window = (await listMacWindowsByOwnerPid(this.input.systemWindowOwnerPid))[0]
    if (window == null) {
      throw new Error(`No visible macOS window was found for pid ${this.input.systemWindowOwnerPid}.`)
    }
    this.systemWindowId = window.id
  }

  private usesSystemWindowFrameCapture() {
    return this.input.captureSource === 'system-window' && this.input.systemWindowFrameCapture
  }

  private async captureFollowedSystemWindowFrames(durationMs: number, action: () => Promise<void>) {
    const actionPromise = settleAction(sleep(500).then(() => this.runSystemRecordedAction(action)))
    await this.captureSystemWindowFrames(durationMs)
    rethrowSettledAction(await actionPromise)
  }

  private async captureSystemWindowFrames(durationMs: number) {
    const intervalMs = 1_000 / this.input.fps
    const frameTotal = Math.max(1, Math.ceil(durationMs / intervalMs))
    const startedAt = Date.now()
    let recoverableWindowCaptureFailures = 0

    for (let index = 0; index < frameTotal; index += 1) {
      try {
        await this.refreshSystemWindowIdFromOwner()
        await this.captureSystemWindowFrame()
        recoverableWindowCaptureFailures = 0
      } catch (error) {
        if (!this.canRecoverFollowedSystemWindowCapture(error) || recoverableWindowCaptureFailures >= 5) {
          throw error
        }
        recoverableWindowCaptureFailures += 1
        this.systemWindowId = undefined
        await sleep(250)
        index -= 1
        continue
      }

      const nextFrameAt = startedAt + (index + 1) * intervalMs
      const waitMs = nextFrameAt - Date.now()
      if (waitMs > 0 && index < frameTotal - 1) await sleep(waitMs)
    }

    this.recordedDurationMs += durationMs
  }

  private async captureFollowedSystemWindowVideo(durationMs: number, action: () => Promise<void>) {
    const actionPromise = settleAction(sleep(500).then(() => this.runSystemRecordedAction(action)))
    await this.captureFollowedSystemWindowVideoSegments(durationMs)
    rethrowSettledAction(await actionPromise)
  }

  private async captureFollowedSystemWindowVideoSegments(durationMs: number) {
    let remainingMs = durationMs
    let recoverableWindowCaptureFailures = 0
    const maxRecoverableWindowCaptureFailures = 15
    while (remainingMs > 0) {
      const segmentMs = Math.min(1_000, remainingMs)
      try {
        await this.refreshSystemWindowIdFromOwner()
        await this.captureSystemVideoSegment(segmentMs)
        recoverableWindowCaptureFailures = 0
        remainingMs -= segmentMs
      } catch (error) {
        if (
          !this.canRecoverFollowedSystemWindowCapture(error) ||
          recoverableWindowCaptureFailures >= maxRecoverableWindowCaptureFailures
        ) {
          throw error
        }
        recoverableWindowCaptureFailures += 1
        this.systemWindowId = undefined
        await sleep(250)
      }
    }
  }

  private async runSystemRecordedAction(action: () => Promise<void>) {
    this.systemActionCaptureDepth += 1
    try {
      await action()
    } finally {
      this.systemActionCaptureDepth -= 1
    }
  }

  private async runRecordedAction(action: () => Promise<void>) {
    this.actionCaptureDepth += 1
    try {
      await action()
    } finally {
      this.actionCaptureDepth -= 1
    }
  }

  private canRecoverFollowedSystemWindowCapture(error: unknown) {
    return (
      this.input.captureSource === 'system-window' &&
      this.input.systemWindowOwnerPid != null &&
      error instanceof Error &&
      (
        error.message.includes('screencapture') ||
        error.message.includes('ScreenCaptureKit') ||
        error.message.includes('macOS window')
      )
    )
  }

  private async captureSystemWindowFrame() {
    if (this.systemWindowId == null) {
      throw new Error('system-window demo video capture requires a resolved macOS window id.')
    }
    await mkdir(this.input.framesDir, { recursive: true })
    const framePath = path.join(this.input.framesDir, frameFileName(this.frameCount + 1))
    const result = await runCommand({
      args: ['-x', `-l${this.systemWindowId}`, framePath],
      command: 'screencapture',
      cwd: process.cwd(),
      timeoutMs: 5_000
    })
    if (result.code !== 0) {
      throw new Error(
        [
          `screencapture image failed with exit code ${result.code} for window ${this.systemWindowId}.`,
          result.timedOut ? 'timedOut=true' : undefined,
          result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
          result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
        ].filter(Boolean).join('\n')
      )
    }
    const frameBuffer = await readFile(framePath)
    if (frameBuffer.byteLength === 0) {
      throw new Error(`screencapture produced an empty image frame for window ${this.systemWindowId}.`)
    }
    this.frameCount += 1
    this.frameSize = expandViewport(this.frameSize, parsePngDimensions(frameBuffer))
  }

  private async captureSystemVideoSegment(durationMs: number) {
    if (this.input.captureSource === 'system-window' && this.systemWindowId == null) {
      throw new Error('system-window demo video capture requires a resolved macOS window id.')
    }
    await mkdir(this.input.segmentsDir, { recursive: true })
    const seconds = Math.max(1, Math.ceil(durationMs / 1_000))
    const segmentIndex = this.systemVideoSegments.length + 1
    const segmentPath = path.join(this.input.segmentsDir, `segment_${String(segmentIndex).padStart(4, '0')}.mov`)
    const isWindowCapture = this.input.captureSource === 'system-window'
    this.activeSystemSegment = {
      startedAtMs: Date.now(),
      timelineStartMs: this.recordedDurationMs
    }
    const result = await (isWindowCapture
      ? runCommand({
        args: [
          '-e',
          screenCaptureKitWindowVideoScript,
          String(this.systemWindowId),
          String(seconds),
          segmentPath,
          String(this.input.fps),
          this.input.colorScheme === 'dark' ? 'dark' : 'light'
        ],
        command: 'swift',
        cwd: process.cwd(),
        timeoutMs: (seconds + 20) * 1_000
      })
      : runCommand({
        args: ['-x', '-v', '-V', String(seconds), '-D', String(this.input.systemDisplayId), segmentPath],
        command: 'screencapture',
        cwd: process.cwd(),
        timeoutMs: (seconds + 15) * 1_000
      }))
      .finally(() => {
        this.activeSystemSegment = undefined
      })
    if (result.code !== 0) {
      const backendName = isWindowCapture ? 'ScreenCaptureKit' : 'screencapture'
      throw new Error(
        [
          `${backendName} video failed with exit code ${result.code} for window ${this.systemWindowId}.`,
          result.timedOut ? 'timedOut=true' : undefined,
          result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
          result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
        ].filter(Boolean).join('\n')
      )
    }
    let segmentBuffer: Buffer | undefined
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        segmentBuffer = await readFile(segmentPath)
        break
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        ) {
          throw error
        }
        await sleep(100)
      }
    }
    if (segmentBuffer == null) {
      throw new Error(`ScreenCaptureKit did not produce a video segment for window ${this.systemWindowId}.`)
    }
    if (segmentBuffer.byteLength === 0) {
      throw new Error(`screencapture produced an empty video segment for window ${this.systemWindowId}.`)
    }

    this.systemVideoSegments.push({
      durationMs: seconds * 1_000,
      videoPath: segmentPath
    })
    this.recordedDurationMs += seconds * 1_000
    this.frameCount += Math.max(1, Math.round(seconds * this.input.fps))
  }
}

const encodeVideo = async (input: {
  durationMs?: number
  ffmpegPath: string
  fps: number
  frameSize?: DemoVideoViewport
  framesDir: string
  videoBackgroundColor?: string
  videoBackgroundImage?: string
  videoPath: string
}) => {
  if ((input.videoBackgroundColor != null || input.videoBackgroundImage != null) && input.frameSize == null) {
    throw new Error('Demo video background compositing requires a captured frame size.')
  }
  const videoBackgroundImage = input.videoBackgroundImage == null
    ? undefined
    : await prepareVideoBackgroundImage({
      imagePath: input.videoBackgroundImage,
      workDir: path.dirname(input.videoPath)
    })
  const matteDurationSeconds = Math.max(1, Math.ceil((input.durationMs ?? 0) / 1_000) + 1)
  const matteInputArgs = videoBackgroundImage == null
    ? input.videoBackgroundColor == null || input.frameSize == null
      ? []
      : [
        '-f',
        'lavfi',
        '-i',
        `color=c=${input.videoBackgroundColor}:s=${input.frameSize.width}x${input.frameSize.height}:r=${input.fps}:d=${matteDurationSeconds}`
      ]
    : [
      '-loop',
      '1',
      '-framerate',
      String(input.fps),
      '-i',
      videoBackgroundImage
    ]
  const durationArgs = input.durationMs == null
    ? []
    : [
      '-t',
      String(Math.max(1, input.durationMs / 1_000))
    ]
  const filterArgs = matteInputArgs.length === 0
    ? [
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    ]
    : [
      '-filter_complex',
      `[0:v]format=rgba[fg];[1:v]scale=${input.frameSize?.width ?? 'iw'}:${
        input.frameSize?.height ?? 'ih'
      }:force_original_aspect_ratio=increase,crop=${input.frameSize?.width ?? 'iw'}:${
        input.frameSize?.height ?? 'ih'
      },setsar=1[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1:repeatlast=0:format=auto,setsar=1,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[out]`,
      '-map',
      '[out]',
      '-shortest',
      ...durationArgs
    ]
  const result = await runCommand({
    args: [
      '-y',
      '-framerate',
      String(input.fps),
      '-i',
      path.join(input.framesDir, 'frame_%05d.png'),
      ...matteInputArgs,
      ...filterArgs,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      input.videoPath
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
}

const writeConcatList = async (input: {
  listPath: string
  segmentPaths: string[]
}) => {
  const escapePath = (value: string) => value.replace(/'/g, `'\\''`)
  await writeFile(input.listPath, input.segmentPaths.map(segmentPath => `file '${escapePath(segmentPath)}'`).join('\n'))
}

const readVideoDimensions = async (input: {
  ffmpegPath: string
  videoPath: string
}): Promise<DemoVideoViewport> => {
  const result = await runCommand({
    args: ['-hide_banner', '-i', input.videoPath, '-frames:v', '1', '-f', 'null', '-'],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 30_000
  })
  const output = `${result.stdout}\n${result.stderr}`
  const match = /Video:\s.*?,\s*(\d{2,5})x(\d{2,5})[\s,]/u.exec(output)
  if (match == null) {
    throw new Error(`Unable to read video dimensions from ${input.videoPath}.`)
  }
  return {
    height: Number(match[2]),
    width: Number(match[1])
  }
}

const demoCursor = {
  height: 96,
  hotspotX: 16,
  hotspotY: 12,
  width: 82
}

const crc32Table = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (buffer: Buffer) => {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xFF]! ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const pngChunk = (type: string, data: Buffer) => {
  const typeBuffer = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBuffer.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
  return chunk
}

const encodeRgbaPng = (input: {
  height: number
  pixels: Uint8ClampedArray
  width: number
}) => {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(input.width, 0)
  ihdr.writeUInt32BE(input.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowSize = input.width * 4
  const raw = Buffer.alloc((rowSize + 1) * input.height)
  for (let y = 0; y < input.height; y += 1) {
    raw[y * (rowSize + 1)] = 0
    Buffer.from(input.pixels.buffer, input.pixels.byteOffset + y * rowSize, rowSize)
      .copy(raw, y * (rowSize + 1) + 1)
  }

  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

const demoCursorPolygon = [
  { x: 14, y: 10 },
  { x: 72, y: 54 },
  { x: 45, y: 63 },
  { x: 29, y: 86 }
] satisfies Point[]

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]!
    const previousPoint = polygon[previous]!
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y)) &&
      point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y) /
              (previousPoint.y - currentPoint.y) + currentPoint.x
    if (intersects) inside = !inside
  }
  return inside
}

const distanceToSegment = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

const distanceToPolygon = (point: Point, polygon: Point[]) => (
  polygon.reduce((distance, start, index) => (
    Math.min(distance, distanceToSegment(point, start, polygon[(index + 1) % polygon.length]!))
  ), Number.POSITIVE_INFINITY)
)

const blendPixel = (
  target: number[],
  source: readonly [number, number, number, number]
) => {
  const sourceAlpha = source[3] / 255
  const targetAlpha = target[3] / 255
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
  if (outAlpha <= 0) return
  target[0] = (source[0] * sourceAlpha + target[0] * targetAlpha * (1 - sourceAlpha)) / outAlpha
  target[1] = (source[1] * sourceAlpha + target[1] * targetAlpha * (1 - sourceAlpha)) / outAlpha
  target[2] = (source[2] * sourceAlpha + target[2] * targetAlpha * (1 - sourceAlpha)) / outAlpha
  target[3] = outAlpha * 255
}

const sampleCursorColor = (point: Point): [number, number, number, number] => {
  const color = [0, 0, 0, 0]
  const sampleShadow = (input: {
    alpha: number
    blur: number
    color: readonly [number, number, number]
    offsetX: number
    offsetY: number
  }) => {
    const shadowPoint = {
      x: point.x - input.offsetX,
      y: point.y - input.offsetY
    }
    const shadowDistance = distanceToPolygon(shadowPoint, demoCursorPolygon)
    const shadowInside = pointInPolygon(shadowPoint, demoCursorPolygon)
    if (!shadowInside && shadowDistance > input.blur) return
    const shadowSoftness = shadowInside ? 1 : 1 - shadowDistance / input.blur
    blendPixel(color, [
      input.color[0],
      input.color[1],
      input.color[2],
      Math.round(input.alpha * shadowSoftness)
    ])
  }
  sampleShadow({
    alpha: 36,
    blur: 11,
    color: [34, 45, 67],
    offsetX: 5,
    offsetY: 7
  })
  sampleShadow({
    alpha: 32,
    blur: 4.5,
    color: [11, 16, 25],
    offsetX: 2,
    offsetY: 3
  })

  const inside = pointInPolygon(point, demoCursorPolygon)
  const distance = distanceToPolygon(point, demoCursorPolygon)
  if (!inside && distance > 3.6) return color as [number, number, number, number]
  if (!inside && distance > 2.8) {
    blendPixel(color, [224, 229, 236, Math.round((3.6 - distance) / 0.8 * 132)])
    return color as [number, number, number, number]
  }
  if (!inside || distance <= 2.15) {
    blendPixel(color, [255, 255, 255, 246])
    return color as [number, number, number, number]
  }
  blendPixel(color, [66, 141, 244, 255])
  return color as [number, number, number, number]
}

export const writeDemoCursorPng = async (cursorPath: string) => {
  const samples = 4
  const pixels = new Uint8ClampedArray(demoCursor.width * demoCursor.height * 4)
  for (let y = 0; y < demoCursor.height; y += 1) {
    for (let x = 0; x < demoCursor.width; x += 1) {
      let alphaSum = 0
      let redSum = 0
      let greenSum = 0
      let blueSum = 0
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const color = sampleCursorColor({
            x: x + (sampleX + 0.5) / samples,
            y: y + (sampleY + 0.5) / samples
          })
          const alpha = color[3] / 255
          alphaSum += alpha
          redSum += color[0] * alpha
          greenSum += color[1] * alpha
          blueSum += color[2] * alpha
        }
      }
      const offset = (y * demoCursor.width + x) * 4
      const sampleTotal = samples * samples
      const alpha = alphaSum / sampleTotal
      pixels[offset] = alphaSum <= 0 ? 0 : Math.round(redSum / alphaSum)
      pixels[offset + 1] = alphaSum <= 0 ? 0 : Math.round(greenSum / alphaSum)
      pixels[offset + 2] = alphaSum <= 0 ? 0 : Math.round(blueSum / alphaSum)
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }
  await writeFile(
    cursorPath,
    encodeRgbaPng({
      height: demoCursor.height,
      pixels,
      width: demoCursor.width
    })
  )
}

const ffmpegNumber = (value: number) => Number.isFinite(value) ? value.toFixed(3) : '0'

const smootherStep = (value: number) => {
  const progress = clamp(value, 0, 1)
  return progress * progress * progress * (progress * (progress * 6 - 15) + 10)
}

const sampleClickScale = (value: number) => {
  const progress = clamp(value / SYSTEM_CURSOR_CLICK_DURATION_MS, 0, 1)
  return 1 - (1 - SYSTEM_CURSOR_PRESS_SCALE) * progress ** 0.72
}

const sampleSystemCursorMovePoint = (
  event: SystemCursorEvent,
  timestampMs: number
): Point => {
  const durationMs = Math.max(1, event.durationMs)
  const progress = clamp((timestampMs - event.startMs) / durationMs, 0, 1)
  const dx = event.to.x - event.from.x
  const dy = event.to.y - event.from.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const perpendicularX = -dy / distance
  const perpendicularY = dx / distance
  const curveSign = Math.round(event.from.x + event.from.y + event.to.x + event.to.y) % 2 === 0 ? 1 : -1
  const curve = clamp(distance * 0.16, 14, 72) * curveSign
  const eased = smootherStep(progress)
  const arc = Math.sin(Math.PI * progress) * curve
  const micro = Math.sin(Math.PI * 3 * progress) * Math.min(2.4, Math.max(0.4, distance / 260))
  return {
    x: event.from.x + dx * eased + perpendicularX * arc + perpendicularY * micro,
    y: event.from.y + dy * eased + perpendicularY * arc - perpendicularX * micro
  }
}

const sampleSystemCursorScaleAt = (
  timeline: SystemCursorTimeline,
  timestampMs: number,
  index = 0
): number => {
  const event = timeline.events[index]
  if (event == null) return 1
  if (timestampMs < event.startMs) return 1

  if (timestampMs <= event.startMs + event.durationMs) {
    const progress = clamp((timestampMs - event.startMs) / Math.max(1, event.durationMs), 0, 1)
    if (event.action === 'move') return 1.012
    if (event.action === 'click') {
      return sampleClickScale(timestampMs - event.startMs)
    }
    if (event.action === 'release') {
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * progress)
      return SYSTEM_CURSOR_PRESS_SCALE + (1 - SYSTEM_CURSOR_PRESS_SCALE) * eased + 0.055 * Math.sin(Math.PI * progress)
    }
  }

  return sampleSystemCursorScaleAt(timeline, timestampMs, index + 1)
}

const sampleSystemCursorPointAt = (
  timeline: SystemCursorTimeline,
  timestampMs: number,
  index = 0,
  pointBefore = timeline.initialPoint
): Pick<SystemCursorFrameSample, 'action' | 'x' | 'y'> => {
  const event = timeline.events[index]
  if (event == null) {
    return {
      action: 'idle',
      ...pointBefore
    }
  }

  if (timestampMs < event.startMs) {
    return {
      action: 'idle',
      ...pointBefore
    }
  }

  if (timestampMs <= event.startMs + event.durationMs) {
    return {
      action: event.action,
      ...(event.action === 'move' ? sampleSystemCursorMovePoint(event, timestampMs) : event.to)
    }
  }

  return sampleSystemCursorPointAt(timeline, timestampMs, index + 1, event.to)
}

export const sampleSystemCursorTimeline = (input: {
  durationMs: number
  fps: number
  timeline: SystemCursorTimeline
}): SystemCursorFrameSample[] => {
  const frameIntervalMs = 1_000 / input.fps
  const sampleCount = Math.max(1, Math.ceil(input.durationMs / frameIntervalMs))
  return Array.from({ length: sampleCount }, (_value, frameIndex) => {
    const timestampMs = Math.min(input.durationMs, frameIndex * frameIntervalMs)
    return {
      frameIndex,
      scale: Number(sampleSystemCursorScaleAt(input.timeline, timestampMs).toFixed(4)),
      timestampMs,
      ...sampleSystemCursorPointAt(input.timeline, timestampMs)
    }
  })
}

export const buildSystemCursorContinuityReport = (input: {
  fps: number
  samples: SystemCursorFrameSample[]
  timeline: SystemCursorTimeline
}): SystemCursorContinuityReport => {
  const thresholds = {
    maxFrameDistanceErrorPx: 120,
    maxFrameDistanceWarningPx: 72,
    maxSpeedErrorPxPerSecond: 7_200,
    maxSpeedWarningPxPerSecond: 4_320
  }
  const issues: SystemCursorContinuityIssue[] = []
  let maxFrameDistancePx = 0
  let maxSpeedPxPerSecond = 0

  for (const [index, event] of input.timeline.events.entries()) {
    const previousEvent = input.timeline.events[index - 1]
    const expectedFrom = previousEvent?.to ?? input.timeline.initialPoint
    if (previousEvent != null) {
      const previousEndMs = previousEvent.startMs + previousEvent.durationMs
      if (event.startMs < previousEndMs - 1) {
        issues.push({
          code: 'cursor_event_overlap',
          message: `Cursor event ${index} starts ${
            (previousEndMs - event.startMs).toFixed(1)
          }ms before the previous cursor event ends.`,
          severity: 'error',
          timestampMs: event.startMs,
          value: Number((previousEndMs - event.startMs).toFixed(3))
        })
      }
    }
    const sourceDelta = Math.hypot(event.from.x - expectedFrom.x, event.from.y - expectedFrom.y)
    if (sourceDelta > 1) {
      issues.push({
        code: 'cursor_event_source_jump',
        message: `Cursor event ${index} starts ${sourceDelta.toFixed(1)}px away from the previous cursor endpoint.`,
        severity: 'error',
        timestampMs: event.startMs,
        value: Number(sourceDelta.toFixed(3))
      })
    }
  }

  for (let index = 1; index < input.samples.length; index += 1) {
    const previous = input.samples[index - 1]!
    const current = input.samples[index]!
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y)
    const elapsedSeconds = Math.max(0.001, (current.timestampMs - previous.timestampMs) / 1_000)
    const speed = distance / elapsedSeconds
    maxFrameDistancePx = Math.max(maxFrameDistancePx, distance)
    maxSpeedPxPerSecond = Math.max(maxSpeedPxPerSecond, speed)

    if (distance > thresholds.maxFrameDistanceErrorPx || speed > thresholds.maxSpeedErrorPxPerSecond) {
      issues.push({
        code: distance > thresholds.maxFrameDistanceErrorPx ? 'cursor_frame_jump' : 'cursor_speed_jump',
        frameIndex: current.frameIndex,
        message: `Cursor moved ${distance.toFixed(1)}px in one frame (${speed.toFixed(0)}px/s).`,
        severity: 'error',
        timestampMs: current.timestampMs,
        value: Number(distance.toFixed(3))
      })
    } else if (distance > thresholds.maxFrameDistanceWarningPx || speed > thresholds.maxSpeedWarningPxPerSecond) {
      issues.push({
        code: distance > thresholds.maxFrameDistanceWarningPx ? 'cursor_frame_jump' : 'cursor_speed_jump',
        frameIndex: current.frameIndex,
        message: `Cursor moved ${distance.toFixed(1)}px in one frame (${speed.toFixed(0)}px/s).`,
        severity: 'warning',
        timestampMs: current.timestampMs,
        value: Number(distance.toFixed(3))
      })
    }
  }

  return {
    fps: input.fps,
    issueCount: issues.length,
    issues,
    maxFrameDistancePx: Number(maxFrameDistancePx.toFixed(3)),
    maxSpeedPxPerSecond: Number(maxSpeedPxPerSecond.toFixed(3)),
    ok: !issues.some(issue => issue.severity === 'error'),
    sampleCount: input.samples.length,
    thresholds
  }
}

const writeSystemCursorArtifacts = async (input: {
  continuityPath: string
  durationMs: number
  fps: number
  timeline: SystemCursorTimeline | undefined
  timelinePath: string
}) => {
  if (input.timeline?.enabled !== true) {
    return undefined
  }

  const samples = sampleSystemCursorTimeline({
    durationMs: input.durationMs,
    fps: input.fps,
    timeline: input.timeline
  })
  const continuity = buildSystemCursorContinuityReport({
    fps: input.fps,
    samples,
    timeline: input.timeline
  })
  await writeFile(
    input.timelinePath,
    `${
      JSON.stringify(
        {
          durationMs: input.durationMs,
          events: input.timeline.events,
          fps: input.fps,
          initialPoint: input.timeline.initialPoint,
          samples
        },
        null,
        2
      )
    }\n`
  )
  await writeFile(input.continuityPath, `${JSON.stringify(continuity, null, 2)}\n`)
  if (!continuity.ok) {
    throw new Error(
      [
        'System cursor trajectory failed continuity checks.',
        `timeline=${input.timelinePath}`,
        `continuity=${input.continuityPath}`,
        ...continuity.issues
          .filter(issue => issue.severity === 'error')
          .slice(0, 5)
          .map(issue => `- ${issue.message}`)
      ].join('\n')
    )
  }
  return continuity
}

const buildCursorAxisExpression = (
  axis: 'x' | 'y',
  input: {
    events: SystemCursorEvent[]
    initialPoint: Point
  },
  index = 0,
  pointBefore = input.initialPoint
): string => {
  const event = input.events[index]
  if (event == null) return ffmpegNumber(pointBefore[axis])

  const start = event.startMs / 1_000
  const duration = Math.max(0.001, event.durationMs / 1_000)
  const end = start + duration
  const before = ffmpegNumber(pointBefore[axis])
  const after = buildCursorAxisExpression(axis, input, index + 1, event.to)
  const during = event.action === 'move'
    ? buildCursorMoveAxisExpression(axis, event, start, duration)
    : ffmpegNumber(event.to[axis])

  return `if(lt(t,${ffmpegNumber(start)}),${before},if(lte(t,${ffmpegNumber(end)}),${during},${after}))`
}

const buildCursorScaleExpression = (
  input: {
    events: SystemCursorEvent[]
  },
  index = 0
): string => {
  const event = input.events[index]
  if (event == null) return '1'

  const start = event.startMs / 1_000
  const duration = Math.max(0.001, event.durationMs / 1_000)
  const end = start + duration
  const after = buildCursorScaleExpression(input, index + 1)
  const during = buildCursorScaleDuringExpression(event, start, duration)
  return `if(lt(t,${ffmpegNumber(start)}),1,if(lte(t,${ffmpegNumber(end)}),${during},${after}))`
}

const buildCursorScaleDuringExpression = (
  event: SystemCursorEvent,
  start: number,
  duration: number
) => {
  const progress = `min(max((t-${ffmpegNumber(start)})/${ffmpegNumber(duration)},0),1)`
  if (event.action === 'move') return '1.012'
  if (event.action === 'click') {
    const clickProgress = `min(max((t-${ffmpegNumber(start)})/${
      ffmpegNumber(SYSTEM_CURSOR_CLICK_DURATION_MS / 1_000)
    },0),1)`
    const eased = `pow(${clickProgress},0.72)`
    return `(1-${ffmpegNumber(1 - SYSTEM_CURSOR_PRESS_SCALE)}*${eased})`
  }
  if (event.action === 'release') {
    const eased = `(0.5-0.5*cos(PI*${progress}))`
    return `(${ffmpegNumber(SYSTEM_CURSOR_PRESS_SCALE)}+${
      ffmpegNumber(1 - SYSTEM_CURSOR_PRESS_SCALE)
    }*${eased}+0.055*sin(PI*${progress}))`
  }
  return '1'
}

const buildCursorMoveAxisExpression = (
  axis: 'x' | 'y',
  event: SystemCursorEvent,
  start: number,
  duration: number
) => {
  const dx = event.to.x - event.from.x
  const dy = event.to.y - event.from.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  const perpendicularX = -dy / distance
  const perpendicularY = dx / distance
  const curveSign = Math.round(event.from.x + event.from.y + event.to.x + event.to.y) % 2 === 0 ? 1 : -1
  const curve = clamp(distance * 0.16, 14, 72) * curveSign
  const progress = `min(max((t-${ffmpegNumber(start)})/${ffmpegNumber(duration)},0),1)`
  const eased = `(${progress}*${progress}*${progress}*(${progress}*(${progress}*6-15)+10))`
  const arc = `(sin(PI*${progress})*${ffmpegNumber(curve)})`
  const micro = `(sin(PI*3*${progress})*${ffmpegNumber(Math.min(2.4, Math.max(0.4, distance / 260)))})`
  if (axis === 'x') {
    return `${ffmpegNumber(event.from.x)}+(${ffmpegNumber(dx)})*${eased}+(${ffmpegNumber(perpendicularX)})*${arc}+(${
      ffmpegNumber(perpendicularY)
    })*${micro}`
  }
  return `${ffmpegNumber(event.from.y)}+(${ffmpegNumber(dy)})*${eased}+(${ffmpegNumber(perpendicularY)})*${arc}-(${
    ffmpegNumber(perpendicularX)
  })*${micro}`
}

const overlaySystemCursorVideo = async (input: {
  ffmpegPath: string
  fps: number
  outputPath: string
  segmentsDir: string
  timeline: SystemCursorTimeline
  videoPath: string
}) => {
  const cursorPath = path.join(input.segmentsDir, 'demo-cursor.png')
  await writeDemoCursorPng(cursorPath)
  const scaleExpression = buildCursorScaleExpression(input.timeline)
  const xExpression = `(${buildCursorAxisExpression('x', input.timeline)})-${demoCursor.hotspotX}*(${scaleExpression})`
  const yExpression = `(${buildCursorAxisExpression('y', input.timeline)})-${demoCursor.hotspotY}*(${scaleExpression})`
  const result = await runCommand({
    args: [
      '-y',
      '-i',
      input.videoPath,
      '-loop',
      '1',
      '-framerate',
      String(input.fps),
      '-i',
      cursorPath,
      '-filter_complex',
      [
        `[1:v]format=rgba,scale=w='${demoCursor.width}*(${scaleExpression})':h='${demoCursor.height}*(${scaleExpression})':eval=frame[cursor]`,
        `[0:v][cursor]overlay=x='${xExpression}':y='${yExpression}':eval=frame:shortest=1:format=auto,format=yuv420p[out]`
      ].join(';'),
      '-map',
      '[out]',
      '-map',
      '0:a?',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'copy',
      input.outputPath
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed to overlay system cursor with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
}

const writeRoundedWindowCornerMask = async (input: {
  ffmpegPath: string
  maskPath: string
  size: DemoVideoViewport
}) => {
  const radius = resolveSystemWindowVideoCornerRadius(input.size)
  const result = await runCommand({
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=white:s=${input.size.width}x${input.size.height}:r=1:d=1`,
      '-vf',
      `format=gray,geq=lum='${buildRoundedWindowAlphaExpression(radius)}'`,
      '-frames:v',
      '1',
      input.maskPath
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 30_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed to create system-window rounded corner mask with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
}

const encodeSystemWindowVideo = async (input: {
  cursorTimeline?: SystemCursorTimeline
  durationMs: number
  ffmpegPath: string
  fps: number
  roundedWindowCorners?: boolean
  segmentsDir: string
  segments: SystemVideoSegment[]
  systemDisplayCrop?: DemoVideoCropRect
  videoBackgroundColor?: string
  videoBackgroundImage?: string
  videoPath: string
}) => {
  if (input.segments.length === 0) throw new Error('system recording did not produce any video segments.')
  const segmentSizes = await Promise.all(input.segments.map(async segment =>
    await readVideoDimensions({
      ffmpegPath: input.ffmpegPath,
      videoPath: segment.videoPath
    })
  ))
  const contentSize = segmentSizes.reduce<DemoVideoViewport>((current, next) => ({
    height: Math.max(current.height, next.height),
    width: Math.max(current.width, next.width)
  }), {
    height: 2,
    width: 2
  })
  const videoBackgroundImage = input.videoBackgroundImage == null
    ? undefined
    : await prepareVideoBackgroundImage({
      imagePath: input.videoBackgroundImage,
      workDir: input.segmentsDir
    })
  const needsCompositedCanvas = input.roundedWindowCorners === true ||
    input.videoBackgroundColor != null ||
    videoBackgroundImage != null ||
    input.segments.some(segment => segment.alphaMaskPath != null)
  const frameSize = input.systemDisplayCrop == null
    ? needsCompositedCanvas
      ? addSystemWindowVideoCanvasPadding(contentSize)
      : contentSize
    : {
      height: input.systemDisplayCrop.height,
      width: input.systemDisplayCrop.width
    }

  const normalizedSegmentPaths: string[] = []
  for (const [index, segment] of input.segments.entries()) {
    const segmentSize = segmentSizes[index]!
    const segmentDurationSeconds = Math.max(0.1, segment.durationMs / 1_000)
    const normalizedPath = path.join(
      input.segmentsDir,
      `normalized_${String(index + 1).padStart(4, '0')}.mp4`
    )
    const backgroundArgs = videoBackgroundImage != null
      ? [
        '-loop',
        '1',
        '-framerate',
        String(input.fps),
        '-i',
        videoBackgroundImage
      ]
      : input.videoBackgroundColor != null || input.roundedWindowCorners === true
      ? [
        '-f',
        'lavfi',
        '-i',
        `color=c=${input.videoBackgroundColor ?? 'black'}:s=${frameSize.width}x${frameSize.height}:r=${input.fps}`
      ]
      : []
    const roundedCornerMaskPath = input.roundedWindowCorners === true
      ? path.join(input.segmentsDir, `rounded-corners_${segmentSize.width}x${segmentSize.height}.png`)
      : undefined
    if (roundedCornerMaskPath != null) {
      await writeRoundedWindowCornerMask({
        ffmpegPath: input.ffmpegPath,
        maskPath: roundedCornerMaskPath,
        size: segmentSize
      })
    }
    const roundedCornerMaskArgs = roundedCornerMaskPath == null
      ? []
      : [
        '-loop',
        '1',
        '-framerate',
        String(input.fps),
        '-i',
        roundedCornerMaskPath
      ]
    const maskArgs = roundedCornerMaskPath != null || segment.alphaMaskPath == null ? [] : ['-i', segment.alphaMaskPath]
    const filterArgs = input.systemDisplayCrop != null
      ? [
        '-vf',
        `fps=${input.fps},setsar=1,crop=${input.systemDisplayCrop.width}:${input.systemDisplayCrop.height}:${input.systemDisplayCrop.x}:${input.systemDisplayCrop.y},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`
      ]
      : backgroundArgs.length === 0
      ? [
        '-vf',
        `fps=${input.fps},setsar=1,pad=${frameSize.width}:${frameSize.height}:(ow-iw)/2:(oh-ih)/2:color=${
          input.videoBackgroundColor ?? 'black'
        },scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`
      ]
      : roundedCornerMaskPath != null
      ? [
        '-filter_complex',
        `[0:v]fps=${input.fps},format=rgba,setsar=1[video];[2:v]format=gray[alpha];[video][alpha]alphamerge=shortest=1[fg];[1:v]scale=${frameSize.width}:${frameSize.height}:force_original_aspect_ratio=increase,crop=${frameSize.width}:${frameSize.height},setsar=1[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1:repeatlast=0:format=auto,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[out]`,
        '-map',
        '[out]',
        '-shortest'
      ]
      : segment.alphaMaskPath == null
      ? [
        '-filter_complex',
        `[0:v]fps=${input.fps},setsar=1[fg];[1:v]scale=${frameSize.width}:${frameSize.height}:force_original_aspect_ratio=increase,crop=${frameSize.width}:${frameSize.height},setsar=1[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1:repeatlast=0:format=auto,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[out]`,
        '-map',
        '[out]',
        '-shortest'
      ]
      : [
        '-filter_complex',
        `[0:v]fps=${input.fps},format=rgba,setsar=1[video];[2:v]scale=${segmentSize.width}:${segmentSize.height},format=rgba,alphaextract,lut=y='255*gte(val,96)'[alpha];[video][alpha]alphamerge[fg];[1:v]scale=${frameSize.width}:${frameSize.height}:force_original_aspect_ratio=increase,crop=${frameSize.width}:${frameSize.height},setsar=1[bg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1:repeatlast=0:format=auto,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[out]`,
        '-map',
        '[out]',
        '-shortest'
      ]
    const result = await runCommand({
      args: [
        '-y',
        '-i',
        segment.videoPath,
        ...backgroundArgs,
        ...roundedCornerMaskArgs,
        ...maskArgs,
        ...filterArgs,
        '-t',
        String(segmentDurationSeconds),
        '-r',
        String(input.fps),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        normalizedPath
      ],
      command: input.ffmpegPath,
      cwd: process.cwd(),
      timeoutMs: 120_000
    })
    if (result.code !== 0) {
      throw new Error(
        [
          `ffmpeg failed to normalize system recording segment with exit code ${result.code}.`,
          result.timedOut ? 'timedOut=true' : undefined,
          result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
          result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
        ].filter(Boolean).join('\n')
      )
    }
    normalizedSegmentPaths.push(normalizedPath)
  }

  const concatListPath = path.join(input.segmentsDir, 'segments.txt')
  await writeConcatList({
    listPath: concatListPath,
    segmentPaths: normalizedSegmentPaths
  })
  const baseVideoPath = input.cursorTimeline?.enabled === true
    ? path.join(input.segmentsDir, 'system-recording-base.mp4')
    : input.videoPath
  const result = await runCommand({
    args: [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-t',
      String(Math.max(1, input.durationMs / 1_000)),
      '-r',
      String(input.fps),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      baseVideoPath
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed to encode system recording video with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
  if (input.cursorTimeline?.enabled === true) {
    await overlaySystemCursorVideo({
      ffmpegPath: input.ffmpegPath,
      fps: input.fps,
      outputPath: input.videoPath,
      segmentsDir: input.segmentsDir,
      timeline: input.cursorTimeline,
      videoPath: baseVideoPath
    })
  }
}

const writePosterFromVideo = async (input: {
  ffmpegPath: string
  posterPath: string
  videoPath: string
}) => {
  const result = await runCommand({
    args: [
      '-y',
      '-i',
      input.videoPath,
      '-frames:v',
      '1',
      input.posterPath
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 60_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed to extract poster with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
  return parsePngDimensions(await readFile(input.posterPath))
}

const writeSecondStillFrames = async (input: {
  frameCount: number
  fps: number
  framesDir: string
  manifestPath: string
  stillsDir: string
}) => {
  await rm(input.stillsDir, { force: true, recursive: true })
  await rm(input.manifestPath, { force: true })
  await mkdir(input.stillsDir, { recursive: true })

  const durationMs = Math.round(input.frameCount / input.fps * 1_000)
  const stillCount = Math.max(1, Math.ceil(durationMs / 1_000))
  const stills = Array.from({ length: stillCount }, (_value, index) => {
    const timestampMs = index * 1_000
    const sourceFrameIndex = Math.min(
      input.frameCount,
      Math.max(1, Math.floor(timestampMs / 1_000 * input.fps) + 1)
    )
    return {
      imagePath: path.join(input.stillsDir, stillFileName(index)),
      index,
      sourceFrameIndex,
      timestampMs
    }
  })

  for (const still of stills) {
    await copyFile(path.join(input.framesDir, frameFileName(still.sourceFrameIndex)), still.imagePath)
  }

  const manifest = stills.map(({ imagePath, index, timestampMs }) => ({
    imagePath,
    index,
    timestampMs
  }))
  await writeFile(input.manifestPath, `${JSON.stringify({ stills: manifest }, null, 2)}\n`)
  return manifest
}

const writeSecondStillFramesFromVideo = async (input: {
  ffmpegPath: string
  manifestPath: string
  stillsDir: string
  videoPath: string
}) => {
  await rm(input.stillsDir, { force: true, recursive: true })
  await rm(input.manifestPath, { force: true })
  await mkdir(input.stillsDir, { recursive: true })
  const result = await runCommand({
    args: [
      '-y',
      '-i',
      input.videoPath,
      '-vf',
      'fps=1',
      '-start_number',
      '0',
      path.join(input.stillsDir, 'second_%04d.png')
    ],
    command: input.ffmpegPath,
    cwd: process.cwd(),
    timeoutMs: 120_000
  })
  if (result.code !== 0) {
    throw new Error(
      [
        `ffmpeg failed to extract stills with exit code ${result.code}.`,
        result.timedOut ? 'timedOut=true' : undefined,
        result.stdout.trim() === '' ? undefined : `stdout:\n${result.stdout}`,
        result.stderr.trim() === '' ? undefined : `stderr:\n${result.stderr}`
      ].filter(Boolean).join('\n')
    )
  }
  const files = (await readdir(input.stillsDir))
    .filter(file => /^second_\d{4}\.png$/u.test(file))
    .sort()
  const manifest = files.map((file, index) => ({
    imagePath: path.join(input.stillsDir, file),
    index,
    timestampMs: index * 1_000
  }))
  await writeFile(input.manifestPath, `${JSON.stringify({ stills: manifest }, null, 2)}\n`)
  return manifest
}

const shouldFollowWorkspaceWindowTargets = (scenarioId: string) =>
  scenarioId === 'launcher-open-workspace-ui-tour' ||
  scenarioId === 'launcher-open-workspace-chat-smoke'

export const recordDemoVideoScenario = async (
  scenario: DemoVideoScenario,
  options: DemoVideoRecordOptions
): Promise<DemoVideoRecordResult> => {
  const captureSource = options.captureSource ?? 'cdp'
  const fps = options.fps ?? (isSystemCaptureSource(captureSource) ? 60 : scenario.defaultFps)
  const width = options.width ?? scenario.defaultViewport.width
  const height = options.height ?? scenario.defaultViewport.height
  const durationMs = options.durationMs ?? scenario.defaultDurationMs
  const headless = options.headless ?? true
  const language = normalizeDemoVideoLanguage(options.language)
  const pageBackground = normalizeDemoVideoPageBackground(options.pageBackground)
  const colorScheme = options.colorScheme ??
    (options.cdpWebSocketDebuggerUrl != null || isSystemCaptureSource(captureSource) ? 'system' : DEFAULT_COLOR_SCHEME)
  const preserveTargetEnvironment = options.preserveTargetEnvironment ??
    (options.cdpWebSocketDebuggerUrl != null || isSystemCaptureSource(captureSource))
  const followCdpTargets = options.followCdpTargets ??
    (captureSource === 'system-window' && shouldFollowWorkspaceWindowTargets(scenario.id))
  const explicitVideoBackgroundImage = isNonEmptyString(options.videoBackgroundImage)
    ? options.videoBackgroundImage
    : undefined
  const videoBackgroundImage = explicitVideoBackgroundImage ??
    (captureSource === 'system-window'
      ? await resolveMacosWallpaperPath().catch(() => undefined)
      : undefined)
  const videoBackgroundColor = normalizeVideoBackgroundColor(
    options.videoBackgroundColor ??
      (captureSource === 'system-window' && videoBackgroundImage == null
        ? DEFAULT_SYSTEM_WINDOW_VIDEO_BACKGROUND_COLOR
        : undefined)
  )
  const systemWindowCaptureBackend = normalizeSystemWindowCaptureBackend(options.systemWindowCaptureBackend)
  const systemWindowFrameCapture = captureSource === 'system-window' && systemWindowCaptureBackend === 'frames'
  const systemWindowId = captureSource === 'system-window'
    ? await resolveSystemWindowId({
      ownerPid: options.systemWindowOwnerPid,
      windowId: options.systemWindowId
    })
    : undefined
  const systemDisplayId = options.systemDisplayId ?? 1
  const outputPaths = resolveOutputPaths({
    name: options.name,
    outDir: options.outDir,
    scenarioId: scenario.id
  })
  const ffmpegPath = await resolveFfmpegPath(options.ffmpegPath)
  await assertFfmpegUsable(ffmpegPath)
  const pageBackgroundDataUrl = await resolvePageBackgroundDataUrl({
    pageBackground,
    pageBackgroundImage: options.pageBackgroundImage
  })

  await mkdir(outputPaths.outDir, { recursive: true })
  await rm(outputPaths.framesDir, { force: true, recursive: true })
  await rm(outputPaths.videoPath, { force: true })
  await rm(outputPaths.posterPath, { force: true })
  await rm(outputPaths.segmentsDir, { force: true, recursive: true })
  await rm(outputPaths.stillsDir, { force: true, recursive: true })
  await rm(outputPaths.stillsManifestPath, { force: true })
  await rm(outputPaths.cursorTimelinePath, { force: true })
  await rm(outputPaths.cursorContinuityPath, { force: true })
  await mkdir(outputPaths.framesDir, { recursive: true })

  const chrome = options.cdpWebSocketDebuggerUrl == null
    ? await launchChrome({
      chromePath: options.chromePath,
      headless,
      language,
      viewport: { height, width }
    })
    : undefined
  const webSocketDebuggerUrl = options.cdpWebSocketDebuggerUrl ?? chrome?.webSocketDebuggerUrl
  if (webSocketDebuggerUrl == null) throw new Error('Missing CDP webSocketDebuggerUrl for demo video recording.')
  const client = await createCdpClient(webSocketDebuggerUrl)
  const cdpTargetListUrl = resolveCdpTargetListUrl(webSocketDebuggerUrl)

  let recorder: DemoVideoRecorder | undefined
  try {
    recorder = new DemoVideoRecorder(client, {
      captureSource,
      cdpTargetListUrl,
      cdpWebSocketDebuggerUrl: webSocketDebuggerUrl,
      colorScheme,
      durationMs,
      followCdpTargets,
      fps,
      framesDir: outputPaths.framesDir,
      height,
      language,
      pageBackgroundDataUrl,
      preserveTargetEnvironment,
      segmentsDir: outputPaths.segmentsDir,
      systemCursorWindowBounds: options.systemCursorWindowBounds,
      systemDisplayCrop: options.systemDisplayCrop,
      systemDisplayId,
      systemWindowFrameCapture,
      systemWindowId,
      systemWindowOwnerPid: options.systemWindowOwnerPid,
      url: options.url,
      waitForText: options.waitForText,
      waitForTextAbsent: options.waitForTextAbsent,
      waitForTextAbsentTimeoutMs: options.waitForTextAbsentTimeoutMs,
      waitForTextTimeoutMs: options.waitForTextTimeoutMs,
      workspace: options.workspace,
      width
    })
    await recorder.initialize()
    await scenario.run(recorder)
    const frameCount = recorder.getFrameCount()
    if (frameCount <= 0) throw new Error(`Scenario "${scenario.id}" did not capture any frames.`)

    const recordedDurationMs = recorder.getRecordedDurationMs()
    const systemCursorTimeline = recorder.getSystemCursorTimeline()
    const cursorContinuity = await writeSystemCursorArtifacts({
      continuityPath: outputPaths.cursorContinuityPath,
      durationMs: recordedDurationMs,
      fps,
      timeline: systemCursorTimeline,
      timelinePath: outputPaths.cursorTimelinePath
    })
    let frameSize = recorder.getFrameSize()
    let stills: Awaited<ReturnType<typeof writeSecondStillFrames>>
    if (isSystemCaptureSource(captureSource) && !systemWindowFrameCapture) {
      await encodeSystemWindowVideo({
        cursorTimeline: systemCursorTimeline,
        durationMs: recordedDurationMs,
        ffmpegPath,
        fps,
        roundedWindowCorners: captureSource === 'system-window',
        segmentsDir: outputPaths.segmentsDir,
        segments: recorder.getSystemVideoSegments(),
        systemDisplayCrop: captureSource === 'system-display' ? options.systemDisplayCrop : undefined,
        videoBackgroundColor,
        videoBackgroundImage,
        videoPath: outputPaths.videoPath
      })
      frameSize = await writePosterFromVideo({
        ffmpegPath,
        posterPath: outputPaths.posterPath,
        videoPath: outputPaths.videoPath
      })
      stills = await writeSecondStillFramesFromVideo({
        ffmpegPath,
        manifestPath: outputPaths.stillsManifestPath,
        stillsDir: outputPaths.stillsDir,
        videoPath: outputPaths.videoPath
      })
    } else if (systemWindowFrameCapture) {
      await encodeVideo({
        durationMs: recorder.getRecordedDurationMs(),
        ffmpegPath,
        fps,
        frameSize,
        framesDir: outputPaths.framesDir,
        videoBackgroundColor,
        videoBackgroundImage,
        videoPath: outputPaths.videoPath
      })
      frameSize = await writePosterFromVideo({
        ffmpegPath,
        posterPath: outputPaths.posterPath,
        videoPath: outputPaths.videoPath
      })
      stills = await writeSecondStillFramesFromVideo({
        ffmpegPath,
        manifestPath: outputPaths.stillsManifestPath,
        stillsDir: outputPaths.stillsDir,
        videoPath: outputPaths.videoPath
      })
    } else {
      await copyFile(path.join(outputPaths.framesDir, frameFileName(1)), outputPaths.posterPath)
      stills = await writeSecondStillFrames({
        fps,
        frameCount,
        framesDir: outputPaths.framesDir,
        manifestPath: outputPaths.stillsManifestPath,
        stillsDir: outputPaths.stillsDir
      })
      await encodeVideo({
        ffmpegPath,
        fps,
        frameSize,
        framesDir: outputPaths.framesDir,
        videoPath: outputPaths.videoPath
      })
    }
    if (options.keepFrames !== true) {
      await rm(outputPaths.framesDir, { force: true, recursive: true })
      await rm(outputPaths.segmentsDir, { force: true, recursive: true })
    }
    return {
      colorScheme,
      durationMs: isSystemCaptureSource(captureSource)
        ? recordedDurationMs
        : Math.round(frameCount / fps * 1_000),
      fps,
      frameCount,
      framesDir: outputPaths.framesDir,
      height: frameSize?.height ?? height,
      keptFrames: options.keepFrames === true,
      ...(language == null ? {} : { language }),
      ...(cursorContinuity == null
        ? {}
        : {
          cursorContinuityPath: outputPaths.cursorContinuityPath,
          cursorTimelinePath: outputPaths.cursorTimelinePath
        }),
      posterPath: outputPaths.posterPath,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      stillFramePaths: stills.map(still => still.imagePath),
      stills,
      stillsDir: outputPaths.stillsDir,
      stillsManifestPath: outputPaths.stillsManifestPath,
      videoPath: outputPaths.videoPath,
      width: frameSize?.width ?? width
    }
  } finally {
    if (recorder != null) {
      await recorder.close()
    } else {
      client.close()
    }
    await chrome?.close()
  }
}
