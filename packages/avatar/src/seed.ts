import { AVATAR_PALETTES, AVATAR_PRESETS, createAvatarDataUri, createAvatarSvg, getAvatarPalette } from './avatar.js'
import type { AvatarBackgroundStyle, AvatarPalette, CreateAvatarSvgOptions } from './avatar.js'

export interface SeededAvatarConfig {
  readonly backgroundStyle: AvatarBackgroundStyle
  readonly emoticon: string
  readonly palette: AvatarPalette
  readonly showShadow: boolean
}

export interface ResolveSeededAvatarOptions {
  readonly backgroundStyle?: AvatarBackgroundStyle
  readonly emoticon?: string
  readonly paletteId?: string
  readonly seed: string
  readonly showShadow?: boolean
}

export interface CreateSeededAvatarOptions extends ResolveSeededAvatarOptions {
  readonly size?: number
  readonly title?: string
}

export const hashAvatarSeed = (seed: string) => {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export const resolveSeededAvatar = ({
  backgroundStyle = 'solid',
  emoticon,
  paletteId,
  seed,
  showShadow = false
}: ResolveSeededAvatarOptions): SeededAvatarConfig => {
  const hash = hashAvatarSeed(seed)
  const preset = AVATAR_PRESETS[hash % AVATAR_PRESETS.length] ?? AVATAR_PRESETS[0]
  const resolvedEmoticon = emoticon ?? preset?.emoticon ?? '0w0'
  const resolvedPaletteId = paletteId ?? preset?.paletteId ?? AVATAR_PALETTES[hash % AVATAR_PALETTES.length]?.id

  return {
    backgroundStyle,
    emoticon: resolvedEmoticon,
    palette: getAvatarPalette(resolvedPaletteId ?? AVATAR_PALETTES[0]?.id ?? ''),
    showShadow
  }
}

const resolveSeededSvgOptions = (options: CreateSeededAvatarOptions): CreateAvatarSvgOptions => {
  const avatar = resolveSeededAvatar(options)

  return {
    backgroundStyle: avatar.backgroundStyle,
    emoticon: avatar.emoticon,
    palette: avatar.palette,
    showShadow: avatar.showShadow,
    size: options.size,
    title: options.title ?? `OneWorks ${avatar.emoticon} avatar`
  }
}

export const createSeededAvatarSvg = (options: CreateSeededAvatarOptions) => {
  return createAvatarSvg(resolveSeededSvgOptions(options))
}

export const createSeededAvatarDataUri = (options: CreateSeededAvatarOptions) => {
  return createAvatarDataUri(resolveSeededSvgOptions(options))
}
