import { validateSourceAssetReference } from './client-source-paths.js'

const CSS_SOURCE_PATTERN = /\.(?:css|less|sass|scss|styl|stylus)(?:$|[?#])/i
const CSS_PREPROCESSOR_PATTERN = /\.(?:less|sass|scss|styl|stylus)(?:$|[?#])/i
const CSS_MODULE_PATTERN = /\.module\.css(?:$|[?#])/i
const CSS_ASSET_URL_PATTERN = /(?<=^|[^\w\-\u0080-\uFFFF])url\((\s*('[^']+'|"[^"]+")\s*|[^'")]+)\)/g
const CSS_IMAGE_SET_PATTERN = /(?:^|[^\w-])(?:-webkit-)?image-set\s*\(/i
const CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'")\s;]+))/gi

const parseCssAssetReference = (rawValue: string) => {
  const value = rawValue.trim()
  const quote = value[0]
  const unquoted = (quote === '"' || quote === "'") && value.at(-1) === quote
    ? value.slice(1, -1)
    : value
  if (unquoted.includes('\\')) return undefined
  return unquoted
}

const stripCssComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, comment => ' '.repeat(comment.length))

export const validateClientSourceCss = async ({
  code,
  id,
  sourceFile,
  sourceRoot
}: {
  code: string
  id: string
  sourceFile: string
  sourceRoot: string
}) => {
  if (!CSS_SOURCE_PATTERN.test(id)) return
  if (CSS_PREPROCESSOR_PATTERN.test(id)) {
    throw new Error(
      'Client source CSS preprocessors are unsupported; compile them to plain CSS inside the source root.'
    )
  }
  if (CSS_MODULE_PATTERN.test(id)) {
    throw new Error(
      'Client source CSS Modules are unsupported; use plain CSS with an explicit "?inline" import.'
    )
  }

  const css = stripCssComments(code)
  if (CSS_IMAGE_SET_PATTERN.test(css)) {
    throw new Error(
      'Client source CSS image-set assets are unsupported; use explicit "?inline" asset imports.'
    )
  }
  for (const match of css.matchAll(CSS_ASSET_URL_PATTERN)) {
    const reference = parseCssAssetReference(match[1] ?? '')
    if (reference == null) {
      throw new Error(
        'Client source CSS URL assets must use a static unescaped path or an explicit "?inline" import.'
      )
    }
    await validateSourceAssetReference({ reference, sourceFile, sourceRoot })
  }
  for (const match of css.matchAll(CSS_IMPORT_PATTERN)) {
    const reference = match[1] ?? match[2] ?? match[3]
    if (reference == null || reference === '') continue
    await validateSourceAssetReference({ reference, sourceFile, sourceRoot })
  }
}
