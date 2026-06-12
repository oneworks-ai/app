export interface AvatarPalette {
  readonly id: string
  readonly name: string
  readonly background: string
  readonly gradient: readonly [string, string]
  readonly foreground: string
  readonly shadow: string
}

export type AvatarBackgroundStyle = 'solid' | 'gradient'
export type AvatarSlot = 'left' | 'mouth' | 'right'

export interface AvatarPreset {
  readonly id: string
  readonly label: string
  readonly emoticon: string
  readonly paletteId: string
}

export interface AvatarPart {
  readonly id: string
  readonly label: string
  readonly glyph: string
}

export interface AvatarGlyphMark {
  readonly x: number
  readonly y: number
}

export interface AvatarGlyphView {
  readonly width: number
  readonly height: number
  readonly markSize: number
  readonly marks: readonly AvatarGlyphMark[]
}

export interface CreateAvatarSvgOptions {
  readonly emoticon: string
  readonly palette: AvatarPalette
  readonly backgroundStyle?: AvatarBackgroundStyle
  readonly dimInactiveGlyphs?: boolean
  readonly highlightSlot?: AvatarSlot | readonly AvatarSlot[]
  readonly showShadow?: boolean
  readonly size?: number
  readonly title?: string
}

interface PixelGlyph {
  readonly width: number
  readonly rows: readonly string[]
}

interface AvatarGlyphRect {
  readonly slot: AvatarSlot
  readonly x: number
  readonly y: number
}

const VIEW_SIZE = 128
const GLYPH_HEIGHT = 7
const CELL_SIZE = 7
const MARK_SIZE = 6
const CHAR_GAP = 1
const LOWERCASE_DESCENDER_Y_OFFSET = CELL_SIZE * 2

