/* eslint-disable max-lines -- record-batch coordinates macOS display capture, app launch, and video evidence in one CLI boundary. */
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { recordDemoVideoScenario } from './demo-video/recorder'
import { getDemoVideoScenario } from './demo-video/scenarios'
import type {
  DemoVideoBatchResult,
  DemoVideoColorScheme,
  DemoVideoCropRect,
  DemoVideoRecordResult,
  DemoVideoSystemCursorWindowBounds
} from './demo-video/types'
import type { DesktopCdpLaunchInput, DesktopCdpLaunchResult } from './desktop-cdp'
import { runDesktopCdpLaunch } from './desktop-cdp'

const DEFAULT_BATCH_COLOR_SCHEMES: DemoVideoColorScheme[] = ['light', 'dark']
const DEFAULT_BATCH_LANGUAGES = ['zh', 'en']
const DEFAULT_DESKPAD_DISPLAY_NAME = 'DeskPad Display'
const DEFAULT_DESKPAD_VIDEO_BACKGROUND_RELATIVE_PATH = path.join(
  '.logs',
  'demo-videos',
  'display-region-prototype',
  'ventura-graphic-light-hq',
  'ventura-background-full-3174x2232.png'
)
const DEFAULT_DESKPAD_VIDEO_BACKGROUND_FALLBACK_PATH =
  '/System/Library/Desktop Pictures/.thumbnails/Ventura Graphic Light.heic'
const execFile = promisify(execFileCallback)

interface DesktopRecordingBounds {
  height: number
  width: number
  x: number
  y: number
}

interface DesktopRecordingMacWindow {
  height: number
  id: number
  ownerName: string
  ownerPid: number
  title: string
  width: number
  x: number
  y: number
}

interface RecordableDebugTarget {
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

export interface MacosWindowVisibilityMetrics {
  cropHeight: number
  cropWidth: number
  edgeFeaturePixelRatio: number
  edgeMeanDiff: number
  edgeOverlapRatio: number
  meanRgbDiff: number
  sampleHeight: number
  sampleWidth: number
  similarPixelRatio: number
  windowHeight: number
  windowWidth: number
}

export interface DesktopRecordingDisplayInfo {
  frame: DesktopRecordingBounds
  id: number
  localizedName: string
  screencaptureDisplayId: number
  visibleFrame: DesktopRecordingBounds
}

interface DesktopRecordingWindowBounds {
  launcher: DesktopRecordingBounds
  outputCrop: DemoVideoCropRect
  workspace: DesktopRecordingBounds
}

export interface DesktopControlRecordBatchOptions {
  allowUnsupportedApp?: boolean
  appPath: string
  colorSchemes?: DemoVideoColorScheme[]
  durationMs?: number
  executable?: string
  ffmpegPath?: string
  followCdpTargets?: boolean
  fps?: number
  height?: number
  json?: boolean
  keepFrames?: boolean
  languages?: string[]
  name?: string
  outDir?: string
  preserveTargetEnvironment?: boolean
  recordingDisplayName?: string
  scenarioId: string
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  useDeskpadDisplay?: boolean
  videoBackgroundImage?: string
  waitMs?: number
  width?: number
  workspace?: string
}

export interface DesktopControlRecordBatchVariant {
  colorScheme: DemoVideoColorScheme
  language: string
  launch: Pick<DesktopCdpLaunchResult, 'appPath' | 'endpoint' | 'pid' | 'port' | 'userDataDir'>
  result: DemoVideoRecordResult
  variantId: string
}

export interface DesktopControlRecordBatchResult extends Omit<DemoVideoBatchResult, 'variants'> {
  recordingDisplay?: {
    backgroundImage: string
    display: DesktopRecordingDisplayInfo
    windowBounds: DesktopRecordingWindowBounds
  }
  variants: DesktopControlRecordBatchVariant[]
}

export interface DesktopControlRecordBatchDeps {
  killProcess: (pid: number) => void
  launchDesktop: (input: DesktopCdpLaunchInput) => Promise<DesktopCdpLaunchResult>
  resolveRecordingDisplay: (displayName: string) => Promise<DesktopRecordingDisplayInfo | undefined>
  startDisplayBackground: (input: DesktopRecordingDisplayBackgroundInput) => Promise<DesktopRecordingDisplayBackground>
  startDisplayKeepAwake: () => Promise<DesktopRecordingDisplayKeepAwake>
}

const defaultDeps: DesktopControlRecordBatchDeps = {
  killProcess: (pid) => {
    process.kill(pid)
  },
  launchDesktop: async input =>
    await runDesktopCdpLaunch({
      ...input,
      json: true,
      stdout: {
        write: () => true
      }
    }),
  resolveRecordingDisplay: async displayName => await resolveMacosRecordingDisplay(displayName),
  startDisplayBackground: async input => await startDesktopRecordingDisplayBackground(input),
  startDisplayKeepAwake: async () => await startMacosRecordingDisplayKeepAwake()
}

interface DesktopRecordingDisplayBackgroundInput {
  display: DesktopRecordingDisplayInfo
  imagePath: string
}

interface DesktopRecordingDisplayBackground {
  imagePath: string
  stop: () => Promise<void>
}

interface DesktopRecordingDisplayKeepAwake {
  stop: () => Promise<void>
}

const macosScreenListScript = `
import AppKit
import Foundation

struct ScreenRect: Codable {
  let height: Double
  let width: Double
  let x: Double
  let y: Double
}

struct ScreenInfo: Codable {
  let frame: ScreenRect
  let id: Int
  let localizedName: String
  let screencaptureDisplayId: Int
  let visibleFrame: ScreenRect
}

func convert(_ rect: NSRect) -> ScreenRect {
  return ScreenRect(
    height: Double(rect.height),
    width: Double(rect.width),
    x: Double(rect.origin.x),
    y: Double(rect.origin.y)
  )
}

let screens = NSScreen.screens.enumerated().map { index, screen in
  let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
  return ScreenInfo(
    frame: convert(screen.frame),
    id: screenNumber?.intValue ?? 0,
    localizedName: screen.localizedName,
    screencaptureDisplayId: index + 1,
    visibleFrame: convert(screen.visibleFrame)
  )
}

let data = try JSONEncoder().encode(screens)
print(String(data: data, encoding: .utf8)!)
`

const macosWindowListScript = `
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

const macosWindowVisibilityMetricScript = `
import CoreGraphics
import Foundation
import ImageIO

struct Metrics: Codable {
  let cropHeight: Int
  let cropWidth: Int
  let edgeFeaturePixelRatio: Double
  let edgeMeanDiff: Double
  let edgeOverlapRatio: Double
  let meanRgbDiff: Double
  let sampleHeight: Int
  let sampleWidth: Int
  let similarPixelRatio: Double
  let windowHeight: Int
  let windowWidth: Int
}

enum ProbeError: Error {
  case imageLoadFailed(String)
  case imageCropFailed(String)
  case bitmapContextFailed
}

func loadImage(_ path: String) throws -> CGImage {
  let url = URL(fileURLWithPath: path)
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw ProbeError.imageLoadFailed(path)
  }
  return image
}

