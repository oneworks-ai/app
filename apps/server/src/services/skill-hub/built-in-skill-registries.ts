import type { ConfiguredSkillRegistry } from '@oneworks/types'

export const BUILT_IN_SKILL_REGISTRIES: ConfiguredSkillRegistry[] = [
  {
    description: 'Official React, Next.js, deployment, and web design skills from Vercel.',
    source: 'vercel-labs/agent-skills',
    title: 'Vercel Agent Skills'
  },
  {
    description: 'Official example, document, and creative skills from Anthropic.',
    source: 'anthropics/skills',
    title: 'Anthropic Skills'
  },
  {
    description: 'Official Azure, .NET, Microsoft 365, and developer tooling skills from Microsoft.',
    source: 'microsoft/skills',
    title: 'Microsoft Skills'
  }
]
