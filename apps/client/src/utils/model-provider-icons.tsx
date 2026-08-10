import './model-provider-icons.scss'

import type { ReactNode } from 'react'

import type { IconRef } from '@oneworks/types'

type BuiltinImageIcon =
  | { light: string; dark: string }
  | { src: string; invertInDark?: boolean }

const kimiLightIcon = new URL('../assets/model-providers/kimi.svg', import.meta.url).href
const kimiDarkIcon = new URL('../assets/model-providers/kimi-dark.svg', import.meta.url).href

const builtinImageIconMap: Record<string, BuiltinImageIcon> = {
  anthropic: { src: new URL('../assets/model-providers/anthropic.png', import.meta.url).href },
  aws: { src: new URL('../assets/model-providers/aws.png', import.meta.url).href },
  azure: { src: new URL('../assets/model-providers/azure.ico', import.meta.url).href },
  deepseek: { src: new URL('../assets/model-providers/deepseek.svg', import.meta.url).href, invertInDark: true },
  gemini: { src: new URL('../assets/model-providers/gemini.png', import.meta.url).href },
  kimi: { light: kimiLightIcon, dark: kimiDarkIcon },
  'kimi-k2': { light: kimiLightIcon, dark: kimiDarkIcon },
  litellm: { src: new URL('../assets/model-providers/litellm.png', import.meta.url).href },
  micu: { src: new URL('../assets/model-providers/micu.png', import.meta.url).href },
  minimax: { src: new URL('../assets/model-providers/minimax.png', import.meta.url).href },
  moonshot: { src: new URL('../assets/model-providers/moonshot.ico', import.meta.url).href },
  'oneworks-browser-driver': {
    src: new URL('../../../../packages/plugins/browser-driver/assets/icon.svg', import.meta.url).href
  },
  'oneworks-china-red-theme': {
    src: new URL('../../../../packages/plugins/china-red-theme/assets/icon.svg', import.meta.url).href
  },
  'oneworks-chrome-devtools': {
    src: new URL('../../../../packages/plugins/chrome-devtools/assets/icon.svg', import.meta.url).href
  },
  'oneworks-cli-skills': {
    src: new URL('../../../../packages/plugins/cli-skills/assets/icon.svg', import.meta.url).href
  },
  'oneworks-cua-driver': {
    src: new URL('../../../../packages/plugins/cua-driver/assets/icon.svg', import.meta.url).href
  },
  'oneworks-external-browser-driver': {
    src: new URL('../../../../packages/plugins/external-browser-driver/assets/icon.svg', import.meta.url).href
  },
  'oneworks-focus-workbench-theme': {
    src: new URL('../../../../packages/plugins/focus-workbench-theme/assets/icon.svg', import.meta.url).href
  },
  'oneworks-logger': {
    src: new URL('../../../../packages/plugins/logger/assets/icon.svg', import.meta.url).href
  },
  'oneworks-neo-workshop-theme': {
    src: new URL('../../../../packages/plugins/neo-workshop-theme/assets/icon.svg', import.meta.url).href
  },
  'oneworks-plugin-demo': {
    src: new URL('../../../../packages/plugins/demo/assets/icon.svg', import.meta.url).href
  },
  'oneworks-plugin-demo-extension': {
    src: new URL('../../../../packages/plugins/demo-extension/assets/icon.svg', import.meta.url).href
  },
  'oneworks-warm-cowork-theme': {
    src: new URL('../../../../packages/plugins/warm-cowork-theme/assets/icon.svg', import.meta.url).href
  },
  openai: { src: new URL('../assets/model-providers/openai.svg', import.meta.url).href, invertInDark: true },
  openrouter: { src: new URL('../assets/model-providers/openrouter.ico', import.meta.url).href },
  portkey: { src: new URL('../assets/model-providers/portkey.png', import.meta.url).href },
  qwen: { src: new URL('../assets/model-providers/qwen.svg', import.meta.url).href },
  requesty: { src: new URL('../assets/model-providers/requesty.ico', import.meta.url).href },
  vercel: { src: new URL('../assets/model-providers/vercel.png', import.meta.url).href, invertInDark: true },
  yunwu: { src: new URL('../assets/model-providers/yunwu.png', import.meta.url).href },
  zhipu: { src: new URL('../assets/model-providers/zhipu.png', import.meta.url).href }
}