func insetImage(_ image: CGImage, ratio: CGFloat) throws -> CGImage {
  let insetX = CGFloat(image.width) * ratio
  let insetY = CGFloat(image.height) * ratio
  let rect = CGRect(
    x: insetX,
    y: insetY,
    width: max(1, CGFloat(image.width) - insetX * 2),
    height: max(1, CGFloat(image.height) - insetY * 2)
  ).integral
  guard let cropped = image.cropping(to: rect) else {
    throw ProbeError.imageCropFailed("\\(image.width)x\\(image.height)")
  }
  return cropped
}

func renderRgba(_ image: CGImage, width: Int, height: Int) throws -> [UInt8] {
  var data = [UInt8](repeating: 0, count: width * height * 4)
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
  try data.withUnsafeMutableBytes { buffer in
    guard let baseAddress = buffer.baseAddress else {
      throw ProbeError.bitmapContextFailed
    }
    guard
      let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
      )
    else {
      throw ProbeError.bitmapContextFailed
    }
    context.interpolationQuality = .medium
    context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
  }
  return data
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 2 else {
  fputs("Expected windowPath cropPath\\n", stderr)
  exit(2)
}

let sampleWidth = 160
let sampleHeight = 120
let insetRatio: CGFloat = 0.08
let windowImage = try loadImage(args[0])
let cropImage = try loadImage(args[1])
let windowPixels = try renderRgba(
  try insetImage(windowImage, ratio: insetRatio),
  width: sampleWidth,
  height: sampleHeight
)
let cropPixels = try renderRgba(
  try insetImage(cropImage, ratio: insetRatio),
  width: sampleWidth,
  height: sampleHeight
)

func luma(_ pixels: [UInt8], _ x: Int, _ y: Int) -> Double {
  let offset = (y * sampleWidth + x) * 4
  return Double(pixels[offset]) * 0.2126 +
    Double(pixels[offset + 1]) * 0.7152 +
    Double(pixels[offset + 2]) * 0.0722
}

func edgeStrength(_ pixels: [UInt8], _ x: Int, _ y: Int) -> Double {
  let value = luma(pixels, x, y)
  return abs(luma(pixels, x + 1, y) - value) + abs(luma(pixels, x, y + 1) - value)
}

var similarPixels = 0
var totalDiff = 0.0
let pixelCount = sampleWidth * sampleHeight
let edgePixelCount = (sampleWidth - 1) * (sampleHeight - 1)
let windowEdgeThreshold = 18.0
let cropEdgeThreshold = 10.0
var windowEdgeFeaturePixels = 0
var overlappingEdgeFeaturePixels = 0
var totalEdgeDiff = 0.0

