import { createInstance } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@oneworks/core'

import { CurrentTodoList } from '#~/components/chat/CurrentTodoList'

const createI18n = async () => {
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({
      lng: 'zh',
      resources: {
        zh: {
          translation: {
            chat: {
              todo: {
                noTasks: '暂无任务',
                progress: '已完成 {{completed}}/{{total}}'
              }
            }
          }
        }
      }
    })
  return i18n
}

const renderTodoList = async (messages: ChatMessage[]) => {
  const i18n = await createI18n()
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CurrentTodoList messages={messages} />
    </I18nextProvider>
  )
}

describe('current todo list', () => {
  it('renders Kimi SetTodoList items in the current todo panel', async () => {
    const html = await renderTodoList([{
      id: 'message-1',
      role: 'assistant',
      createdAt: Date.now(),
      content: [{
        type: 'tool_use',
        id: 'tc_todo',
        name: 'SetTodoList',
        input: {
          items: [
            { title: 'Read wire docs', status: 'done' },
            { title: 'Patch adapter', status: 'in_progress' }
          ]
        }
      }]
    }])

    expect(html).toContain('已完成 1/2')
    expect(html).toContain('Read wire docs')
    expect(html).toContain('Patch adapter')
    expect(html).toContain('current-todo-item--completed')
    expect(html).toContain('current-todo-item--in_progress')
  })
})
