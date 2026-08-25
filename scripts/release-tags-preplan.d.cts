export interface ReleaseTagsPreplan {
  heavy: boolean
  reason: string
}

export function preplan(base: string, head: string): ReleaseTagsPreplan