for pixelIndex in 0..<pixelCount {
  let offset = pixelIndex * 4
  let redDiff = abs(Int(windowPixels[offset]) - Int(cropPixels[offset]))
  let greenDiff = abs(Int(windowPixels[offset + 1]) - Int(cropPixels[offset + 1]))
  let blueDiff = abs(Int(windowPixels[offset + 2]) - Int(cropPixels[offset + 2]))
  let pixelDiff = Double(redDiff + greenDiff + blueDiff) / 3.0
  totalDiff += pixelDiff
  if pixelDiff <= 18.0 {
    similarPixels += 1
  }
}

for y in 0..<(sampleHeight - 1) {
  for x in 0..<(sampleWidth - 1) {
    let windowEdge = edgeStrength(windowPixels, x, y)
    let cropEdge = edgeStrength(cropPixels, x, y)
    totalEdgeDiff += abs(windowEdge - cropEdge)
    if windowEdge >= windowEdgeThreshold {
      windowEdgeFeaturePixels += 1
      if cropEdge >= cropEdgeThreshold {
        overlappingEdgeFeaturePixels += 1
      }
    }
  }
}

let metrics = Metrics(
  cropHeight: cropImage.height,
  cropWidth: cropImage.width,
  edgeFeaturePixelRatio: Double(windowEdgeFeaturePixels) / Double(edgePixelCount),
  edgeMeanDiff: totalEdgeDiff / Double(edgePixelCount),
  edgeOverlapRatio: windowEdgeFeaturePixels == 0
    ? 0
    : Double(overlappingEdgeFeaturePixels) / Double(windowEdgeFeaturePixels),
  meanRgbDiff: totalDiff / Double(pixelCount),
  sampleHeight: sampleHeight,
  sampleWidth: sampleWidth,
  similarPixelRatio: Double(similarPixels) / Double(pixelCount),
  windowHeight: windowImage.height,
  windowWidth: windowImage.width
)
let data = try JSONEncoder().encode(metrics)
print(String(data: data, encoding: .utf8)!)
`

const recordingDisplayBackgroundWindowScript = `
import AppKit
import CoreGraphics
import Foundation

final class BackgroundWindow: NSWindow {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 6 else {
  fputs("Expected imagePath x y width height readyFile\\n", stderr)
  exit(2)
}

let imagePath = args[0]
guard
  let x = Double(args[1]),
  let y = Double(args[2]),
  let width = Double(args[3]),
  let height = Double(args[4])
else {
  fputs("Invalid display frame arguments\\n", stderr)
  exit(2)
}
let readyFile = args[5]

guard let image = NSImage(contentsOfFile: imagePath) else {
  fputs("Failed to load background image: \\(imagePath)\\n", stderr)
  exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let frame = NSRect(x: x, y: y, width: width, height: height)
let window = BackgroundWindow(
  contentRect: frame,
  styleMask: [.borderless],
  backing: .buffered,
  defer: false
)
window.backgroundColor = .black
window.collectionBehavior = [.stationary, .ignoresCycle]
window.hasShadow = false
window.ignoresMouseEvents = true
window.isOpaque = true
window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))

let imageView = NSImageView(frame: NSRect(x: 0, y: 0, width: width, height: height))
imageView.autoresizingMask = [.width, .height]
imageView.image = image
imageView.imageAlignment = .alignCenter
imageView.imageScaling = .scaleAxesIndependently
window.contentView = imageView
window.setFrame(frame, display: true)
window.orderFrontRegardless()

try? FileManager.default.createDirectory(
  atPath: (readyFile as NSString).deletingLastPathComponent,
  withIntermediateDirectories: true
)
FileManager.default.createFile(atPath: readyFile, contents: Data(), attributes: nil)

