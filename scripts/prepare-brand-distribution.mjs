import { readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const output = resolve(process.argv[2] ?? '/tmp/oneworks-brand-distribution.html')
const templatePath = resolve(root, 'assets/brand/distribution-source.html')

const mimeTypes = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const sources = {
  OW_LIGHT: 'apps/desktop/build/icons/linear/transparent/light.svg',
  OW_DARK: 'apps/desktop/build/icons/linear/transparent/dark.svg',
  CLAUDE: 'assets/homepage/apps/homepage/src/assets/adapters/claude-code.svg',
  CODEX_LIGHT: 'assets/homepage/apps/homepage/src/assets/adapters/codex.svg',
  CODEX_DARK: 'assets/demo-video/assets/adapter-promo/sources/codex-dark.svg',
  COPILOT: 'assets/homepage/apps/homepage/src/assets/adapters/copilot.svg',
  GEMINI: 'assets/homepage/apps/homepage/src/assets/adapters/gemini.svg',
  KIMI: 'assets/homepage/apps/homepage/src/assets/adapters/kimi.svg',
  OPENCODE: 'assets/homepage/apps/homepage/src/assets/adapters/opencode.svg',
  OPENAI: 'apps/client/src/assets/model-providers/openai.svg',
  DEEPSEEK: 'apps/client/src/assets/model-providers/deepseek.svg',
  MOONSHOT: 'apps/client/src/assets/model-providers/moonshot.ico',
  MINIMAX: 'apps/client/src/assets/model-providers/minimax.png',
  QWEN: 'apps/client/src/assets/model-providers/qwen.svg',
  ZHIPU: 'apps/client/src/assets/model-providers/zhipu.png',
  TELEGRAM: 'assets/brand/channels/telegram.svg',
  LARK: 'apps/relay-admin/src/login/assets/feishu-logo.png',
  WECHAT: 'assets/brand/channels/wechat.svg',
  WECOM: 'assets/brand/channels/wecom.svg',
  QQ: 'assets/brand/channels/qq.svg',
  IMESSAGE: 'assets/brand/channels/imessage.svg',
  CHROME: 'assets/brand/platforms/chrome.svg',
  NPM: 'assets/brand/platforms/npm.svg'
}

const asDataUrl = async source => {
  const path = resolve(root, source)
  const type = mimeTypes[extname(path)]
  if (type == null) throw new Error(`Unsupported brand asset: ${source}`)
  return `data:${type};base64,${(await readFile(path)).toString('base64')}`
}

let template = await readFile(templatePath, 'utf8')
for (const [token, source] of Object.entries(sources)) {
  template = template.replaceAll(`{{${token}}}`, await asDataUrl(source))
}
await writeFile(output, template)
console.log(`[brand] prepared distribution artboards at ${output}`)