const GLYPHS: Record<string, PixelGlyph> = {
  '0': {
    width: 5,
    rows: [
      '01110',
      '10001',
      '10011',
      '10101',
      '11001',
      '10001',
      '01110'
    ]
  },
  O: {
    width: 5,
    rows: [
      '01110',
      '10001',
      '10001',
      '10001',
      '10001',
      '10001',
      '01110'
    ]
  },
  o: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '01110',
      '10001',
      '10001',
      '10001',
      '01110'
    ]
  },
  Q: {
    width: 5,
    rows: [
      '01110',
      '10001',
      '10001',
      '10001',
      '10101',
      '10010',
      '01101'
    ]
  },
  q: {
    width: 5,
    rows: [
      '00000',
      '01110',
      '10001',
      '10001',
      '10011',
      '01101',
      '00001'
    ]
  },
  P: {
    width: 5,
    rows: [
      '11110',
      '10001',
      '10001',
      '11110',
      '10000',
      '10000',
      '10000'
    ]
  },
  p: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '11110',
      '10001',
      '11110',
      '10000',
      '10000'
    ]
  },
  U: {
    width: 5,
    rows: [
      '10001',
      '10001',
      '10001',
      '10001',
      '10001',
      '10001',
      '01110'
    ]
  },
  u: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '10001',
      '10001',
      '10001',
      '10011',
      '01101'
    ]
  },
  V: {
    width: 5,
    rows: [
      '10001',
      '10001',
      '10001',
      '01010',
      '01010',
      '00100',
      '00100'
    ]
  },
  v: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '10001',
      '10001',
      '01010',
      '01010',
      '00100'
    ]
  },
  W: {
    width: 5,
    rows: [
      '10001',
      '10001',
      '10001',
      '10101',
      '10101',
      '11111',
      '01010'
    ]
  },
  w: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '10001',
      '10001',
      '10101',
      '11111',
      '01010'
    ]
  },
  X: {
    width: 5,
    rows: [
      '10001',
      '01010',
      '00100',
      '00100',
      '00100',
      '01010',
      '10001'
    ]
  },
  x: {
    width: 5,
    rows: [
      '00000',
      '10001',
      '01010',
      '00100',
      '00100',
      '01010',
      '10001'
    ]
  },
  A: {
    width: 5,
    rows: [
      '01110',
      '10001',
      '10001',
      '11111',
      '10001',
      '10001',
      '10001'
    ]
  },
  a: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '01110',
      '00001',
      '01111',
      '10001',
      '01111'
    ]
  },
  M: {
    width: 5,
    rows: [
      '10001',
      '11011',
      '10101',
      '10101',
      '10001',
      '10001',
      '10001'
    ]
  },
  m: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '11011',
      '10101',
      '10101',
      '10101',
      '10101'
    ]
  },
  N: {
    width: 5,
    rows: [
      '10001',
      '11001',
      '10101',
      '10011',
      '10001',
      '10001',
      '10001'
    ]
  },
  n: {
    width: 5,
    rows: [
      '00000',
      '00000',
      '11110',
      '10001',
      '10001',
      '10001',
      '10001'
    ]
  },
  '.': {
    width: 3,
    rows: [
      '000',
      '000',
      '000',
      '000',
      '000',
      '010',
      '010'
    ]
  },
  '-': {
    width: 3,
    rows: [
      '000',
      '000',
      '000',
      '111',
      '000',
      '000',
      '000'
    ]
  },
  _: {
    width: 3,
    rows: [
      '000',
      '000',
      '000',
      '000',
      '000',
      '000',
      '111'
    ]
  },
  '^': {
    width: 5,
    rows: [
      '00100',
      '01010',
      '10001',
      '00000',
      '00000',
      '00000',
      '00000'
    ]
  },
  '~': {
    width: 5,
    rows: [
      '00000',
      '00000',
      '01001',
      '10110',
      '00000',
      '00000',
      '00000'
    ]
  },
  '=': {
    width: 5,
    rows: [
      '00000',
      '00000',
      '11111',
      '00000',
      '11111',
      '00000',
      '00000'
    ]
  },
  '+': {
    width: 5,
    rows: [
      '00000',
      '00100',
      '00100',
      '11111',
      '00100',
      '00100',
      '00000'
    ]
  },
  '*': {
    width: 5,
    rows: [
      '10101',
      '01110',
      '11111',
      '01110',
      '10101',
      '00000',
      '00000'
    ]
  },
  '@': {
    width: 5,
    rows: [
      '01110',
      '10001',
      '10111',
      '10101',
      '10111',
      '10000',
      '01110'
    ]
  }
}

