const RELEASE_APP_ID = 'ai.oneworks.desktop'
const RELEASE_ARTIFACT_BASENAME = 'oneworks'
const RELEASE_PRODUCT_NAME = 'One Works'

const isTruthy = value => /^(1|true|yes|on)$/i.test(value ?? '')

const isReleaseBuild = (env = process.env) => isTruthy(env.ONEWORKS_DESKTOP_RELEASE_BUILD)

const resolveDesktopAppMetadata = ({ env = process.env, platform = process.platform } = {}) => {
  const isDevBuild = !isReleaseBuild(env)
  const artifactBaseName = isDevBuild
    ? `${RELEASE_ARTIFACT_BASENAME}-dev`
    : RELEASE_ARTIFACT_BASENAME
  const productName = isDevBuild
    ? `${RELEASE_PRODUCT_NAME} Dev`
    : RELEASE_PRODUCT_NAME

  return {
    appId: isDevBuild ? `${RELEASE_APP_ID}.dev` : RELEASE_APP_ID,
    artifactBaseName,
    artifactName: `${artifactBaseName}-\${version}-\${os}-\${arch}.\${ext}`,
    executableName: platform === 'darwin' ? productName : artifactBaseName,
    isDevBuild,
    productName
  }
}

module.exports = {
  isReleaseBuild,
  resolveDesktopAppMetadata
}
