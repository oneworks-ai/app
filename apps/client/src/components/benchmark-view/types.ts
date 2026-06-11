import type { BenchmarkCase, BenchmarkResult } from '@oneworks/types'

export interface BenchmarkQueryParams extends Record<string, string> {
  category: string
  title: string
}

export interface TreeNodeCase extends Pick<BenchmarkCase, 'category' | 'title' | 'frontmatter'> {
  key: string
  latestResult?: BenchmarkResult | null
}
