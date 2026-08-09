/* eslint-disable max-lines -- synchronous SHA-256 keeps raw error material inside the capture call. */
import type { DiagnosticClient } from './operation.js'
import { DIAGNOSTIC_SCHEMA_VERSION } from './types.js'
import type { DiagnosticFailure, DiagnosticFailureDomain, DiagnosticSurface } from './types.js'

export const JAVASCRIPT_ERROR_SOURCES = [
  'client.bootstrap',
  'client.react_render',
  'client.unhandled_rejection',
  'client.window_error',
  'electron.main_uncaught_exception',
  'electron.main_unhandled_rejection',
  'electron.renderer_gone'
] as const

export type JavaScriptErrorSource = typeof JAVASCRIPT_ERROR_SOURCES[number]

export interface JavaScriptErrorReport {
  fingerprint: string
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION
  serviceVersion?: string
  source: JavaScriptErrorSource
  surface: Extract<DiagnosticSurface, 'desktop' | 'pwa' | 'web'>
  type?: string
}

export interface CreateJavaScriptErrorReportInput {
  fingerprintMaterial?: string
  serviceVersion?: string
  source: JavaScriptErrorSource
  surface: JavaScriptErrorReport['surface']
  type?: string
}

export interface JavaScriptErrorReporterOptions {
  dedupeWindowMs?: number
  maxReportsPerMinute?: number
  now?: () => number
  send: (report: JavaScriptErrorReport) => Promise<void> | void
}

export type JavaScriptErrorCaptureResult =
  | { report: JavaScriptErrorReport; status: 'reported' }
  | { report: JavaScriptErrorReport; status: 'deduplicated' | 'rate_limited' }

const SAFE_TYPE = /^[A-Za-z][\w.-]{0,95}$/u
const SAFE_FINGERPRINT = /^js_[a-f0-9]{16}$/u
const SAFE_VERSION = /^[A-Za-z0-9][\w.+-]{0,95}$/u
const SOURCE_SET = new Set<string>(JAVASCRIPT_ERROR_SOURCES)
const SURFACE_SET = new Set<JavaScriptErrorReport['surface']>(['desktop', 'pwa', 'web'])
const DEFAULT_DEDUPE_WINDOW_MS = 5_000
const DEFAULT_MAX_REPORTS_PER_MINUTE = 20
const MAX_FINGERPRINT_MATERIAL_LENGTH = 16_384

const cleanSafeValue = (value: unknown, pattern: RegExp) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return pattern.test(trimmed) ? trimmed : undefined
}

const errorTypeFrom = (error: unknown, override?: string) => {
  const explicitType = cleanSafeValue(override, SAFE_TYPE)
  if (explicitType != null) return explicitType
  if (error instanceof Error) return cleanSafeValue(error.name, SAFE_TYPE)
  return 'NonError'
}

const normalizeFingerprintLine = (line: string) =>
  line
    .trim()
    .replace(/\bhttps?:\/\/[^/\s)]+/giu, '<origin>')
    .replace(/\bfile:\/\/\/?(?:[^/\s)]+\/)+/giu, '<path>/')
    .replace(/(?:\/[^/\s():]+){2,}\//gu, '<path>/')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s():]+\\)+/gu, '<path>\\')
    .replace(/[?#][^\s)]*/gu, '')
    .replace(/:\d+(?::\d+)?/gu, ':#')

const normalizeFingerprintMaterial = (value: string) =>
  value
    .slice(0, MAX_FINGERPRINT_MATERIAL_LENGTH)
    .split(/\r?\n/u)
    .map(normalizeFingerprintLine)
    .filter(Boolean)
    .join('\n')

const stackFingerprintMaterial = (error: unknown) => {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return ''
  return normalizeFingerprintMaterial(
    error.stack
      .split(/\r?\n/u)
      .slice(1, 13)
      .join('\n')
  )
}

const SHA256_CONSTANTS = [
  0x428A2F98,
  0x71374491,
  0xB5C0FBCF,
  0xE9B5DBA5,
  0x3956C25B,
  0x59F111F1,
  0x923F82A4,
  0xAB1C5ED5,
  0xD807AA98,
  0x12835B01,
  0x243185BE,
  0x550C7DC3,
  0x72BE5D74,
  0x80DEB1FE,
  0x9BDC06A7,
  0xC19BF174,
  0xE49B69C1,
  0xEFBE4786,
  0x0FC19DC6,
  0x240CA1CC,
  0x2DE92C6F,
  0x4A7484AA,
  0x5CB0A9DC,
  0x76F988DA,
  0x983E5152,
  0xA831C66D,
  0xB00327C8,
  0xBF597FC7,
  0xC6E00BF3,
  0xD5A79147,
  0x06CA6351,
  0x14292967,
  0x27B70A85,
  0x2E1B2138,
  0x4D2C6DFC,
  0x53380D13,
  0x650A7354,
  0x766A0ABB,
  0x81C2C92E,
  0x92722C85,
  0xA2BFE8A1,
  0xA81A664B,
  0xC24B8B70,
  0xC76C51A3,
  0xD192E819,
  0xD6990624,
  0xF40E3585,
  0x106AA070,
  0x19A4C116,
  0x1E376C08,
  0x2748774C,
  0x34B0BCB5,
  0x391C0CB3,
  0x4ED8AA4A,
  0x5B9CCA4F,
  0x682E6FF3,
  0x748F82EE,
  0x78A5636F,
  0x84C87814,
  0x8CC70208,
  0x90BEFFFA,
  0xA4506CEB,
  0xBEF9A3F7,
  0xC67178F2
] as const

const rotateRight = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift))

const fingerprintFrom = (value: string) => {
  const source = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(source)
  padded[source.length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = source.length * 8
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  const hash = [
    0x6A09E667,
    0xBB67AE85,
    0x3C6EF372,
    0xA54FF53A,
    0x510E527F,
    0x9B05688C,
    0x1F83D9AB,
    0x5BE0CD19
  ]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!
      const right = words[index - 2]!
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3)
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10)
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number]
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    hash[0] = (hash[0]! + a) >>> 0
    hash[1] = (hash[1]! + b) >>> 0
    hash[2] = (hash[2]! + c) >>> 0
    hash[3] = (hash[3]! + d) >>> 0
    hash[4] = (hash[4]! + e) >>> 0
    hash[5] = (hash[5]! + f) >>> 0
    hash[6] = (hash[6]! + g) >>> 0
    hash[7] = (hash[7]! + h) >>> 0
  }

  return `js_${hash.slice(0, 2).map(word => word.toString(16).padStart(8, '0')).join('')}`
}