export const AVATAR_PALETTES: readonly AvatarPalette[] = [
  {
    id: 'signal',
    name: 'Signal',
    background: '#d8340c',
    gradient: ['#d8340c', '#f47b61'],
    foreground: '#fff8ef',
    shadow: '#5c1808'
  },
  {
    id: 'mint',
    name: 'Mint',
    background: '#0f766e',
    gradient: ['#0f766e', '#72c8a4'],
    foreground: '#f2fff8',
    shadow: '#063d38'
  },
  {
    id: 'graphite',
    name: 'Graphite',
    background: '#202321',
    gradient: ['#202321', '#4a504b'],
    foreground: '#f7f7f2',
    shadow: '#e23f12'
  },
  {
    id: 'black',
    name: 'Black',
    background: '#000000',
    gradient: ['#000000', '#111827'],
    foreground: '#ffffff',
    shadow: '#334155'
  },
  {
    id: 'white',
    name: 'White',
    background: '#ffffff',
    gradient: ['#ffffff', '#e5e7eb'],
    foreground: '#000000',
    shadow: '#9ca3af'
  },
  {
    id: 'sky',
    name: 'Sky',
    background: '#d7ecff',
    gradient: ['#d7ecff', '#91c9f4'],
    foreground: '#17324d',
    shadow: '#8ca8bd'
  },
  {
    id: 'gold',
    name: 'Gold',
    background: '#f2bd4b',
    gradient: ['#f2bd4b', '#ffe6a1'],
    foreground: '#201b12',
    shadow: '#a86a1a'
  },
  {
    id: 'moss',
    name: 'Moss',
    background: '#c8d77a',
    gradient: ['#c8d77a', '#789d59'],
    foreground: '#253119',
    shadow: '#6f7e34'
  },
  {
    id: 'coral',
    name: 'Coral',
    background: '#f47b61',
    gradient: ['#f47b61', '#ffc1a9'],
    foreground: '#27120f',
    shadow: '#b33e2e'
  },
  {
    id: 'iris',
    name: 'Iris',
    background: '#6750a4',
    gradient: ['#6750a4', '#a991df'],
    foreground: '#fff9ff',
    shadow: '#2f2257'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    background: '#0b1020',
    gradient: ['#0b1020', '#00a36c'],
    foreground: '#d8ffe8',
    shadow: '#007a53'
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    background: '#ffd6e7',
    gradient: ['#ffd6e7', '#ff8ab3'],
    foreground: '#321322',
    shadow: '#c94f78'
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    background: '#5eead4',
    gradient: ['#5eead4', '#1d9bd1'],
    foreground: '#042f2e',
    shadow: '#0f766e'
  },
  {
    id: 'berry',
    name: 'Berry',
    background: '#9d174d',
    gradient: ['#9d174d', '#f472b6'],
    foreground: '#fff1f8',
    shadow: '#4a0b25'
  },
  {
    id: 'solar',
    name: 'Solar',
    background: '#fff2a8',
    gradient: ['#fff2a8', '#f59e0b'],
    foreground: '#2f2200',
    shadow: '#c77700'
  },
  {
    id: 'porcelain',
    name: 'Porcelain',
    background: '#f8fafc',
    gradient: ['#f8fafc', '#93c5fd'],
    foreground: '#111827',
    shadow: '#94a3b8'
  },
  {
    id: 'ember',
    name: 'Ember',
    background: '#32130f',
    gradient: ['#32130f', '#ef5a24'],
    foreground: '#fff2de',
    shadow: '#a83216'
  },
  {
    id: 'acid',
    name: 'Acid',
    background: '#d8ff47',
    gradient: ['#d8ff47', '#49d17d'],
    foreground: '#13220a',
    shadow: '#80a317'
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: '#15162b',
    gradient: ['#15162b', '#5b6ee1'],
    foreground: '#f2f0ff',
    shadow: '#4b4db8'
  },
  {
    id: 'jade',
    name: 'Jade',
    background: '#d1fae5',
    gradient: ['#d1fae5', '#34d399'],
    foreground: '#064e3b',
    shadow: '#34d399'
  },
  {
    id: 'plum',
    name: 'Plum',
    background: '#3b0764',
    gradient: ['#3b0764', '#a855f7'],
    foreground: '#faf5ff',
    shadow: '#7e22ce'
  },
  {
    id: 'peach',
    name: 'Peach',
    background: '#ffe0c7',
    gradient: ['#ffe0c7', '#fb923c'],
    foreground: '#3a1c0b',
    shadow: '#ea580c'
  },
  {
    id: 'ocean',
    name: 'Ocean',
    background: '#075985',
    gradient: ['#075985', '#38bdf8'],
    foreground: '#ecfeff',
    shadow: '#0c4a6e'
  },
  {
    id: 'rosewood',
    name: 'Rosewood',
    background: '#4c0519',
    gradient: ['#4c0519', '#e11d48'],
    foreground: '#fff1f2',
    shadow: '#be123c'
  },
  {
    id: 'limepop',
    name: 'Limepop',
    background: '#ecfccb',
    gradient: ['#ecfccb', '#84cc16'],
    foreground: '#1a2e05',
    shadow: '#65a30d'
  },
  {
    id: 'denim',
    name: 'Denim',
    background: '#1e3a8a',
    gradient: ['#1e3a8a', '#60a5fa'],
    foreground: '#eff6ff',
    shadow: '#1d4ed8'
  },
  {
    id: 'orchid',
    name: 'Orchid',
    background: '#f5d0fe',
    gradient: ['#f5d0fe', '#d946ef'],
    foreground: '#3b0a45',
    shadow: '#c026d3'
  },
  {
    id: 'cocoa',
    name: 'Cocoa',
    background: '#2a1712',
    gradient: ['#2a1712', '#a16207'],
    foreground: '#fff7ed',
    shadow: '#854d0e'
  },
  {
    id: 'ice',
    name: 'Ice',
    background: '#e0f2fe',
    gradient: ['#e0f2fe', '#7dd3fc'],
    foreground: '#082f49',
    shadow: '#38bdf8'
  },
  {
    id: 'ink',
    name: 'Ink',
    background: '#020617',
    gradient: ['#020617', '#64748b'],
    foreground: '#f8fafc',
    shadow: '#334155'
  },
  {
    id: 'clay',
    name: 'Clay',
    background: '#fca5a5',
    gradient: ['#fca5a5', '#dc2626'],
    foreground: '#2f0f0f',
    shadow: '#b91c1c'
  },
  {
    id: 'lilac',
    name: 'Lilac',
    background: '#ede9fe',
    gradient: ['#ede9fe', '#8b5cf6'],
    foreground: '#2e1065',
    shadow: '#7c3aed'
  },
  {
    id: 'pine',
    name: 'Pine',
    background: '#064e3b',
    gradient: ['#064e3b', '#10b981'],
    foreground: '#ecfdf5',
    shadow: '#047857'
  },
  {
    id: 'banana',
    name: 'Banana',
    background: '#fef08a',
    gradient: ['#fef08a', '#facc15'],
    foreground: '#29210c',
    shadow: '#ca8a04'
  }
]

