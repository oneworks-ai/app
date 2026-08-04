import { spawnSync } from 'node:child_process'
import process from 'node:process'

export const resolveExternalDeploymentTarget = (env) => {
  const token = env.GH_TOKEN?.trim()
  const repository = env.RELAY_SERVER_DEPLOY_REPOSITORY?.trim()
  const workflow = env.RELAY_SERVER_DEPLOY_WORKFLOW?.trim()
  if (token == null || repository == null || workflow == null || token === '' || repository === '' || workflow === '') {
    throw new Error('External Relay deployment requires token, repository, and workflow together.')
  }
  return { repository, workflow }
}

export const parseGitHubRunId = (runUrl) => {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/?$/u.exec(runUrl.trim())
  if (match == null) throw new Error('Unable to resolve Relay server workflow run id.')
  return match[1]
}

const runGh = (args) => {
  const result = spawnSync('gh', args, { encoding: 'utf8', env: process.env })
  if (result.error != null) throw result.error
  if (result.status !== 0) throw new Error(`gh ${args[0]} exited with ${String(result.status)}`)
  return result.stdout.trim()
}

const main = () => {
  const target = resolveExternalDeploymentTarget(process.env)
  const runUrl = runGh([
    'workflow',
    'run',
    target.workflow,
    '--repo',
    target.repository,
    '--ref',
    'main',
    '-f',
    'source_ref=main',
    '-f',
    `source_sha=${process.env.GITHUB_SHA ?? ''}`
  ])
  process.stdout.write(`${runUrl}\n`)
  const runId = parseGitHubRunId(runUrl)
  runGh(['run', 'watch', runId, '--repo', target.repository, '--exit-status', '--interval', '10'])
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