app.run()
`

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const normalizeBounds = (value: unknown): DesktopRecordingBounds | undefined => {
  if (value == null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (
    !isFiniteNumber(record.height) ||
    !isFiniteNumber(record.width) ||
    !isFiniteNumber(record.x) ||
    !isFiniteNumber(record.y)
  ) {
    return undefined
  }

  return {
    height: Math.round(record.height),
    width: Math.round(record.width),
    x: Math.round(record.x),
    y: Math.round(record.y)
  }
}

const normalizeDisplayInfo = (value: unknown): DesktopRecordingDisplayInfo | undefined => {
  if (value == null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const frame = normalizeBounds(record.frame)
  const visibleFrame = normalizeBounds(record.visibleFrame)
  if (
    frame == null ||
    visibleFrame == null ||
    !isFiniteNumber(record.id) ||
    !isFiniteNumber(record.screencaptureDisplayId) ||
    typeof record.localizedName !== 'string' ||
    record.localizedName.trim() === ''
  ) {
    return undefined
  }

  return {
    frame,
    id: Math.round(record.id),
    localizedName: record.localizedName,
    screencaptureDisplayId: Math.round(record.screencaptureDisplayId),
    visibleFrame
  }
}

const normalizeMacWindow = (value: unknown): DesktopRecordingMacWindow | undefined => {
  if (value == null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (
    !isFiniteNumber(record.height) ||
    !isFiniteNumber(record.id) ||
    !isFiniteNumber(record.ownerPid) ||
    !isFiniteNumber(record.width) ||
    !isFiniteNumber(record.x) ||
    !isFiniteNumber(record.y) ||
    typeof record.ownerName !== 'string' ||
    typeof record.title !== 'string'
  ) {
    return undefined
  }

  return {
    height: Math.round(record.height),
    id: Math.round(record.id),
    ownerName: record.ownerName,
    ownerPid: Math.round(record.ownerPid),
    title: record.title,
    width: Math.round(record.width),
    x: Math.round(record.x),
    y: Math.round(record.y)
  }
}

const normalizeMacosWindowVisibilityMetrics = (
  value: unknown
): MacosWindowVisibilityMetrics | undefined => {
  if (value == null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (
    !isFiniteNumber(record.cropHeight) ||
    !isFiniteNumber(record.cropWidth) ||
    !isFiniteNumber(record.edgeFeaturePixelRatio) ||
    !isFiniteNumber(record.edgeMeanDiff) ||
    !isFiniteNumber(record.edgeOverlapRatio) ||
    !isFiniteNumber(record.meanRgbDiff) ||
    !isFiniteNumber(record.sampleHeight) ||
    !isFiniteNumber(record.sampleWidth) ||
    !isFiniteNumber(record.similarPixelRatio) ||
    !isFiniteNumber(record.windowHeight) ||
    !isFiniteNumber(record.windowWidth)
  ) {
    return undefined
  }

  return {
    cropHeight: Math.round(record.cropHeight),
    cropWidth: Math.round(record.cropWidth),
    edgeFeaturePixelRatio: record.edgeFeaturePixelRatio,
    edgeMeanDiff: record.edgeMeanDiff,
    edgeOverlapRatio: record.edgeOverlapRatio,
    meanRgbDiff: record.meanRgbDiff,
    sampleHeight: Math.round(record.sampleHeight),
    sampleWidth: Math.round(record.sampleWidth),
    similarPixelRatio: record.similarPixelRatio,
    windowHeight: Math.round(record.windowHeight),
    windowWidth: Math.round(record.windowWidth)
  }
}

export const listMacosRecordingDisplays = async (): Promise<DesktopRecordingDisplayInfo[]> => {
  if (process.platform !== 'darwin') return []
  const result = await execFile('swift', ['-e', macosScreenListScript], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10_000
  })
  const parsed = JSON.parse(String(result.stdout))
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap(item => {
    const display = normalizeDisplayInfo(item)
    return display == null ? [] : [display]
  })
}

export const resolveMacosRecordingDisplay = async (
  displayName: string
): Promise<DesktopRecordingDisplayInfo | undefined> => {
  const normalizedName = displayName.trim().toLowerCase()
  if (normalizedName === '') return undefined
  const displays = await listMacosRecordingDisplays()
  return displays.find(display => display.localizedName.toLowerCase() === normalizedName) ??
    displays.find(display => display.localizedName.toLowerCase().includes(normalizedName))
}

const listMacosWindowsForOwnerPid = async (ownerPid: number) => {
  if (process.platform !== 'darwin') return []
  const result = await execFile('swift', ['-e', macosWindowListScript, String(ownerPid)], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10_000
  })
  const parsed = JSON.parse(String(result.stdout))
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap(item => {
    const window = normalizeMacWindow(item)
    return window == null ? [] : [window]
  })
}

export const isMacosWindowVisibilityMetricAcceptable = (
  metrics: Pick<
    MacosWindowVisibilityMetrics,
    'edgeFeaturePixelRatio' | 'edgeMeanDiff' | 'edgeOverlapRatio' | 'meanRgbDiff' | 'similarPixelRatio'
  >
) =>
  metrics.similarPixelRatio >= 0.55 ||
  metrics.meanRgbDiff <= 30 ||
  (
    metrics.edgeFeaturePixelRatio >= 0.008 &&
    metrics.edgeOverlapRatio >= 0.4 &&
    metrics.edgeMeanDiff <= 18
  )

export const measureMacosWindowVisibility = async (input: {
  cropPath: string
  windowPath: string
}): Promise<MacosWindowVisibilityMetrics> => {
  const result = await execFile('swift', [
    '-e',
    macosWindowVisibilityMetricScript,
    input.windowPath,
    input.cropPath
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10_000
  })
  const metrics = normalizeMacosWindowVisibilityMetrics(JSON.parse(String(result.stdout)))
  if (metrics == null) {
    throw new Error(`Unable to parse macOS window visibility metrics: ${result.stdout}`)
  }
  return metrics
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const toEven = (value: number) => value % 2 === 0 ? value : value - 1

const centerBounds = (
  area: DesktopRecordingBounds,
  width: number,
  height: number
): DesktopRecordingBounds => ({
  height,
  width,
  x: Math.round(area.x + (area.width - width) / 2),
  y: Math.round(area.y + (area.height - height) / 2)
})

export const resolveRecordingDisplayOutputCrop = (
  display: DesktopRecordingDisplayInfo,
  bounds: DesktopRecordingBounds,
  padding = 120
): DemoVideoCropRect => {
  const rawX = Math.round(bounds.x - display.frame.x - padding)
  const x = clamp(rawX, 0, Math.max(0, display.frame.width - 2))
  const boundsTop = Math.round(display.frame.y + display.frame.height - bounds.y - bounds.height)
  const rawY = Math.round(boundsTop - padding)
  const y = clamp(rawY, 0, Math.max(0, display.frame.height - 2))
  const width = toEven(clamp(Math.round(bounds.width + padding * 2), 2, display.frame.width - x))
  const height = toEven(clamp(Math.round(bounds.height + padding * 2), 2, display.frame.height - y))

  return {
    height,
    width,
    x,
    y
  }
}

export const resolveRecordingWindowBounds = (
  display: DesktopRecordingDisplayInfo
): DesktopRecordingWindowBounds => {
  const area = display.visibleFrame.width > 0 && display.visibleFrame.height > 0
    ? display.visibleFrame
    : display.frame
  const workspaceWidth = Math.round(clamp(area.width - 240, 1280, 1680))
  const maxWorkspaceHeight = Math.min(1080, Math.max(720, area.height - 120))
  const workspaceHeight = Math.round(clamp(Math.round(workspaceWidth * 0.625), 900, maxWorkspaceHeight))
  const launcherWidth = Math.round(clamp(760, 420, Math.max(420, area.width - 160)))
  const launcherHeight = Math.round(clamp(560, 420, Math.max(420, area.height - 160)))
  const workspace = centerBounds(area, workspaceWidth, workspaceHeight)

  return {
    launcher: centerBounds(area, launcherWidth, launcherHeight),
    outputCrop: resolveRecordingDisplayOutputCrop(display, workspace),
    workspace
  }
}

const formatElectronBoundsEnv = (
  display: DesktopRecordingDisplayInfo,
  bounds: DesktopRecordingBounds
) => (
  `${bounds.x},${
    Math.round(display.frame.y + display.frame.height - bounds.y - bounds.height)
  },${bounds.width},${bounds.height}`
)

const toDisplayTopOriginBounds = (
  display: DesktopRecordingDisplayInfo,
  bounds: DesktopRecordingBounds
): DemoVideoCropRect => ({
  height: bounds.height,
  width: bounds.width,
  x: Math.round(bounds.x - display.frame.x),
  y: Math.round(display.frame.y + display.frame.height - bounds.y - bounds.height)
})

const resolveSystemCursorWindowBounds = (
  display: DesktopRecordingDisplayInfo,
  bounds: DesktopRecordingWindowBounds
): DemoVideoSystemCursorWindowBounds => ({
  launcher: toDisplayTopOriginBounds(display, bounds.launcher),
  workspace: toDisplayTopOriginBounds(display, bounds.workspace)
})

const resolveRecordingDisplayConfig = async (
  options: DesktopControlRecordBatchOptions,
  deps: DesktopControlRecordBatchDeps
) => {
  const displayName = options.recordingDisplayName ??
    (options.useDeskpadDisplay === true ? DEFAULT_DESKPAD_DISPLAY_NAME : undefined)
  if (displayName == null || displayName.trim() === '') return undefined
  const display = await deps.resolveRecordingDisplay(displayName)
  if (display == null) {
    throw new Error(
      `Recording display "${displayName}" was not found. Start DeskPad or pass --recording-display-name with an available macOS display.`
    )
  }

  const windowBounds = resolveRecordingWindowBounds(display)
  return {
    display,
    env: {
      ONEWORKS_DESKTOP_LAUNCHER_WINDOW_BOUNDS: formatElectronBoundsEnv(display, windowBounds.launcher),
      ONEWORKS_DESKTOP_WORKSPACE_WINDOW_BOUNDS: formatElectronBoundsEnv(display, windowBounds.workspace)
    },
    systemCursorWindowBounds: resolveSystemCursorWindowBounds(display, windowBounds),
    windowBounds
  }
}

export const resolveDesktopRecordingVideoBackgroundImage = (
  options: Pick<DesktopControlRecordBatchOptions, 'useDeskpadDisplay' | 'videoBackgroundImage'>
) => {
  if (options.videoBackgroundImage != null && options.videoBackgroundImage.trim() !== '') {
    return options.videoBackgroundImage
  }

  const localDefaultPath = path.resolve(process.cwd(), DEFAULT_DESKPAD_VIDEO_BACKGROUND_RELATIVE_PATH)
  if (existsSync(localDefaultPath)) return localDefaultPath
  return DEFAULT_DESKPAD_VIDEO_BACKGROUND_FALLBACK_PATH
}

const waitForFile = async (filePath: string, timeoutMs: number) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for recording display background: ${filePath}`)
}