export const AVATAR_EYES: readonly AvatarPart[] = [
  { id: 'zero', label: '0', glyph: '0' },
  { id: 'open-upper', label: 'O', glyph: 'O' },
  { id: 'open-lower', label: 'o', glyph: 'o' },
  { id: 'tear-upper', label: 'Q', glyph: 'Q' },
  { id: 'tear-lower', label: 'q', glyph: 'q' },
  { id: 'p-upper', label: 'P', glyph: 'P' },
  { id: 'p-lower', label: 'p', glyph: 'p' },
  { id: 'soft-upper', label: 'U', glyph: 'U' },
  { id: 'soft-lower', label: 'u', glyph: 'u' },
  { id: 'sharp-upper', label: 'V', glyph: 'V' },
  { id: 'sharp-lower', label: 'v', glyph: 'v' },
  { id: 'cross-upper', label: 'X', glyph: 'X' },
  { id: 'cross-lower', label: 'x', glyph: 'x' },
  { id: 'caret', label: '^', glyph: '^' },
  { id: 'wave', label: '~', glyph: '~' },
  { id: 'equal', label: '=', glyph: '=' },
  { id: 'star', label: '*', glyph: '*' },
  { id: 'at', label: '@', glyph: '@' },
  { id: 'dash', label: '-', glyph: '-' },
  { id: 'under', label: '_', glyph: '_' }
]

