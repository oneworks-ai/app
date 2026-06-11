/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import test from 'node:test'

import { addTask, completeTask, createBoard, summarizeBoard } from '../src/task-board.mjs'

test('adds a task with defaults', () => {
  const board = addTask(createBoard(), { title: ' Prepare demo ' })

  assert.deepEqual(board.tasks, [
    {
      id: 'task-1',
      title: 'Prepare demo',
      priority: 'medium',
      done: false
    }
  ])
})

test('requires a task title', () => {
  assert.throws(
    () => addTask(createBoard(), { title: '   ' }),
    /Task title is required/
  )
})

test('summarizes open and completed tasks', () => {
  const board = completeTask(
    addTask(
      addTask(createBoard(), { title: 'Prepare demo' }),
      { title: 'Share link' }
    ),
    'task-1'
  )

  assert.deepEqual(summarizeBoard(board), {
    total: 2,
    done: 1,
    open: 1
  })
})