const startMacosRecordingDisplayKeepAwake = async (): Promise<DesktopRecordingDisplayKeepAwake> => {
  if (process.platform !== 'darwin') {
    return {
      stop: async () => {}
    }
  }

  const child = spawn('caffeinate', ['-d', '-i'], {
    detached: true,
    stdio: 'ignore'
  })

  return {
    stop: async () => {
      if (child.pid != null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          // The helper may already have exited.
        }
      }
      await delay(250)
      if (child.pid != null) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The helper may already have exited.
        }
      }
    }
  }
}

const assertMacosScreencaptureDisplayAvailable = async (
  display: DesktopRecordingDisplayInfo
) => {
  if (process.platform !== 'darwin') return
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-display-probe-'))
  const probePath = path.join(tempDir, 'probe.png')
  try {
    try {
      await execFile('screencapture', [
        '-D',
        String(display.screencaptureDisplayId),
        '-x',
        probePath
      ], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 10_000
      })
    } catch (error) {
      const output = error as { stderr?: unknown; stdout?: unknown }
      const stdout = typeof output.stdout === 'string' ? output.stdout : ''
      const stderr = typeof output.stderr === 'string' ? output.stderr : ''
      throw new Error(
        [
          `Recording display "${display.localizedName}" is visible to AppKit but is not available to macOS screencapture as display ${display.screencaptureDisplayId}.`,
          'Wake or restart the virtual display, then retry record-batch.',
          stdout.trim() === '' ? undefined : `stdout:\n${stdout}`,
          stderr.trim() === '' ? undefined : `stderr:\n${stderr}`
        ].filter(Boolean).join('\n')
      )
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

const ensureMacosScreencaptureDisplayAvailable = async (
  display: DesktopRecordingDisplayInfo
) => {
  try {
    await assertMacosScreencaptureDisplayAvailable(display)
  } catch (firstError) {
    if (process.platform !== 'darwin') throw firstError
    try {
      await execFile('caffeinate', ['-u', '-t', '2'], {
        timeout: 5_000
      })
      await delay(500)
      await assertMacosScreencaptureDisplayAvailable(display)
    } catch {
      throw firstError
    }
  }
}

const assertMacosDisplayCaptureContainsAppWindow = async (input: {
  display: DesktopRecordingDisplayInfo
  ownerPid: number
}) => {
  if (process.platform !== 'darwin') return
  const windows = await listMacosWindowsForOwnerPid(input.ownerPid)
  const window = windows[0]
  if (window == null) {
    throw new Error(`Electron pid ${input.ownerPid} has no visible macOS window for display-capture validation.`)
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-window-visibility-'))
  const displayPath = path.join(tempDir, 'display.png')
  const windowPath = path.join(tempDir, 'window.png')
  const cropPath = path.join(tempDir, 'display-window-crop.png')
  const cropX = Math.round(window.x - input.display.frame.x)
  const cropY = Math.max(0, Math.round(window.y))
  let keepProbe = false

  try {
    await execFile('screencapture', [
      '-D',
      String(input.display.screencaptureDisplayId),
      '-x',
      displayPath
    ], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000
    })
    await execFile('screencapture', [
      '-x',
      '-o',
      '-l',
      String(window.id),
      windowPath
    ], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000
    })
    await execFile('sips', [
      '--cropToHeightWidth',
      String(window.height),
      String(window.width),
      '--cropOffset',
      String(cropY),
      String(cropX),
      displayPath,
      '--out',
      cropPath
    ], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000
    })

    const metrics = await measureMacosWindowVisibility({
      cropPath,
      windowPath
    })
    if (!isMacosWindowVisibilityMetricAcceptable(metrics)) {
      keepProbe = true
      throw new Error(
        [
          `Recording display "${input.display.localizedName}" is capturable, but its display frame did not visually match the Electron window at the expected crop.`,
          `window=${window.ownerName}/${window.title} id=${window.id} bounds=${window.x},${window.y},${window.width},${window.height}`,
          `displayCrop=${cropX},${cropY},${window.width},${window.height}`,
          `visibilityMetrics=similarPixelRatio:${metrics.similarPixelRatio.toFixed(3)} meanRgbDiff:${
            metrics.meanRgbDiff.toFixed(1)
          } edgeFeaturePixelRatio:${metrics.edgeFeaturePixelRatio.toFixed(3)} edgeOverlapRatio:${
            metrics.edgeOverlapRatio.toFixed(3)
          } edgeMeanDiff:${
            metrics.edgeMeanDiff.toFixed(1)
          } window:${metrics.windowWidth}x${metrics.windowHeight} crop:${metrics.cropWidth}x${metrics.cropHeight}`,
          `probeDir=${tempDir}`,
          'Refusing to produce a wallpaper-only or wrong-display video.'
        ].join('\n')
      )
    }
  } finally {
    if (!keepProbe) {
      await rm(tempDir, { force: true, recursive: true })
    }
  }
}

