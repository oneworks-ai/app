import { defineToolRenders } from '../defineToolRender'
import { GetTaskInfoTool } from './GetTaskInfoTool'
import { ListTasksTool } from './ListTasksTool'

const renders = {
  GetTaskInfo: GetTaskInfoTool,
  ListTasks: ListTasksTool
}

export const taskToolRenders = {
  ...defineToolRenders(renders, {
    namespace: 'mcp__OneWorks__'
  }),
  ...defineToolRenders(renders, {
    namespace: 'adapter:codex:mcp:OneWorks:'
  })
}

export { GetTaskInfoTool, ListTasksTool }
export { TaskToolCard } from './components/TaskToolCard'