export const createJavaScriptErrorReport = (
  error: unknown,
  input: CreateJavaScriptErrorReportInput
): JavaScriptErrorReport => {
  const type = errorTypeFrom(error, input.type)
  const fingerprintMaterial = [
    input.source,
    type,
    stackFingerprintMaterial(error),
    normalizeFingerprintMaterial(input.fingerprintMaterial ?? '')
  ].join('\n')
  const serviceVersion = cleanSafeValue(input.serviceVersion, SAFE_VERSION)
  return {
    fingerprint: fingerprintFrom(fingerprintMaterial),
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    ...(serviceVersion == null ? {} : { serviceVersion }),
    source: input.source,
    surface: input.surface,
    ...(type == null ? {} : { type })
  }
}

export const parseJavaScriptErrorReport = (value: unknown): JavaScriptErrorReport | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const report = value as Partial<JavaScriptErrorReport>
  const fingerprint = cleanSafeValue(report.fingerprint, SAFE_FINGERPRINT)
  const serviceVersion = cleanSafeValue(report.serviceVersion, SAFE_VERSION)
  const type = cleanSafeValue(report.type, SAFE_TYPE)
  if (
    report.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION ||
    fingerprint == null ||
    typeof report.source !== 'string' ||
    !SOURCE_SET.has(report.source) ||
    report.surface == null ||
    !SURFACE_SET.has(report.surface)
  ) return undefined

  return {
    fingerprint,
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    ...(serviceVersion == null ? {} : { serviceVersion }),
    source: report.source as JavaScriptErrorSource,
    surface: report.surface,
    ...(type == null ? {} : { type })
  }
}

const failureDomainFromSource = (source: JavaScriptErrorSource): DiagnosticFailureDomain => {
  if (source.startsWith('electron.main_')) return 'process'
  if (source === 'electron.renderer_gone') return 'renderer'
  return 'client'
}

export const diagnosticFailureFromJavaScriptErrorReport = (
  report: JavaScriptErrorReport
): DiagnosticFailure => ({
  code: `javascript.${report.source.replaceAll('.', '_')}`,
  domain: failureDomainFromSource(report.source),
  fingerprint: report.fingerprint,
  retryable: true,
  ...(report.type == null ? {} : { type: report.type })
})

export const recordJavaScriptError = (client: DiagnosticClient, report: JavaScriptErrorReport) => {
  const operation = client.startOperation('oneworks.javascript.error')
  operation.stage(report.source)
  return operation.fail(diagnosticFailureFromJavaScriptErrorReport(report))
}

export const createJavaScriptErrorReporter = (options: JavaScriptErrorReporterOptions) => {
  const now = options.now ?? Date.now
  const dedupeWindowMs = Math.max(0, options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS)
  const maxReportsPerMinute = Math.max(1, options.maxReportsPerMinute ?? DEFAULT_MAX_REPORTS_PER_MINUTE)
  const recentFingerprints = new Map<string, number>()
  let recentReports: number[] = []

  return {
    capture: (error: unknown, input: CreateJavaScriptErrorReportInput): JavaScriptErrorCaptureResult => {
      const report = createJavaScriptErrorReport(error, input)
      const capturedAt = now()
      const previousCapture = recentFingerprints.get(report.fingerprint)
      if (previousCapture != null && capturedAt - previousCapture < dedupeWindowMs) {
        return { report, status: 'deduplicated' }
      }

      recentReports = recentReports.filter(timestamp => capturedAt - timestamp < 60_000)
      if (recentReports.length >= maxReportsPerMinute) {
        return { report, status: 'rate_limited' }
      }

      recentFingerprints.set(report.fingerprint, capturedAt)
      recentReports.push(capturedAt)
      void Promise.resolve(options.send(report)).catch(() => undefined)
      return { report, status: 'reported' }
    }
  }
}
