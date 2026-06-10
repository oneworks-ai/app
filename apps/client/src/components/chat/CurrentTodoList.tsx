/* eslint-disable max-lines */

import './CurrentTodoList.scss'
import type { ChatMessage, ChatMessageContent, ToolInputs } from '@oneworks/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChatComposerCard } from './ChatComposerCard'

interface TodoItem {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority?: ToolInputs['adapter:claude-code:TodoWrite']['todos'][number]['priority']
}

const KIMI_TODO_TOOL_NAMES = new Set([
  'SetTodoList',
  'set_todo_list',
  'adapter:kimi:SetTodoList',
  'adapter:kimi:set_todo_list'
])

const getTodoStatusIcon = (status: TodoItem['status']) => {
  if (status === 'completed') {
    return 'check_circle'
  }

  if (status === 'in_progress') {
    return 'progress_activity'
  }

  return 'radio_button_unchecked'
}

const getPriorityIcon = (priority?: TodoItem['priority']) => {
  if (priority === 'high') {
    return 'keyboard_double_arrow_up'
  }

  if (priority === 'medium') {
    return 'remove'
  }

  return 'keyboard_double_arrow_down'
}

const isTodoToolName = (name: string) => (
  name === 'TodoWrite' ||
  name === 'todo_write' ||
  name === 'adapter:claude-code:TodoWrite' ||
  name === 'adapter:claude-code:todo_write' ||
  KIMI_TODO_TOOL_NAMES.has(name)
)

const normalizeTodoStatus = (status: unknown): TodoItem['status'] => {
  if (status === 'completed' || status === 'done') return 'completed'
  if (status === 'in_progress') return 'in_progress'
  return 'pending'
}

const normalizeTodoItems = (items: unknown): TodoItem[] => {
  if (!Array.isArray(items)) return []

  return items
    .map((item): TodoItem | undefined => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return undefined
      const record = item as Record<string, unknown>
      const content = typeof record.content === 'string' && record.content.trim() !== ''
        ? record.content.trim()
        : typeof record.title === 'string' && record.title.trim() !== ''
        ? record.title.trim()
        : undefined
      if (content == null) return undefined

      const priority = record.priority === 'high' || record.priority === 'medium' || record.priority === 'low'
        ? record.priority
        : undefined
      return {
        ...(typeof record.id === 'string' && record.id.trim() !== '' ? { id: record.id.trim() } : {}),
        content,
        status: normalizeTodoStatus(record.status),
        ...(priority != null ? { priority } : {})
      }
    })
    .filter((item): item is TodoItem => item != null)
}

const extractTodoItems = (input: unknown) => {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return []
  const record = input as Record<string, unknown>
  return normalizeTodoItems(record.todos).concat(normalizeTodoItems(record.items))
}

export function CurrentTodoList({ messages }: { messages: ChatMessage[] }) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  // Find the latest TodoWrite tool use
  let latestTodos: TodoItem[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const todoUse = msg.content.find((c: ChatMessageContent) =>
        c != null && c.type === 'tool_use' && isTodoToolName(c.name)
      )
      if (
        todoUse != null && todoUse.type === 'tool_use' && todoUse.input != null && typeof todoUse.input === 'object'
      ) {
        const todos = extractTodoItems(todoUse.input)
        if (todos.length > 0) {
          latestTodos = todos
          break
        }
      }
    }
  }

  if (latestTodos.length === 0) return null

  const completedCount = latestTodos.filter(t => t.status === 'completed').length
  const inProgressCount = latestTodos.filter(t => t.status === 'in_progress').length
  const totalCount = latestTodos.length
  const pendingCount = totalCount - completedCount - inProgressCount
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  if (totalCount === 0) {
    return (
      <div className='current-todo-container empty'>
        <ChatComposerCard
          className='current-todo-panel'
          summaryClassName='current-todo-summary current-todo-summary--empty'
          summary={
            <>
              <span className='material-symbols-rounded'>assignment_late</span>
              <span className='current-todo-summary__text'>{t('chat.todo.noTasks')}</span>
            </>
          }
          narrow
        />
      </div>
    )
  }

  const summaryStats = [
    pendingCount > 0
      ? { icon: 'radio_button_unchecked', count: pendingCount, className: 'current-todo-summary__stat' }
      : null,
    inProgressCount > 0
      ? {
        icon: 'progress_activity',
        count: inProgressCount,
        className: 'current-todo-summary__stat current-todo-summary__stat--active'
      }
      : null,
    completedCount > 0
      ? {
        icon: 'check_circle',
        count: completedCount,
        className: 'current-todo-summary__stat current-todo-summary__stat--done'
      }
      : null
  ].filter((item): item is { icon: string; count: number; className: string } => item != null)

  return (
    <div className={`current-todo-container ${isExpanded ? 'expanded' : ''}`}>
      <ChatComposerCard
        className='current-todo-panel'
        summaryClassName='current-todo-summary'
        expanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        progress={
          <div className='current-todo-progress'>
            <div
              className='current-todo-progress__fill'
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        }
        narrow
        summary={
          <>
            <div className='current-todo-summary__headline'>
              <span className='material-symbols-rounded current-todo-summary__icon'>checklist</span>
              <span className='current-todo-summary__text'>
                {t('chat.todo.progress', { completed: completedCount, total: totalCount })}
              </span>
            </div>
            <div className='current-todo-summary__meta'>
              {summaryStats.map(({ icon, count, className }) => (
                <span key={`${icon}-${count}`} className={className}>
                  <span className='material-symbols-rounded'>{icon}</span>
                  <span>{count}</span>
                </span>
              ))}
              <span className='material-symbols-rounded current-todo-summary__chevron'>
                {isExpanded ? 'expand_less' : 'expand_more'}
              </span>
            </div>
          </>
        }
      >
        <ol className='current-todo-list'>
          {latestTodos.map((todo, idx) => (
            <li key={todo.id || idx} className={`current-todo-item current-todo-item--${todo.status}`}>
              <span className='material-symbols-rounded current-todo-item__status'>
                {getTodoStatusIcon(todo.status)}
              </span>
              <span className='current-todo-item__index'>{idx + 1}.</span>
              <div className='current-todo-item__body'>
                <span className='current-todo-item__text'>{todo.content}</span>
                {todo.priority != null && todo.priority !== '' && (
                  <span
                    className={`material-symbols-rounded current-todo-item__priority current-todo-item__priority--${todo.priority}`}
                    title={todo.priority}
                  >
                    {getPriorityIcon(todo.priority)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </ChatComposerCard>
    </div>
  )
}
