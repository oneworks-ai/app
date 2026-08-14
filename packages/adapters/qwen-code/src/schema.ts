export interface QwenRunShellCommandInput {
  command: string
  description?: string
}

export interface QwenReadFileInput {
  path: string
  line?: number
  limit?: number
}

export interface QwenWriteFileInput {
  path: string
  content: string
}

export interface QwenEditInput {
  path: string
  oldString?: string
  newString?: string
}

export interface QwenGlobInput {
  pattern: string
  path?: string
}

export interface QwenGrepSearchInput {
  pattern: string
  path?: string
}

export interface QwenWebFetchInput {
  url: string
}

export interface QwenWebSearchInput {
  query: string
}

export interface QwenAgentInput {
  prompt: string
  subagentType?: string
}

export interface QwenSkillInput {
  name: string
}

declare module '@oneworks/core' {
  interface ToolInputs {
    'adapter:qwen-code:RunShellCommand': QwenRunShellCommandInput
    'adapter:qwen-code:ReadFile': QwenReadFileInput
    'adapter:qwen-code:WriteFile': QwenWriteFileInput
    'adapter:qwen-code:Edit': QwenEditInput
    'adapter:qwen-code:Glob': QwenGlobInput
    'adapter:qwen-code:GrepSearch': QwenGrepSearchInput
    'adapter:qwen-code:WebFetch': QwenWebFetchInput
    'adapter:qwen-code:WebSearch': QwenWebSearchInput
    'adapter:qwen-code:Agent': QwenAgentInput
    'adapter:qwen-code:Skill': QwenSkillInput
  }
}
