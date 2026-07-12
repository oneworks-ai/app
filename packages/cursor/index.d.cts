export interface OneWorksCursorSvgOptions {
  borderColor?: string
  color: string
  size?: number
}

export function createOneWorksCursorSvg(options: OneWorksCursorSvgOptions): string
export function normalizeCursorColor(value: string): string
export function resolveCursorBorderColor(fillColor: string): string