export const AVATAR_MOUTHS: readonly AvatarPart[] = [
  { id: 'wow-lower', label: 'w', glyph: 'w' },
  { id: 'wow-upper', label: 'W', glyph: 'W' },
  { id: 'v-lower', label: 'v', glyph: 'v' },
  { id: 'v-upper', label: 'V', glyph: 'V' },
  { id: 'u-lower', label: 'u', glyph: 'u' },
  { id: 'u-upper', label: 'U', glyph: 'U' },
  { id: 'x-lower', label: 'x', glyph: 'x' },
  { id: 'x-upper', label: 'X', glyph: 'X' },
  { id: 'tear-lower', label: 'q', glyph: 'q' },
  { id: 'tear-upper', label: 'Q', glyph: 'Q' },
  { id: 'a-lower', label: 'a', glyph: 'a' },
  { id: 'a-upper', label: 'A', glyph: 'A' },
  { id: 'm-lower', label: 'm', glyph: 'm' },
  { id: 'm-upper', label: 'M', glyph: 'M' },
  { id: 'n-lower', label: 'n', glyph: 'n' },
  { id: 'n-upper', label: 'N', glyph: 'N' },
  { id: 'dot', label: '.', glyph: '.' },
  { id: 'dash', label: '-', glyph: '-' },
  { id: 'under', label: '_', glyph: '_' },
  { id: 'caret', label: '^', glyph: '^' },
  { id: 'wave', label: '~', glyph: '~' },
  { id: 'equal', label: '=', glyph: '=' },
  { id: 'plus', label: '+', glyph: '+' },
  { id: 'star', label: '*', glyph: '*' }
]

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  { id: 'zero-w', label: '0w0', emoticon: '0w0', paletteId: 'signal' },
  { id: 'big-wow', label: 'OWO', emoticon: 'OWO', paletteId: 'graphite' },
  { id: 'soft-v', label: 'Ovo', emoticon: 'Ovo', paletteId: 'sky' },
  { id: 'tear-wow', label: 'qwq', emoticon: 'qwq', paletteId: 'mint' },
  { id: 'small-wow', label: 'owo', emoticon: 'owo', paletteId: 'mint' },
  { id: 'mixed-wow', label: 'OwO', emoticon: 'OwO', paletteId: 'gold' },
  { id: 'soft-u', label: 'UwU', emoticon: 'UwU', paletteId: 'moss' },
  { id: 'tear-v', label: 'qvq', emoticon: 'qvq', paletteId: 'coral' },
  { id: 'sharp-v', label: 'UvU', emoticon: 'UvU', paletteId: 'coral' },
  { id: 'small-v', label: 'oVo', emoticon: 'oVo', paletteId: 'iris' },
  { id: 'zero-v', label: '0v0', emoticon: '0v0', paletteId: 'mint' },
  { id: 'tear-o', label: 'qOq', emoticon: 'qOq', paletteId: 'sky' },
  { id: 'soft-x', label: 'OxO', emoticon: 'OxO', paletteId: 'signal' },
  { id: 'tiny-u', label: 'uvu', emoticon: 'uvu', paletteId: 'gold' },
  { id: 'zero-wow', label: '0W0', emoticon: '0W0', paletteId: 'graphite' },
  { id: 'tear-zero', label: 'q0q', emoticon: 'q0q', paletteId: 'iris' },
  { id: 'soft-tear', label: 'quq', emoticon: 'quq', paletteId: 'moss' },
  { id: 'tear-x', label: 'qxq', emoticon: 'qxq', paletteId: 'graphite' },
  { id: 'zero-tear', label: '0q0', emoticon: '0q0', paletteId: 'signal' },
  { id: 'open-tear', label: 'OqO', emoticon: 'OqO', paletteId: 'gold' },
  { id: 'small-tear', label: 'oqo', emoticon: 'oqo', paletteId: 'sky' },
  { id: 'u-tear', label: 'UqU', emoticon: 'UqU', paletteId: 'coral' },
  { id: 'v-tear', label: 'vqv', emoticon: 'vqv', paletteId: 'mint' },
  { id: 'w-tear', label: 'wqw', emoticon: 'wqw', paletteId: 'moss' },
  { id: 'big-tear', label: 'qWq', emoticon: 'qWq', paletteId: 'iris' },
  { id: 'zero-open', label: '0O0', emoticon: '0O0', paletteId: 'graphite' },
  { id: 'dash-open', label: 'O-O', emoticon: 'O-O', paletteId: 'sky' },
  { id: 'small-under', label: 'o_o', emoticon: 'o_o', paletteId: 'mint' },
  { id: 'zero-dot', label: '0.0', emoticon: '0.0', paletteId: 'signal' },
  { id: 'tear-caret', label: 'q^q', emoticon: 'q^q', paletteId: 'iris' },
  { id: 'open-equal', label: 'O=O', emoticon: 'O=O', paletteId: 'graphite' },
  { id: 'open-plus', label: 'O+O', emoticon: 'O+O', paletteId: 'gold' },
  { id: 'star-wow', label: '*w*', emoticon: '*w*', paletteId: 'coral' },
  { id: 'at-wow', label: '@w@', emoticon: '@w@', paletteId: 'moss' },
  { id: 'caret-wow', label: '^w^', emoticon: '^w^', paletteId: 'signal' },
  { id: 'zero-n', label: '0n0', emoticon: '0n0', paletteId: 'sky' },
  { id: 'open-m', label: 'OmO', emoticon: 'OmO', paletteId: 'coral' },
  { id: 'soft-a', label: 'oao', emoticon: 'oao', paletteId: 'moss' },
  { id: 'tear-a', label: 'qaq', emoticon: 'qaq', paletteId: 'mint' },
  { id: 'open-n', label: 'OnO', emoticon: 'OnO', paletteId: 'iris' },
  { id: 'upper-m', label: 'OMO', emoticon: 'OMO', paletteId: 'gold' },
  { id: 'tear-dash', label: 'q-q', emoticon: 'q-q', paletteId: 'graphite' },
  { id: 'tear-under', label: 'q_q', emoticon: 'q_q', paletteId: 'signal' },
  { id: 'soft-caret', label: 'o^o', emoticon: 'o^o', paletteId: 'sky' },
  { id: 'soft-wave', label: 'O~O', emoticon: 'O~O', paletteId: 'mint' },
  { id: 'zero-plus', label: '0+0', emoticon: '0+0', paletteId: 'coral' }
]

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const safeIdPart = (value: string) => value.replaceAll(/[^a-zA-Z0-9_-]/g, '-')

