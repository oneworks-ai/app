import { createMobiusSvg } from '@oneworks/icon/svg'
import type { OneWorksIconBackgroundStyle, OneWorksIconMode, OneWorksIconTheme } from '@oneworks/icon/types'

export type ConfigOneWorksIconMode = OneWorksIconMode
export type ConfigOneWorksIconTheme = OneWorksIconTheme

export const createOneWorksIconDataUri = ({
  mode,
  backgroundStyle,
  noBackground,
  size,
  theme,
  title
}: {
  mode: OneWorksIconMode
  backgroundStyle?: OneWorksIconBackgroundStyle
  noBackground?: boolean
  size: number
  theme: OneWorksIconTheme
  title: string
}) => {
  const svg = createMobiusSvg({
    backgroundStyle: noBackground === true ? undefined : backgroundStyle ?? 'textured',
    mode,
    noBackground,
    shadow: false,
    size,
    theme,
    title
  })
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
