const fs = require('node:fs')
const path = require('node:path')

const getMacUpdateInfoFileName = updateChannel => `${updateChannel === 'stable' ? 'latest' : updateChannel}-mac.yml`

const mergeMacUpdateInfo = ({ releaseDir, targetArchs, updateChannel = 'stable', yaml }) => {
  const macUpdateInfoPaths = targetArchs
    .map(targetArch => path.join(releaseDir, `${updateChannel}-mac-${targetArch}.yml`))
    .filter(candidate => fs.existsSync(candidate))

  if (macUpdateInfoPaths.length <= 1) {
    return
  }

  const updateInfos = macUpdateInfoPaths.map(filePath => yaml.load(fs.readFileSync(filePath, 'utf8')))
  const combinedFiles = []

  for (const updateInfo of updateInfos) {
    for (const fileInfo of updateInfo.files ?? []) {
      if (!combinedFiles.some(candidate => candidate.url === fileInfo.url)) {
        combinedFiles.push(fileInfo)
      }
    }
  }

  const primaryUpdateInfo = updateInfos[0]
  const primaryZipFile = combinedFiles.find(fileInfo => fileInfo.url.endsWith('.zip')) ?? combinedFiles[0]
  const mergedUpdateInfo = {
    ...primaryUpdateInfo,
    files: combinedFiles
  }

  if (primaryZipFile != null) {
    mergedUpdateInfo.path = primaryZipFile.url
    mergedUpdateInfo.sha512 = primaryZipFile.sha512
  }

  fs.writeFileSync(
    path.join(releaseDir, getMacUpdateInfoFileName(updateChannel)),
    yaml.dump(mergedUpdateInfo, {
      lineWidth: -1,
      noRefs: true
    })
  )

  for (const filePath of macUpdateInfoPaths) {
    fs.rmSync(filePath, { force: true })
  }
}

module.exports = {
  mergeMacUpdateInfo
}