const hideDeskpadHostApp = async (displayName: string) => {
  if (process.platform !== 'darwin') return
  if (!displayName.toLowerCase().includes('deskpad')) return
  try {
    await execFile('osascript', [
      '-e',
      'tell application "System Events" to set visible of every process whose name is "DeskPad" to false'
    ], {
      timeout: 5_000
    })
  } catch {
    // Best effort only: lack of Accessibility permission must not block recording.
  }
}

const startDesktopRecordingDisplayBackground = async (
  input: DesktopRecordingDisplayBackgroundInput
): Promise<DesktopRecordingDisplayBackground> => {
  if (process.platform !== 'darwin') {
    throw new Error('Desktop record-batch display recording is only supported on macOS.')
  }

  await hideDeskpadHostApp(input.display.localizedName)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-recording-background-'))
  const readyFile = path.join(tempDir, 'ready')
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  const child = spawn('swift', [
    '-e',
    recordingDisplayBackgroundWindowScript,
    input.imagePath,
    String(input.display.frame.x),
    String(input.display.frame.y),
    String(input.display.frame.width),
    String(input.display.frame.height),
    readyFile
  ], {
    detached: true,
    stdio: 'ignore'
  })
  child.once('exit', (code, signal) => {
    exited = { code, signal }
  })

  try {
    await waitForFile(readyFile, 15_000)
    if (exited != null) {
      throw new Error(
        `Recording display background exited before it became usable: code=${exited.code} signal=${exited.signal}`
      )
    }
  } catch (error) {
    if (child.pid != null) {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Ignore cleanup races.
      }
    }
    await rm(tempDir, { force: true, recursive: true })
    throw error
  }

  return {
    imagePath: input.imagePath,
    stop: async () => {
      if (child.pid != null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          // The helper may already have exited.
        }
      }
      await delay(250)
      if (child.pid != null && exited == null) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The helper may already have exited.
        }
      }
      await rm(tempDir, { force: true, recursive: true })
    }
  }
}