const builtinMaterialIconMap: Record<string, string> = {
  anthropic: 'psychology',
  api: 'api',
  apiyi: 'api',
  aws: 'deployed_code',
  azure: 'cloud',
  baidu: 'travel_explore',
  deepseek: 'search_insights',
  gemini: 'diamond',
  litellm: 'account_tree',
  kimi: 'nightlight',
  micu: 'hub',
  minimax: 'auto_awesome',
  model: 'neurology',
  'model-service': 'hub',
  moonshot: 'nightlight',
  openai: 'hexagon',
  openrouter: 'route',
  portkey: 'vpn_key',
  qwen: 'cloud',
  requesty: 'sync_alt',
  tencent: 'cloud_circle',
  vercel: 'change_history',
  volcengine: 'local_fire_department',
  yunwu: 'cloud',
  zhipu: 'neurology'
}

const resolveBuiltinMaterialIcon = (id: string) => builtinMaterialIconMap[id] ?? 'hub'
const buildIconClassName = (baseClassName: string, extraClassName?: string) => (
  [baseClassName, 'model-provider-icon', extraClassName].filter(Boolean).join(' ')
)

const renderThemeImageIcon = ({
  alt = '',
  darkSrc,
  imageClassName,
  lightSrc,
  iconId
}: {
  alt?: string
  darkSrc: string
  imageClassName: string
  lightSrc: string
  iconId?: string
}) => (
  <>
    <img
      className={buildIconClassName(imageClassName, 'model-provider-icon--theme-light')}
      src={lightSrc}
      alt={alt}
      data-icon-id={iconId}
      data-icon-theme='light'
    />
    <img
      className={buildIconClassName(imageClassName, 'model-provider-icon--theme-dark')}
      src={darkSrc}
      alt={alt}
      data-icon-id={iconId}
      data-icon-theme='dark'
    />
  </>
)

export const renderIconRef = ({
  icon,
  imageClassName,
  symbolClassName
}: {
  icon: IconRef | undefined
  imageClassName: string
  symbolClassName: string
}): ReactNode => {
  if (icon == null) return null
  if (icon.kind === 'url') {
    if (icon.darkUrl != null && icon.darkUrl.trim() !== '') {
      return renderThemeImageIcon({
        imageClassName,
        lightSrc: icon.url,
        darkSrc: icon.darkUrl
      })
    }
    return <img className={imageClassName} src={icon.url} alt='' />
  }
  if (icon.kind === 'data') {
    if (icon.darkValue != null && icon.darkValue.trim() !== '') {
      return renderThemeImageIcon({
        imageClassName,
        lightSrc: icon.value,
        darkSrc: icon.darkValue
      })
    }
    return <img className={imageClassName} src={icon.value} alt='' />
  }
  if (icon.kind === 'material') {
    return <span className={`${symbolClassName} material-symbols-rounded`}>{icon.name}</span>
  }
  const imageIcon = builtinImageIconMap[icon.id]
  if (imageIcon != null) {
    if ('dark' in imageIcon) {
      return renderThemeImageIcon({
        imageClassName,
        lightSrc: imageIcon.light,
        darkSrc: imageIcon.dark,
        iconId: icon.id
      })
    }
    return (
      <img
        className={buildIconClassName(
          imageClassName,
          imageIcon.invertInDark === true ? 'model-provider-icon--dark-invert' : undefined
        )}
        src={imageIcon.src}
        alt=''
        data-icon-id={icon.id}
      />
    )
  }
  return (
    <span
      className={`${symbolClassName} ${symbolClassName}--${icon.id} material-symbols-rounded`}
      data-icon-id={icon.id}
    >
      {resolveBuiltinMaterialIcon(icon.id)}
    </span>
  )
}
