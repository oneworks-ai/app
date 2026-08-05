import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ALLOWED_ADVISORIES = new Map([
  [
    'GHSA-QWWW-VCR4-C8H2',
    {
      moduleName: 'react-router',
      pathPrefix: 'apps__relay-admin>react-router-dom>react-router',
      reason: 'Relay Admin is a client-only SPA and does not enable React Router RSC actions.'
    }
  ]
])

const readAdvisoryId = advisory => {
  const match = /\/(GHSA-[a-z0-9-]+)$/i.exec(advisory.url ?? '')
  return match?.[1]?.toUpperCase()
}

const readFindingPaths = advisory => (
  (advisory.findings ?? []).flatMap(finding => finding.paths ?? [])
)

export const evaluateProductionAudit = report => {
  if (report == null || typeof report !== 'object' || report.advisories == null) {
    throw new Error('pnpm audit did not return a valid advisory report.')
  }

  const allowed = []
  const unexpected = []
  for (const advisory of Object.values(report.advisories)) {
    if (advisory.severity !== 'critical' && advisory.severity !== 'high') continue

    const id = readAdvisoryId(advisory)
    const waiver = id == null ? undefined : ALLOWED_ADVISORIES.get(id)
    const paths = readFindingPaths(advisory)
    if (
      waiver != null &&
      advisory.module_name === waiver.moduleName &&
      paths.length > 0 &&
      paths.every(path => path === waiver.pathPrefix)
    ) {
      allowed.push({ id, paths, reason: waiver.reason })
      continue
    }

    unexpected.push({
      id: id ?? String(advisory.id ?? 'unknown'),
      moduleName: advisory.module_name,
      paths,
      severity: advisory.severity,
      title: advisory.title
    })
  }

  return { allowed, unexpected }
}

export const runProductionAudit = () => {
  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error != null) throw result.error

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error(`Unable to parse pnpm audit output. ${result.stderr.trim()}`)
  }

  const evaluation = evaluateProductionAudit(report)
  process.stdout.write(`${
    JSON.stringify(
      {
        ok: evaluation.unexpected.length === 0,
        allowed: evaluation.allowed,
        counts: report.metadata?.vulnerabilities,
        unexpected: evaluation.unexpected
      },
      null,
      2
    )
  }\n`)
  if (evaluation.unexpected.length > 0) process.exitCode = 1
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1]) {
  runProductionAudit()
}