const findRecordableTarget = (
  targets: ReadonlyArray<RecordableDebugTarget>
) =>
  targets.find(target =>
    target.type === 'page' &&
    typeof target.url === 'string' &&
    target.url.trim() !== '' &&
    typeof target.webSocketDebuggerUrl === 'string' &&
    target.webSocketDebuggerUrl.trim() !== '' &&
    !target.url.startsWith('about:') &&
    !target.url.startsWith('data:') &&
    !target.url.startsWith('devtools:')
  )

export const runDesktopControlRecordBatch = async (
  options: DesktopControlRecordBatchOptions,
  deps: Partial<DesktopControlRecordBatchDeps> = {}
): Promise<DesktopControlRecordBatchResult> => {
  const resolvedDeps = {
    ...defaultDeps,
    ...deps
  }
  const scenario = getDemoVideoScenario(options.scenarioId)
  const colorSchemes = options.colorSchemes ?? DEFAULT_BATCH_COLOR_SCHEMES
  const languages = options.languages ?? DEFAULT_BATCH_LANGUAGES
  const variants: DesktopControlRecordBatchVariant[] = []
  const outputRoot = options.outDir ?? path.join('.logs/demo-videos', 'electron', scenario.id)
  const followCdpTargets = options.followCdpTargets ?? scenario.followCdpTargets ?? false
  const preserveTargetEnvironment = options.preserveTargetEnvironment ?? true
  const recordingDisplayConfig = await resolveRecordingDisplayConfig(options, resolvedDeps)
  if (recordingDisplayConfig == null) {
    throw new Error(
      'Electron record-batch requires --use-deskpad-display or --recording-display-name so visual evidence comes from a stable system display recording.'
    )
  }
  await ensureMacosScreencaptureDisplayAvailable(recordingDisplayConfig.display)
  const displayKeepAwake = await resolvedDeps.startDisplayKeepAwake()
  try {
    await ensureMacosScreencaptureDisplayAvailable(recordingDisplayConfig.display)
    const backgroundImage = resolveDesktopRecordingVideoBackgroundImage(options)

    if (scenario.requiresUrl && options.workspace == null) {
      throw new Error(
        `Scenario "${scenario.id}" requires an input URL or workspace; Electron batch expects --workspace.`
      )
    }

    const displayBackground = await resolvedDeps.startDisplayBackground({
      display: recordingDisplayConfig.display,
      imagePath: backgroundImage
    })
    try {
      await ensureMacosScreencaptureDisplayAvailable(recordingDisplayConfig.display)
      for (const colorScheme of colorSchemes) {
        for (const language of languages) {
          const variantId = `${colorScheme}-${language}`
          let launched: DesktopCdpLaunchResult | undefined
          try {
            launched = await resolvedDeps.launchDesktop({
              allowUnsupportedApp: options.allowUnsupportedApp ?? false,
              appPath: options.appPath,
              env: {
                ...recordingDisplayConfig.env,
                ...(colorScheme === 'system'
                  ? {}
                  : { ONEWORKS_DESKTOP_RECORDING_THEME_MODE: colorScheme })
              },
              executable: options.executable,
              recordableLauncherWindow: true,
              waitMs: options.waitMs
            })
            if (launched.pid != null) {
              await assertMacosDisplayCaptureContainsAppWindow({
                display: recordingDisplayConfig.display,
                ownerPid: launched.pid
              })
            }

            const target = findRecordableTarget(launched.targets)
            if (target?.webSocketDebuggerUrl == null || target.url == null) {
              throw new Error(`No recordable Electron page target was found for variant ${variantId}.`)
            }

            const result = await recordDemoVideoScenario(scenario, {
              captureSource: 'system-display',
              cdpWebSocketDebuggerUrl: target.webSocketDebuggerUrl,
              colorScheme,
              durationMs: options.durationMs,
              ffmpegPath: options.ffmpegPath,
              followCdpTargets,
              fps: options.fps,
              height: options.height,
              json: true,
              keepFrames: options.keepFrames,
              language,
              name: `${options.name ?? scenario.id}-${variantId}`,
              outDir: path.join(outputRoot, variantId),
              preserveTargetEnvironment,
              scenarioId: scenario.id,
              systemCursorWindowBounds: recordingDisplayConfig.systemCursorWindowBounds,
              systemDisplayCrop: recordingDisplayConfig.windowBounds.outputCrop,
              systemDisplayId: recordingDisplayConfig.display.screencaptureDisplayId,
              url: target.url,
              width: options.width,
              workspace: options.workspace
            })
            variants.push({
              colorScheme,
              language,
              launch: {
                appPath: launched.appPath,
                endpoint: launched.endpoint,
                pid: launched.pid,
                port: launched.port,
                userDataDir: launched.userDataDir
              },
              result,
              variantId
            })
          } finally {
            if (launched?.pid != null) {
              try {
                resolvedDeps.killProcess(launched.pid)
              } catch {
                // The app may already have exited after the scenario.
              }
            }
          }
        }
      }
    } finally {
      await displayBackground.stop()
    }

    const batchResult: DesktopControlRecordBatchResult = {
      scenarioId: scenario.id,
      recordingDisplay: {
        backgroundImage: displayBackground.imagePath,
        display: recordingDisplayConfig.display,
        windowBounds: recordingDisplayConfig.windowBounds
      },
      variants
    }
    const stdout = options.stdout ?? process.stdout
    if (options.json === true) {
      stdout.write(`${JSON.stringify(batchResult, null, 2)}\n`)
      return batchResult
    }

    stdout.write('[desktop-control] recording batch ready\n')
    stdout.write(`[desktop-control] scenario=${batchResult.scenarioId}\n`)
    if (batchResult.recordingDisplay != null) {
      stdout.write(
        `[desktop-control] recordingDisplay=${batchResult.recordingDisplay.display.localizedName} id=${batchResult.recordingDisplay.display.id} screencaptureDisplayId=${batchResult.recordingDisplay.display.screencaptureDisplayId}\n`
      )
      stdout.write(`[desktop-control] background=${batchResult.recordingDisplay.backgroundImage}\n`)
    }
    for (const variant of variants) {
      stdout.write(`[desktop-control] ${variant.variantId} video=${variant.result.videoPath}\n`)
      stdout.write(`[desktop-control] ${variant.variantId} stills=${variant.result.stillsManifestPath}\n`)
      if (variant.result.cursorTimelinePath != null) {
        stdout.write(`[desktop-control] ${variant.variantId} cursorTimeline=${variant.result.cursorTimelinePath}\n`)
      }
      if (variant.result.cursorContinuityPath != null) {
        stdout.write(`[desktop-control] ${variant.variantId} cursorContinuity=${variant.result.cursorContinuityPath}\n`)
      }
    }
    return batchResult
  } finally {
    await displayKeepAwake.stop()
  }
}