const resolveGlyphs = (emoticon: string) => {
  const chars = Array.from(emoticon.trim())
  if (chars.length !== 3) {
    throw new Error('Avatar emoticons must contain exactly 3 characters.')
  }

  return chars.map((char) => {
    const glyph = GLYPHS[char]
    if (glyph == null) {
      throw new Error(`Unsupported avatar glyph: ${char}`)
    }
    return { char, glyph }
  })
}

const AVATAR_SLOTS: readonly AvatarSlot[] = ['left', 'mouth', 'right']

const getGlyphYOffset = (char: string) => char === 'p' || char === 'q' ? LOWERCASE_DESCENDER_Y_OFFSET : 0

const glyphRects = (emoticon: string) => {
  const glyphs = resolveGlyphs(emoticon)
  const totalColumns = glyphs.reduce((sum, item, index) => {
    return sum + item.glyph.width + (index === 0 ? 0 : CHAR_GAP)
  }, 0)
  const width = totalColumns * CELL_SIZE - (CELL_SIZE - MARK_SIZE)
  const height = GLYPH_HEIGHT * CELL_SIZE - (CELL_SIZE - MARK_SIZE)
  const startX = (VIEW_SIZE - width) / 2
  const startY = (VIEW_SIZE - height) / 2
  const rects: AvatarGlyphRect[] = []

  let cursor = 0
  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
    const item = glyphs[glyphIndex]
    const slot = AVATAR_SLOTS[glyphIndex] ?? 'mouth'
    for (let rowIndex = 0; rowIndex < item.glyph.rows.length; rowIndex += 1) {
      const row = item.glyph.rows[rowIndex] ?? ''
      for (let columnIndex = 0; columnIndex < item.glyph.width; columnIndex += 1) {
        if (row[columnIndex] !== '1') continue
        rects.push({
          slot,
          x: startX + (cursor + columnIndex) * CELL_SIZE,
          y: startY + rowIndex * CELL_SIZE + getGlyphYOffset(item.char)
        })
      }
    }
    cursor += item.glyph.width + CHAR_GAP
  }

  return rects
}

