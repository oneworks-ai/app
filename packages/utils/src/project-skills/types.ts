export interface ProjectSkillSummary {
  description?: string
  dirName: string
  name: string
  skillPath?: string
}

export interface NormalizedProjectSkillInstall {
  ref: string
  name: string
  registry?: string
  rename?: string
  source?: string
  version?: string
  targetName: string
  targetDirName: string
}

export interface ResolvedProjectSkillPublishSpec {
  kind: 'path' | 'project' | 'remote'
  requested: string
  skillSpec: string
  dirName?: string
  name?: string
  publish?: {
    source?: string
    registry?: string
    group?: string
    region?: string
    access?: string
  }
}
