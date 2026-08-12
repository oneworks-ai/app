const fs = require('node:fs')
const path = require('node:path')

const filesApi = require('./notarization-state-files.cjs')

const findDirectories = (root, suffix) => {
  if (!fs.existsSync(root)) return []
  const result = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory() && entry.name.endsWith(suffix)) result.push(entryPath)
      else if (entry.isDirectory()) visit(entryPath)
    }
  }
  visit(root)
  return result.sort()
}

const prepareState = ({
  buildBranch,
  buildTime,
  builderSha,
  command,
  releaseTag = '',
  runAttempt,
  runHeadSha,
  runId,
  sourceSha,
  stage,
  stateDir,
  workspaceDir
}) => {
  if (!['app', 'installer'].includes(stage)) throw new Error(`[desktop] unsupported notarization stage ${stage}`)
  const sourceRoot = path.join(workspaceDir, 'apps', 'desktop', stage === 'app' ? 'out' : 'release')
  const sourcePaths = stage === 'app'
    ? findDirectories(sourceRoot, '.app')
    : fs.readdirSync(sourceRoot, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(sourceRoot, entry.name))
      .sort()
  if (sourcePaths.length === 0) throw new Error(`[desktop] no ${stage} notarization targets found`)

  fs.rmSync(stateDir, { force: true, recursive: true })
  const payloadDir = path.join(stateDir, 'payload')
  fs.mkdirSync(payloadDir, { recursive: true })
  const files = sourcePaths.map((sourcePath, index) => {
    const extension = stage === 'app' ? '.zip' : path.extname(sourcePath)
    const baseName = path.basename(sourcePath, path.extname(sourcePath)).replace(/[^\w.-]+/g, '-')
    const payloadName = `${String(index + 1).padStart(2, '0')}-${baseName}${extension}`
    const payloadPath = path.join(payloadDir, payloadName)
    if (stage === 'app') {
      command('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', sourcePath, payloadPath])
    } else fs.copyFileSync(sourcePath, payloadPath)
    return {
      name: path.basename(sourcePath),
      payload: path.relative(stateDir, payloadPath),
      relativePath: path.relative(workspaceDir, sourcePath),
      sha256: filesApi.sha256File(payloadPath),
      size: fs.statSync(payloadPath).size,
      status: 'Prepared'
    }
  })
  const targets = stage === 'app'
    ? files
    : files.filter(target => ['.dmg', '.pkg'].includes(path.extname(target.name).toLowerCase()))
  if (targets.length === 0) throw new Error(`[desktop] no ${stage} notarization targets found`)
  const normalizedBuildTime = filesApi.readRequiredValue(buildTime, 'build time')
  if (Number.isNaN(Date.parse(normalizedBuildTime))) throw new Error('[desktop] invalid notarization build time')
  const state = {
    schemaVersion: filesApi.schemaVersion,
    stage,
    sourceSha: filesApi.readRequiredValue(sourceSha, 'source SHA'),
    builderSha: filesApi.readRequiredValue(builderSha, 'builder SHA'),
    buildBranch: filesApi.readRequiredValue(buildBranch, 'build branch'),
    buildTime: normalizedBuildTime,
    artifactProvenance: filesApi.artifactProvenance({
      headSha: runHeadSha,
      runAttempt,
      runId
    }),
    releaseTag,
    createdAt: new Date().toISOString(),
    files,
    targets
  }
  filesApi.writeJsonAtomic(path.join(stateDir, 'notarization-state.json'), state)
  return state
}

module.exports = { prepareState }