export const createAvatarGlyphView = (glyph: string): AvatarGlyphView => {
  const pixelGlyph = GLYPHS[glyph]
  if (pixelGlyph == null) {
    throw new Error(`Unsupported avatar glyph: ${glyph}`)
  }

  const marks: AvatarGlyphMark[] = []
  for (let rowIndex = 0; rowIndex < pixelGlyph.rows.length; rowIndex += 1) {
    const row = pixelGlyph.rows[rowIndex] ?? ''
    for (let columnIndex = 0; columnIndex < pixelGlyph.width; columnIndex += 1) {
      if (row[columnIndex] !== '1') continue
      marks.push({
        x: columnIndex * CELL_SIZE,
        y: rowIndex * CELL_SIZE + getGlyphYOffset(glyph)
      })
    }
  }

  return {
    width: pixelGlyph.width * CELL_SIZE - (CELL_SIZE - MARK_SIZE),
    height: GLYPH_HEIGHT * CELL_SIZE - (CELL_SIZE - MARK_SIZE) + getGlyphYOffset(glyph),
    markSize: MARK_SIZE,
    marks
  }
}

export const getAvatarPalette = (paletteId: string) =>
  AVATAR_PALETTES.find(palette => palette.id === paletteId) ?? AVATAR_PALETTES[0]

export const createAvatarSvg = ({
  backgroundStyle = 'solid',
  dimInactiveGlyphs = false,
  emoticon,
  highlightSlot,
  palette,
  showShadow = false,
  size = 512,
  title = `${emoticon} avatar`
}: CreateAvatarSvgOptions) => {
  const rects = glyphRects(emoticon)
  const titleText = escapeXml(title)
  const background = escapeXml(palette.background)
  const gradientFrom = escapeXml(palette.gradient[0])
  const gradientTo = escapeXml(palette.gradient[1])
  const foreground = escapeXml(palette.foreground)
  const shadow = escapeXml(palette.shadow)
  const gradientId = `avatar-${safeIdPart(palette.id)}-${safeIdPart(emoticon)}-gradient`
  const backgroundFill = backgroundStyle === 'gradient' ? `url(#${gradientId})` : background
  const highlightSlots = highlightSlot == null ? [] : Array.isArray(highlightSlot) ? highlightSlot : [highlightSlot]
  const shadowRects = showShadow
    ? rects.map(({ x, y }) => {
      return `<rect x="${x + 2}" y="${
        y + 2
      }" width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${shadow}" opacity="0.34"/>`
    })
    : []
  const foregroundRects = rects.map(({ slot, x, y }) => {
    const opacity = dimInactiveGlyphs && highlightSlots.length > 0 && !highlightSlots.includes(slot)
      ? ' opacity="0.42"'
      : ''
    return `<rect x="${x}" y="${y}" width="${MARK_SIZE}" height="${MARK_SIZE}" fill="${foreground}"${opacity}/>`
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_SIZE} ${VIEW_SIZE}" width="${size}" height="${size}" role="img" aria-label="${titleText}" shape-rendering="crispEdges">`,
    `  <title>${titleText}</title>`,
    ...(backgroundStyle === 'gradient'
      ? [
        '  <defs>',
        `    <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">`,
        `      <stop offset="0%" stop-color="${gradientFrom}"/>`,
        `      <stop offset="100%" stop-color="${gradientTo}"/>`,
        '    </linearGradient>',
        '  </defs>'
      ]
      : []),
    `  <rect x="0" y="0" width="${VIEW_SIZE}" height="${VIEW_SIZE}" fill="${backgroundFill}"/>`,
    ...(showShadow ? ['  <g>', ...shadowRects.map(rect => `    ${rect}`), '  </g>'] : []),
    '  <g>',
    ...foregroundRects.map(rect => `    ${rect}`),
    '  </g>',
    '</svg>',
    ''
  ].join('\n')
}

export const createAvatarDataUri = (options: CreateAvatarSvgOptions) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createAvatarSvg(options))}`

export const isSupportedAvatarEmoticon = (emoticon: string) => {
  try {
    resolveGlyphs(emoticon)
    return true
  } catch {
    return false
  }
}
